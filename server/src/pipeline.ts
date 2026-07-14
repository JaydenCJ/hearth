/**
 * Pipeline orchestration: audio -> STT -> LLM -> TTS -> audio.
 *
 * The Pipeline sits on top of a HearthHub and adds per-session conversation
 * memory. Each stage is routed independently (see routing.ts), so e.g. a
 * Japanese utterance can be transcribed by whisper.cpp, answered by a local
 * LLM and voiced by VOICEVOX without any stage knowing about the others.
 */

import { randomUUID } from "node:crypto";
import type { AudioClip, ChatMessage } from "./adapters/types.js";
import type { HearthHub } from "./hub.js";
import { guessLang } from "./lang.js";
import type { RouteContext } from "./routing.js";

export const DEFAULT_SYSTEM_PROMPT =
  "You are Hearth, a privacy-first voice assistant running on the user's " +
  "own home server. Answer briefly and conversationally: your replies are " +
  "spoken aloud, so avoid markdown, lists and code. If the user speaks " +
  "Japanese, answer in Japanese.";

/** user+assistant message pairs kept per session. */
export const MAX_HISTORY_TURNS = 20;

/** One conversation (usually: one phone, one assistant invocation). */
export interface Session {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** Which backend served a stage and why (surfaced in API responses). */
export interface StageInfo {
  backend: string;
  reason: string;
}

/** Everything produced by one assistant turn. */
export interface PipelineResult {
  sessionId: string;
  transcript: string;
  lang?: string;
  replyText: string;
  replyAudio?: AudioClip;
  stt?: StageInfo;
  llm: StageInfo;
  tts?: StageInfo;
  elapsedMs: number;
}

/** In-memory session store with idle expiry. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly ttlMs: number;

  constructor(ttlSeconds = 3600) {
    this.ttlMs = ttlSeconds * 1000;
  }

  getOrCreate(sessionId?: string): Session {
    this.expire();
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) return existing;
    }
    const session: Session = {
      id: sessionId || randomUUID().replaceAll("-", ""),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  append(session: Session, message: ChatMessage): void {
    session.messages.push(message);
    // Trim oldest turns, keeping the history bounded.
    const overflow = session.messages.length - MAX_HISTORY_TURNS * 2;
    if (overflow > 0) session.messages.splice(0, overflow);
    session.updatedAt = Date.now();
  }

  get size(): number {
    return this.sessions.size;
  }

  private expire(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.updatedAt > this.ttlMs) this.sessions.delete(id);
    }
  }
}

export interface TextTurnOptions {
  sessionId?: string;
  lang?: string;
  tag?: string;
  llmBackend?: string;
  ttsBackend?: string;
  withAudio?: boolean;
}

export interface AudioTurnOptions extends TextTurnOptions {
  mediaType?: string;
  sttBackend?: string;
}

/** Orchestrates STT -> LLM -> TTS with routing and session memory. */
export class Pipeline {
  readonly hub: HearthHub;
  readonly sessions: SessionStore;
  private readonly systemPrompt: string;

  constructor(hub: HearthHub, systemPrompt: string = DEFAULT_SYSTEM_PROMPT) {
    this.hub = hub;
    this.sessions = new SessionStore();
    this.systemPrompt = systemPrompt;
  }

  /** Run the STT stage only. Returns transcript, language and stage info. */
  async transcribe(
    audio: Buffer,
    opts: { mediaType?: string; lang?: string; sttBackend?: string } = {},
  ): Promise<{ text: string; lang?: string; stt: StageInfo }> {
    const ctx: RouteContext = { text: "", lang: opts.lang };
    const [decision, adapter] = this.hub.resolveStt(ctx, opts.sttBackend);
    const result = await adapter.transcribe(audio, {
      mediaType: opts.mediaType,
      lang: opts.lang,
    });
    const lang = result.lang ?? opts.lang ?? guessLang(result.text);
    return {
      text: result.text,
      lang,
      stt: { backend: decision.backend, reason: decision.reason },
    };
  }

  /** Run the TTS stage only. Returns the audio clip and stage info. */
  async synthesize(
    text: string,
    opts: { lang?: string; tag?: string; ttsBackend?: string } = {},
  ): Promise<{ clip: AudioClip; tts: StageInfo }> {
    const lang = opts.lang ?? guessLang(text);
    const ctx: RouteContext = { text, lang, tag: opts.tag };
    const [decision, adapter] = this.hub.resolveTts(ctx, opts.ttsBackend);
    const clip = await adapter.synthesize(text, { lang });
    return {
      clip,
      tts: { backend: decision.backend, reason: decision.reason },
    };
  }

  /** One assistant turn starting from text (STT already done or skipped). */
  async runText(text: string, opts: TextTurnOptions = {}): Promise<PipelineResult> {
    const started = performance.now();
    const lang = opts.lang ?? guessLang(text);
    const session = this.sessions.getOrCreate(opts.sessionId);

    // LLM stage — routed on the *user's* utterance.
    const llmCtx: RouteContext = { text, lang, tag: opts.tag };
    const [llmDecision, llm] = this.hub.resolveLlm(llmCtx, opts.llmBackend);
    this.sessions.append(session, { role: "user", content: text });
    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt },
      ...session.messages,
    ];
    const reply = await llm.chat(messages);
    this.sessions.append(session, { role: "assistant", content: reply });

    // TTS stage — routed on the *reply* (the text actually spoken).
    let replyAudio: AudioClip | undefined;
    let ttsInfo: StageInfo | undefined;
    if (opts.withAudio !== false) {
      const synth = await this.synthesize(reply, {
        lang: guessLang(reply),
        tag: opts.tag,
        ttsBackend: opts.ttsBackend,
      });
      replyAudio = synth.clip;
      ttsInfo = synth.tts;
    }

    return {
      sessionId: session.id,
      transcript: text,
      lang,
      replyText: reply,
      replyAudio,
      llm: { backend: llmDecision.backend, reason: llmDecision.reason },
      tts: ttsInfo,
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  /** The full voice turn: audio -> STT -> LLM -> TTS -> audio. */
  async runAudio(
    audio: Buffer,
    opts: AudioTurnOptions = {},
  ): Promise<PipelineResult> {
    const started = performance.now();
    const { text, lang, stt } = await this.transcribe(audio, {
      mediaType: opts.mediaType,
      lang: opts.lang,
      sttBackend: opts.sttBackend,
    });
    const result = await this.runText(text, {
      sessionId: opts.sessionId,
      lang,
      tag: opts.tag,
      llmBackend: opts.llmBackend,
      ttsBackend: opts.ttsBackend,
      withAudio: opts.withAudio,
    });
    return {
      ...result,
      transcript: text,
      lang,
      stt,
      elapsedMs: Math.round(performance.now() - started),
    };
  }
}
