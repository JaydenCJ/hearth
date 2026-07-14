/**
 * In-process mock STT backend.
 *
 * Used for tests and for demoing the full pipeline with zero hardware. If
 * the uploaded "audio" bytes are valid UTF-8 text, the mock pretends it
 * perfectly transcribed them — which lets end-to-end tests drive the real
 * pipeline with plain strings. Otherwise it returns the configured fixed
 * transcript.
 */

import { guessLang } from "../../lang.js";
import type { SttAdapter, SttResult } from "../types.js";

function decodeUtf8Strict(audio: Buffer): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(audio);
  } catch {
    return undefined;
  }
  // Reject binary blobs that happen to decode (e.g. WAV headers contain
  // control characters below \t).
  if (!text.trim()) return undefined;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 9) return undefined;
  }
  return text;
}

export class MockSttAdapter implements SttAdapter {
  readonly name: string;
  private readonly transcript: string;

  constructor(opts: { transcript?: string; name?: string } = {}) {
    this.name = opts.name ?? "mock";
    this.transcript = opts.transcript ?? "hello hearth";
  }

  async transcribe(
    audio: Buffer,
    opts: { mediaType?: string; lang?: string } = {},
  ): Promise<SttResult> {
    const text = (decodeUtf8Strict(audio) ?? this.transcript).trim();
    return { text, lang: opts.lang ?? guessLang(text) };
  }
}
