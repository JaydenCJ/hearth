/**
 * Builds adapter instances and routers from a validated configuration.
 *
 * The HearthHub is the single object the API layer and the CLI hold: it
 * owns one adapter instance per configured backend plus one router per
 * layer, and resolves (router decision -> adapter) for each request.
 */

import { MockLlmAdapter } from "./adapters/llm/mock.js";
import { OpenAiCompatAdapter } from "./adapters/llm/openaiCompat.js";
import { MockSttAdapter } from "./adapters/stt/mock.js";
import { WhisperCppAdapter } from "./adapters/stt/whisperCpp.js";
import { MockTtsAdapter } from "./adapters/tts/mock.js";
import { PiperAdapter } from "./adapters/tts/piper.js";
import { VoicevoxAdapter } from "./adapters/tts/voicevox.js";
import type {
  LlmAdapter,
  SttAdapter,
  TtsAdapter,
} from "./adapters/types.js";
import type {
  HearthConfig,
  LlmBackendConfig,
  SttBackendConfig,
  TtsBackendConfig,
} from "./config.js";
import { Router } from "./routing.js";
import type { RouteContext, RouteDecision } from "./routing.js";

export function buildSttAdapter(
  name: string,
  cfg: SttBackendConfig,
): SttAdapter {
  if (cfg.type === "whisper_cpp") {
    // cfg.url presence is enforced by config validation.
    return new WhisperCppAdapter(cfg.url as string, {
      language: cfg.language,
      name,
    });
  }
  return new MockSttAdapter({ transcript: cfg.transcript, name });
}

export function buildTtsAdapter(
  name: string,
  cfg: TtsBackendConfig,
): TtsAdapter {
  if (cfg.type === "piper") {
    return new PiperAdapter(cfg.url as string, {
      voice: cfg.voice,
      speed: cfg.speed,
      name,
    });
  }
  if (cfg.type === "voicevox") {
    return new VoicevoxAdapter(cfg.url as string, {
      speaker: cfg.speaker,
      speed: cfg.speed,
      name,
    });
  }
  return new MockTtsAdapter({ name });
}

export function buildLlmAdapter(
  name: string,
  cfg: LlmBackendConfig,
): LlmAdapter {
  if (cfg.type === "openai_compat") {
    return new OpenAiCompatAdapter(cfg.baseUrl as string, {
      model: cfg.model,
      apiKey: cfg.apiKey,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
      systemPrompt: cfg.systemPrompt,
      name,
    });
  }
  return new MockLlmAdapter({ reply: cfg.reply, name });
}

/** All configured backends plus per-layer routers, ready to serve. */
export class HearthHub {
  readonly config: HearthConfig;
  readonly sttAdapters: Map<string, SttAdapter>;
  readonly ttsAdapters: Map<string, TtsAdapter>;
  readonly llmAdapters: Map<string, LlmAdapter>;
  readonly sttRouter: Router;
  readonly ttsRouter: Router;
  readonly llmRouter: Router;

  constructor(config: HearthConfig) {
    this.config = config;
    this.sttAdapters = new Map(
      Object.entries(config.stt.backends).map(([name, cfg]) => [
        name,
        buildSttAdapter(name, cfg),
      ]),
    );
    this.ttsAdapters = new Map(
      Object.entries(config.tts.backends).map(([name, cfg]) => [
        name,
        buildTtsAdapter(name, cfg),
      ]),
    );
    this.llmAdapters = new Map(
      Object.entries(config.llm.backends).map(([name, cfg]) => [
        name,
        buildLlmAdapter(name, cfg),
      ]),
    );
    this.sttRouter = new Router(
      "stt",
      this.sttAdapters.keys(),
      config.stt.rules,
      config.stt.default,
    );
    this.ttsRouter = new Router(
      "tts",
      this.ttsAdapters.keys(),
      config.tts.rules,
      config.tts.default,
    );
    this.llmRouter = new Router(
      "llm",
      this.llmAdapters.keys(),
      config.llm.rules,
      config.llm.default,
    );
  }

  resolveStt(
    ctx: RouteContext,
    explicit?: string,
  ): [RouteDecision, SttAdapter] {
    const decision = this.sttRouter.route(ctx, explicit);
    return [decision, this.sttAdapters.get(decision.backend) as SttAdapter];
  }

  resolveTts(
    ctx: RouteContext,
    explicit?: string,
  ): [RouteDecision, TtsAdapter] {
    const decision = this.ttsRouter.route(ctx, explicit);
    return [decision, this.ttsAdapters.get(decision.backend) as TtsAdapter];
  }

  resolveLlm(
    ctx: RouteContext,
    explicit?: string,
  ): [RouteDecision, LlmAdapter] {
    const decision = this.llmRouter.route(ctx, explicit);
    return [decision, this.llmAdapters.get(decision.backend) as LlmAdapter];
  }
}
