/**
 * In-process mock TTS backend.
 *
 * Produces a real, playable WAV file (a soft sine "chirp" whose duration
 * scales with the text length), so demos and tests exercise genuine audio
 * plumbing end to end without Piper or VOICEVOX running.
 */

import type { AudioClip, TtsAdapter } from "../types.js";

export const MOCK_SAMPLE_RATE = 16000;

/** Render a mono 16-bit PCM WAV containing a faded sine tone. */
export function sineWav(durationSeconds: number, freq = 440.0): Buffer {
  const nSamples = Math.max(1, Math.floor(MOCK_SAMPLE_RATE * durationSeconds));
  const pcm = Buffer.alloc(nSamples * 2);
  for (let i = 0; i < nSamples; i++) {
    const t = i / MOCK_SAMPLE_RATE;
    // Fade in/out to avoid clicks.
    const envelope = Math.min(1.0, i / 400, (nSamples - i) / 400);
    const value = Math.round(
      12000 * envelope * Math.sin(2 * Math.PI * freq * t),
    );
    pcm.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format: linear PCM
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(MOCK_SAMPLE_RATE, 24);
  header.writeUInt32LE(MOCK_SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class MockTtsAdapter implements TtsAdapter {
  readonly name: string;

  constructor(opts: { name?: string } = {}) {
    this.name = opts.name ?? "mock";
  }

  async synthesize(
    text: string,
    opts: { lang?: string } = {},
  ): Promise<AudioClip> {
    // ~12 characters per second of "speech", clamped to a sane range.
    const duration = Math.min(5.0, Math.max(0.3, text.length / 12.0));
    const freq = (opts.lang ?? "").startsWith("ja") ? 523.25 : 440.0;
    return {
      data: sineWav(duration, freq),
      mediaType: "audio/wav",
      sampleRate: MOCK_SAMPLE_RATE,
    };
  }
}
