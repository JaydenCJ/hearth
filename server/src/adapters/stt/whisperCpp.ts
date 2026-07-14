/**
 * Adapter for the whisper.cpp example HTTP server.
 *
 * whisper.cpp ships `whisper-server` (examples/server) which exposes:
 *
 *     POST /inference
 *         multipart/form-data:
 *             file             audio file (WAV recommended)
 *             language         "auto" or an ISO-639-1 code
 *             response_format  "json"
 *
 *     -> {"text": " transcribed text"}
 *
 * Start it with e.g.:
 *
 *     ./build/bin/whisper-server -m models/ggml-base.bin --port 8081
 *
 * Reference: https://github.com/ggml-org/whisper.cpp/tree/master/examples/server
 */

import { AdapterError } from "../types.js";
import type { FetchLike, SttAdapter, SttResult } from "../types.js";

const MEDIA_EXT: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/flac": "flac",
  "audio/webm": "webm",
};

export interface WhisperCppRequest {
  url: string;
  /** Multipart form fields; `file` carries the audio blob. */
  form: FormData;
  /** The plain fields, exposed for unit tests. */
  fields: { filename: string; language: string; responseFormat: string };
}

export class WhisperCppAdapter implements SttAdapter {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly language: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    url: string,
    opts: { language?: string; name?: string; fetchImpl?: FetchLike } = {},
  ) {
    this.name = opts.name ?? "whisper_cpp";
    this.baseUrl = url.replace(/\/+$/, "");
    this.language = opts.language ?? "auto";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Build the /inference request. Split out from transcribe() so request
   * construction is unit testable without a live server.
   */
  buildRequest(
    audio: Buffer,
    opts: { mediaType?: string; lang?: string } = {},
  ): WhisperCppRequest {
    const mediaType = opts.mediaType ?? "audio/wav";
    const key = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
    const ext = MEDIA_EXT[key] ?? "wav";
    const filename = `audio.${ext}`;
    const language = opts.lang || this.language || "auto";
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: mediaType }),
      filename,
    );
    form.append("language", language);
    form.append("response_format", "json");
    return {
      url: `${this.baseUrl}/inference`,
      form,
      fields: { filename, language, responseFormat: "json" },
    };
  }

  async transcribe(
    audio: Buffer,
    opts: { mediaType?: string; lang?: string } = {},
  ): Promise<SttResult> {
    const req = this.buildRequest(audio, opts);
    let resp: Response;
    try {
      resp = await this.fetchImpl(req.url, { method: "POST", body: req.form });
    } catch (e) {
      throw new AdapterError(`whisper.cpp request failed: ${String(e)}`, {
        backend: this.name,
        layer: "stt",
      });
    }
    const body = await resp.text();
    if (!resp.ok) {
      throw new AdapterError(
        `whisper.cpp returned HTTP ${resp.status}: ${body.slice(0, 200)}`,
        { backend: this.name, layer: "stt" },
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new AdapterError(
        `whisper.cpp returned non-JSON payload: ${body.slice(0, 200)}`,
        { backend: this.name, layer: "stt" },
      );
    }
    const record = payload as Record<string, unknown>;
    if (typeof record?.["text"] !== "string") {
      throw new AdapterError(
        `whisper.cpp returned unexpected payload: ${body.slice(0, 200)}`,
        { backend: this.name, layer: "stt" },
      );
    }
    const detectedRaw = record["language"];
    const detected =
      typeof detectedRaw === "string" && detectedRaw
        ? detectedRaw
        : opts.lang && opts.lang !== "auto"
          ? opts.lang
          : undefined;
    return { text: record["text"].trim(), lang: detected };
  }
}
