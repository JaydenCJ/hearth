/**
 * Adapter for the Piper HTTP server.
 *
 * Piper (https://github.com/OHF-Voice/piper1-gpl) ships an HTTP server:
 *
 *     python3 -m piper.http_server -m en_US-lessac-medium --port 5000
 *
 *     POST /
 *         Content-Type: application/json
 *         {"text": "...", "voice": "...", "length_scale": 1.0}
 *     -> WAV bytes
 *
 * `voice` is optional (the server's default model is used when omitted).
 * `length_scale` is the inverse of speaking speed (2.0 = twice as slow).
 */

import { AdapterError } from "../types.js";
import type { AudioClip, FetchLike, TtsAdapter } from "../types.js";

export interface PiperRequest {
  url: string;
  body: { text: string; voice?: string; length_scale?: number };
}

export class PiperAdapter implements TtsAdapter {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly voice?: string;
  private readonly speed: number;
  private readonly fetchImpl: FetchLike;

  constructor(
    url: string,
    opts: {
      voice?: string;
      speed?: number;
      name?: string;
      fetchImpl?: FetchLike;
    } = {},
  ) {
    this.name = opts.name ?? "piper";
    this.baseUrl = url.replace(/\/+$/, "");
    this.voice = opts.voice;
    this.speed = opts.speed ?? 1.0;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Build the synthesis request (unit testable without a live server). */
  buildRequest(text: string): PiperRequest {
    const body: PiperRequest["body"] = { text };
    if (this.voice) body.voice = this.voice;
    if (this.speed !== 1.0) {
      // Piper's length_scale stretches duration; speed is its inverse.
      body.length_scale = Math.round((1.0 / this.speed) * 10000) / 10000;
    }
    return { url: `${this.baseUrl}/`, body };
  }

  async synthesize(
    text: string,
    _opts: { lang?: string } = {},
  ): Promise<AudioClip> {
    const req = this.buildRequest(text);
    let resp: Response;
    try {
      resp = await this.fetchImpl(req.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
    } catch (e) {
      throw new AdapterError(`piper request failed: ${String(e)}`, {
        backend: this.name,
        layer: "tts",
      });
    }
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 200);
      throw new AdapterError(`piper returned HTTP ${resp.status}: ${detail}`, {
        backend: this.name,
        layer: "tts",
      });
    }
    const data = Buffer.from(await resp.arrayBuffer());
    if (data.length === 0) {
      throw new AdapterError("piper returned empty audio", {
        backend: this.name,
        layer: "tts",
      });
    }
    return { data, mediaType: "audio/wav" };
  }
}
