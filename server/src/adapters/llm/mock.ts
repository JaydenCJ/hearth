/**
 * In-process mock LLM backend.
 *
 * Implements a handful of canned "assistant intents" (time, greeting, echo)
 * so the no-hardware demo actually feels like talking to an assistant, and
 * so pipeline tests can assert on deterministic replies.
 */

import type { ChatMessage, LlmAdapter } from "../types.js";

const JA_HINTS = ["こんにちは", "今何時", "何時", "おはよう", "こんばんは", "ありがとう"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export class MockLlmAdapter implements LlmAdapter {
  readonly name: string;
  private readonly fixedReply?: string;

  constructor(opts: { reply?: string; name?: string } = {}) {
    this.name = opts.name ?? "mock";
    this.fixedReply = opts.reply;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    if (this.fixedReply !== undefined) return this.fixedReply;
    const lastUser =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const lowered = lastUser.toLowerCase();
    const isJa = JA_HINTS.some((h) => lastUser.includes(h));
    const now = new Date();

    if (lowered.includes("what time") || (lowered.includes("time") && lowered.includes("?"))) {
      return `It is ${pad(now.getHours())}:${pad(now.getMinutes())}.`;
    }
    if (lastUser.includes("何時")) {
      return `いま${now.getHours()}時${now.getMinutes()}分です。`;
    }
    if (["hello", "hi ", "hey"].some((g) => lowered.includes(g)) || lowered === "hi") {
      return "Hello, I am Hearth, your self-hosted assistant.";
    }
    if (lastUser.includes("こんにちは") || lastUser.includes("おはよう")) {
      return "こんにちは。Hearthです。ご用件をどうぞ。";
    }
    if (isJa) {
      return `「${lastUser}」について承知しました。（mock応答）`;
    }
    return `You said: ${lastUser} (mock reply)`;
  }
}
