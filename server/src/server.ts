/**
 * REST + WebSocket API of the Hearth hub.
 *
 * REST endpoints (all under /v1):
 *
 * - GET  /v1/health      — liveness + configured backends per layer.
 * - POST /v1/stt         — raw audio body in, transcript out (STT only).
 * - POST /v1/tts         — JSON text in, WAV out (TTS stage only).
 * - POST /v1/chat/text   — text turn: LLM (+ optional TTS), JSON out.
 * - POST /v1/chat/audio  — full voice turn: audio -> STT -> LLM -> TTS.
 *
 * WebSocket /v1/stream — the phone client's endpoint: stream microphone
 * audio up as binary frames, receive transcript / reply / audio events
 * back. The exact frame sequence is documented in docs/protocol.md and
 * mirrored by the Android client.
 */

import { createServer } from "node:http";
import type {
  IncomingMessage,
  Server as HttpServer,
  ServerResponse,
} from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { AdapterError } from "./adapters/types.js";
import type { HearthConfig } from "./config.js";
import { HearthHub } from "./hub.js";
import { Pipeline } from "./pipeline.js";
import type { PipelineResult } from "./pipeline.js";
import { RoutingError } from "./routing.js";
import { VERSION } from "./version.js";

/** Upper bound for uploaded audio and JSON bodies (32 MiB). */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

export interface HearthServer {
  /** The underlying node:http server (already listening). */
  http: HttpServer;
  hub: HearthHub;
  pipeline: Pipeline;
  /** The bound address, e.g. "127.0.0.1:8321". */
  address: { host: string; port: number };
  close(): Promise<void>;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseJsonBody(body: Buffer): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(body.toString("utf-8"));
  } catch {
    throw new HttpError(400, "request body must be valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new HttpError(400, "request body must be a JSON object");
  }
  return data as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function resultToJson(result: PipelineResult): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    session_id: result.sessionId,
    transcript: result.transcript,
    lang: result.lang ?? null,
    reply_text: result.replyText,
    elapsed_ms: result.elapsedMs,
    backends: {
      stt: result.stt ?? null,
      llm: result.llm,
      tts: result.tts ?? null,
    },
  };
  if (result.replyAudio) {
    payload["audio"] = {
      media_type: result.replyAudio.mediaType,
      data_b64: result.replyAudio.data.toString("base64"),
    };
  }
  return payload;
}

/** Start the Hearth hub server for `config`; resolves once listening. */
export function startServer(
  config: HearthConfig,
  overrides: { host?: string; port?: number } = {},
): Promise<HearthServer> {
  const hub = new HearthHub(config);
  const pipeline = new Pipeline(hub);
  const host = overrides.host ?? config.server.host;
  const port = overrides.port ?? config.server.port;

  const requireAuth = (req: IncomingMessage): void => {
    const token = config.server.authToken;
    if (!token) return;
    if (req.headers.authorization !== `Bearer ${token}`) {
      throw new HttpError(401, "invalid or missing token");
    }
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    const route = `${req.method} ${url.pathname}`;

    if (route === "GET /v1/health") {
      sendJson(res, 200, {
        status: "ok",
        version: VERSION,
        backends: {
          stt: [...hub.sttAdapters.keys()].sort(),
          tts: [...hub.ttsAdapters.keys()].sort(),
          llm: [...hub.llmAdapters.keys()].sort(),
        },
        defaults: {
          stt: hub.sttRouter.default,
          tts: hub.ttsRouter.default,
          llm: hub.llmRouter.default,
        },
      });
      return;
    }

    if (route === "POST /v1/stt") {
      requireAuth(req);
      const audio = await readBody(req);
      if (audio.length === 0) throw new HttpError(400, "empty audio upload");
      const { text, lang, stt } = await pipeline.transcribe(audio, {
        mediaType: req.headers["content-type"] ?? "audio/wav",
        lang: str(url.searchParams.get("lang") ?? undefined),
        sttBackend: str(url.searchParams.get("backend") ?? undefined),
      });
      sendJson(res, 200, { text, lang: lang ?? null, backend: stt });
      return;
    }

    if (route === "POST /v1/tts") {
      requireAuth(req);
      const body = parseJsonBody(await readBody(req));
      const text = str(body["text"]);
      if (!text) throw new HttpError(400, "'text' is required");
      const { clip, tts } = await pipeline.synthesize(text, {
        lang: str(body["lang"]),
        tag: str(body["tag"]),
        ttsBackend: str(body["backend"]),
      });
      res.writeHead(200, {
        "Content-Type": clip.mediaType,
        "Content-Length": clip.data.length,
        "X-Hearth-Backend": tts.backend,
      });
      res.end(clip.data);
      return;
    }

    if (route === "POST /v1/chat/text") {
      requireAuth(req);
      const body = parseJsonBody(await readBody(req));
      const text = str(body["text"]);
      if (!text) throw new HttpError(400, "'text' is required");
      const result = await pipeline.runText(text, {
        sessionId: str(body["session_id"]),
        lang: str(body["lang"]),
        tag: str(body["tag"]),
        llmBackend: str(body["llm_backend"]),
        ttsBackend: str(body["tts_backend"]),
        withAudio: body["with_audio"] !== false,
      });
      sendJson(res, 200, resultToJson(result));
      return;
    }

    if (route === "POST /v1/chat/audio") {
      requireAuth(req);
      const audio = await readBody(req);
      if (audio.length === 0) throw new HttpError(400, "empty audio upload");
      const q = url.searchParams;
      const result = await pipeline.runAudio(audio, {
        mediaType: req.headers["content-type"] ?? "audio/wav",
        sessionId: str(q.get("session_id") ?? undefined),
        lang: str(q.get("lang") ?? undefined),
        tag: str(q.get("tag") ?? undefined),
        sttBackend: str(q.get("stt_backend") ?? undefined),
        llmBackend: str(q.get("llm_backend") ?? undefined),
        ttsBackend: str(q.get("tts_backend") ?? undefined),
        withAudio: q.get("with_audio") !== "false",
      });
      sendJson(res, 200, resultToJson(result));
      return;
    }

    throw new HttpError(404, `no such endpoint: ${route}`);
  };

  const http = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (e instanceof HttpError) {
        sendJson(res, e.status, { detail: e.message });
      } else if (e instanceof RoutingError) {
        sendJson(res, 400, { detail: e.message });
      } else if (e instanceof AdapterError) {
        sendJson(res, 502, {
          detail: e.message,
          layer: e.layer,
          backend: e.backend,
        });
      } else {
        sendJson(res, 500, { detail: "internal server error" });
      }
    });
  });

  const wss = new WebSocketServer({ server: http, path: "/v1/stream" });
  wss.on("connection", (ws) => {
    handleStream(ws, pipeline, config).catch(() => {
      try {
        ws.close(1011);
      } catch {
        // already closed
      }
    });
  });

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => {
      const addr = http.address();
      const boundPort =
        typeof addr === "object" && addr !== null ? addr.port : port;
      resolve({
        http,
        hub,
        pipeline,
        address: { host, port: boundPort },
        close: () =>
          new Promise<void>((res2, rej2) => {
            wss.close();
            http.close((err) => (err ? rej2(err) : res2()));
            http.closeAllConnections();
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// WebSocket protocol (see docs/protocol.md)
// ---------------------------------------------------------------------------

interface StartFrame {
  type: "start";
  session_id?: string;
  lang?: string;
  tag?: string;
  token?: string;
  stt_backend?: string;
  llm_backend?: string;
  tts_backend?: string;
  with_audio?: boolean;
}

function wsSend(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

async function handleStream(
  ws: WebSocket,
  pipeline: Pipeline,
  config: HearthConfig,
): Promise<void> {
  const frames: (Buffer | string)[] = [];
  let notify: (() => void) | undefined;
  let closed = false;

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    frames.push(isBinary ? data : data.toString("utf-8"));
    notify?.();
  });
  ws.on("close", () => {
    closed = true;
    notify?.();
  });
  ws.on("error", () => {
    closed = true;
    notify?.();
  });

  const nextFrame = async (): Promise<Buffer | string | undefined> => {
    while (frames.length === 0) {
      if (closed) return undefined;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      notify = undefined;
    }
    return frames.shift();
  };

  // --- 1. the "start" control frame -------------------------------------
  const first = await nextFrame();
  if (first === undefined) return;
  let start: StartFrame;
  try {
    if (typeof first !== "string") throw new Error("binary");
    const parsed = JSON.parse(first) as StartFrame;
    if (parsed.type !== "start") throw new Error("bad type");
    start = parsed;
  } catch {
    wsSend(ws, {
      type: "error",
      message: "first frame must be {\"type\": \"start\"}",
    });
    ws.close(1002);
    return;
  }
  const token = config.server.authToken;
  if (token && start.token !== token) {
    wsSend(ws, { type: "error", message: "invalid token" });
    ws.close(4401);
    return;
  }

  // --- 2. audio frames until "end", or one "text" frame ------------------
  const chunks: Buffer[] = [];
  let textInput: string | undefined;
  let mediaType = "audio/wav";
  for (;;) {
    const frame = await nextFrame();
    if (frame === undefined) return; // client went away
    if (typeof frame !== "string") {
      chunks.push(frame);
      continue;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(frame) as Record<string, unknown>;
    } catch {
      wsSend(ws, { type: "error", message: "invalid JSON frame" });
      continue;
    }
    if (msg["type"] === "end") {
      if (typeof msg["media_type"] === "string") {
        mediaType = msg["media_type"];
      }
      break;
    }
    if (msg["type"] === "text") {
      textInput = String(msg["text"] ?? "").trim();
      break;
    }
    wsSend(ws, {
      type: "error",
      message: `unexpected frame type '${String(msg["type"])}'`,
    });
  }

  // --- 3. run the pipeline and stream results back ------------------------
  let result: PipelineResult;
  try {
    if (textInput !== undefined) {
      if (!textInput) {
        wsSend(ws, { type: "error", message: "empty text" });
        ws.close(1008);
        return;
      }
      result = await pipeline.runText(textInput, {
        sessionId: start.session_id,
        lang: start.lang,
        tag: start.tag,
        llmBackend: start.llm_backend,
        ttsBackend: start.tts_backend,
        withAudio: start.with_audio !== false,
      });
    } else {
      const audio = Buffer.concat(chunks);
      if (audio.length === 0) {
        wsSend(ws, { type: "error", message: "no audio sent" });
        ws.close(1008);
        return;
      }
      result = await pipeline.runAudio(audio, {
        mediaType,
        sessionId: start.session_id,
        lang: start.lang,
        tag: start.tag,
        sttBackend: start.stt_backend,
        llmBackend: start.llm_backend,
        ttsBackend: start.tts_backend,
        withAudio: start.with_audio !== false,
      });
    }
  } catch (e) {
    if (e instanceof AdapterError || e instanceof RoutingError) {
      wsSend(ws, { type: "error", message: e.message });
      ws.close(1011);
      return;
    }
    throw e;
  }

  if (result.stt) {
    wsSend(ws, {
      type: "transcript",
      text: result.transcript,
      lang: result.lang ?? null,
      backend: result.stt.backend,
    });
  }
  wsSend(ws, {
    type: "reply",
    text: result.replyText,
    backend: result.llm.backend,
  });
  if (result.replyAudio) {
    wsSend(ws, {
      type: "audio",
      media_type: result.replyAudio.mediaType,
      size: result.replyAudio.data.length,
      backend: result.tts?.backend ?? null,
    });
    if (ws.readyState === ws.OPEN) ws.send(result.replyAudio.data);
  }
  wsSend(ws, {
    type: "done",
    session_id: result.sessionId,
    elapsed_ms: result.elapsedMs,
  });
  ws.close(1000);
}
