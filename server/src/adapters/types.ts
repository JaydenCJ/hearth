/**
 * Adapter interfaces shared by all backends.
 *
 * An adapter wraps one concrete engine (whisper.cpp, Piper, VOICEVOX, an
 * OpenAI-compatible LLM endpoint, or an in-process mock) behind a small
 * async interface, so the pipeline never knows which engine it talks to.
 */

/** Raised when a backend call fails (network, HTTP status, bad payload). */
export class AdapterError extends Error {
  readonly backend: string;
  readonly layer: string;

  constructor(message: string, opts: { backend?: string; layer?: string } = {}) {
    super(message);
    this.name = "AdapterError";
    this.backend = opts.backend ?? "";
    this.layer = opts.layer ?? "";
  }
}

/** Output of a speech-to-text call. */
export interface SttResult {
  text: string;
  /** Language detected or assumed by the engine (may be undefined). */
  lang?: string;
}

/** A synthesized (or uploaded) chunk of audio. */
export interface AudioClip {
  data: Buffer;
  mediaType: string;
  sampleRate?: number;
}

/** One turn of an LLM conversation, OpenAI message shape. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Speech-to-text: audio bytes in, transcript out. */
export interface SttAdapter {
  readonly name: string;
  transcribe(
    audio: Buffer,
    opts?: { mediaType?: string; lang?: string },
  ): Promise<SttResult>;
}

/** Text-to-speech: text in, audio clip out. */
export interface TtsAdapter {
  readonly name: string;
  synthesize(text: string, opts?: { lang?: string }): Promise<AudioClip>;
}

/** Large language model: chat messages in, assistant reply out. */
export interface LlmAdapter {
  readonly name: string;
  chat(messages: ChatMessage[]): Promise<string>;
}

/**
 * Minimal fetch signature the HTTP adapters depend on. Tests inject a fake;
 * production code uses the Node global `fetch`.
 */
export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;
