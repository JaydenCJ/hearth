/**
 * Adapter for the VOICEVOX engine (first-class Japanese TTS).
 *
 * VOICEVOX (https://github.com/VOICEVOX/voicevox_engine) synthesis is a
 * two-step HTTP flow:
 *
 *     1. POST /audio_query?text=<text>&speaker=<id>
 *        -> JSON "audio query" (phonemes, pitch, speed...)
 *     2. POST /synthesis?speaker=<id>
 *        Content-Type: application/json, body = the audio query from step 1
 *        -> WAV bytes
 *
 * `speaker` is a style id (e.g. 1 = Zundamon "normal"); list them via
 * `GET /speakers`. The default engine port is 50021.
 */

import { AdapterError } from "../types.js";
import type { AudioClip, FetchLike, TtsAdapter } from "../types.js";

export class VoicevoxAdapter implements TtsAdapter {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly speaker: number;
  private readonly speed: number;
  private readonly fetchImpl: FetchLike;

  constructor(
    url: string,
    opts: {
      speaker?: number;
      speed?: number;
      name?: string;
      fetchImpl?: FetchLike;
    } = {},
  ) {
    this.name = opts.name ?? "voicevox";
    this.baseUrl = url.replace(/\/+$/, "");
    this.speaker = opts.speaker ?? 1;
    this.speed = opts.speed ?? 1.0;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Build the step-1 `/audio_query` URL (unit testable). */
  buildQueryUrl(text: string): string {
    const params = new URLSearchParams({
      text,
      speaker: String(this.speaker),
    });
    return `${this.baseUrl}/audio_query?${params.toString()}`;
  }

  /**
   * Build the step-2 `/synthesis` request from the audio query returned by
   * step 1. Applies the configured speaking speed (unit testable).
   */
  buildSynthesisRequest(audioQuery: Record<string, unknown>): {
    url: string;
    body: Record<string, unknown>;
  } {
    const body = { ...audioQuery };
    if (this.speed !== 1.0) body["speedScale"] = this.speed;
    const params = new URLSearchParams({ speaker: String(this.speaker) });
    return { url: `${this.baseUrl}/synthesis?${params.toString()}`, body };
  }

  async synthesize(
    text: string,
    _opts: { lang?: string } = {},
  ): Promise<AudioClip> {
    let audioQuery: Record<string, unknown>;
    try {
      const queryResp = await this.fetchImpl(this.buildQueryUrl(text), {
        method: "POST",
      });
      if (!queryResp.ok) {
        throw new Error(`HTTP ${queryResp.status}`);
      }
      audioQuery = (await queryResp.json()) as Record<string, unknown>;
    } catch (e) {
      throw new AdapterError(`voicevox audio_query failed: ${String(e)}`, {
        backend: this.name,
        layer: "tts",
      });
    }

    const synth = this.buildSynthesisRequest(audioQuery);
    let synthResp: Response;
    try {
      synthResp = await this.fetchImpl(synth.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(synth.body),
      });
    } catch (e) {
      throw new AdapterError(`voicevox synthesis failed: ${String(e)}`, {
        backend: this.name,
        layer: "tts",
      });
    }
    if (!synthResp.ok) {
      const detail = (await synthResp.text()).slice(0, 200);
      throw new AdapterError(
        `voicevox synthesis returned HTTP ${synthResp.status}: ${detail}`,
        { backend: this.name, layer: "tts" },
      );
    }
    const data = Buffer.from(await synthResp.arrayBuffer());
    if (data.length === 0) {
      throw new AdapterError("voicevox returned empty audio", {
        backend: this.name,
        layer: "tts",
      });
    }
    return { data, mediaType: "audio/wav" };
  }
}
