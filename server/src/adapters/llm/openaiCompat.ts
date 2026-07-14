/**
 * Adapter for any OpenAI-compatible chat-completions endpoint.
 *
 * Works with llama.cpp server (`llama-server --port 11434`), Ollama
 * (`/v1`), vLLM, LM Studio, OpenRouter, or a cloud provider — anything
 * that accepts:
 *
 *     POST {base_url}/chat/completions
 *     Authorization: Bearer <api_key>        (optional for local servers)
 *     {"model": ..., "messages": [...], "temperature": ..., "max_tokens": ...}
 *
 * Combined with Hearth's routing rules this is what lets you keep everyday
 * utterances on a local model and (only if you choose to) route selected
 * requests to a cloud API.
 */

import { AdapterError } from "../types.js";
import type { ChatMessage, FetchLike, LlmAdapter } from "../types.js";

export interface OpenAiCompatRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: { role: string; content: string }[];
    temperature: number;
    max_tokens: number;
  };
}

export class OpenAiCompatAdapter implements LlmAdapter {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly systemPrompt?: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    baseUrl: string,
    opts: {
      model?: string;
      apiKey?: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
      name?: string;
      fetchImpl?: FetchLike;
    } = {},
  ) {
    this.name = opts.name ?? "openai_compat";
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = opts.model ?? "default";
    this.apiKey = opts.apiKey;
    this.temperature = opts.temperature ?? 0.7;
    this.maxTokens = opts.maxTokens ?? 512;
    this.systemPrompt = opts.systemPrompt;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Build the chat-completions request (unit testable). */
  buildRequest(messages: ChatMessage[]): OpenAiCompatRequest {
    const wire: { role: string; content: string }[] = [];
    const hasSystem = messages.some((m) => m.role === "system");
    if (this.systemPrompt && !hasSystem) {
      wire.push({ role: "system", content: this.systemPrompt });
    }
    for (const m of messages) wire.push({ role: m.role, content: m.content });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    return {
      url: `${this.baseUrl}/chat/completions`,
      headers,
      body: {
        model: this.model,
        messages: wire,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      },
    };
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const req = this.buildRequest(messages);
    let resp: Response;
    try {
      resp = await this.fetchImpl(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
      });
    } catch (e) {
      throw new AdapterError(`LLM request failed: ${String(e)}`, {
        backend: this.name,
        layer: "llm",
      });
    }
    const text = await resp.text();
    if (!resp.ok) {
      throw new AdapterError(
        `LLM returned HTTP ${resp.status}: ${text.slice(0, 200)}`,
        { backend: this.name, layer: "llm" },
      );
    }
    let content: unknown;
    try {
      const payload = JSON.parse(text) as {
        choices?: { message?: { content?: unknown } }[];
      };
      content = payload.choices?.[0]?.message?.content;
    } catch {
      content = undefined;
    }
    if (typeof content !== "string") {
      throw new AdapterError(
        `LLM returned unexpected payload: ${text.slice(0, 200)}`,
        { backend: this.name, layer: "llm" },
      );
    }
    return content.trim();
  }
}
