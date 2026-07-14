import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { parseConfig } from "../src/config.js";
import { startServer, type HearthServer } from "../src/server.js";

/**
 * All-mock hub configuration; tests bind an ephemeral localhost port via
 * the startServer port override.
 */
function testConfig(authToken?: string) {
  return parseConfig({
    server: {
      host: "127.0.0.1",
      ...(authToken ? { auth_token: authToken } : {}),
    },
    stt: { default: "mock", backends: { mock: { type: "mock" } } },
    tts: {
      default: "piper-mock",
      rules: [{ lang: "ja", backend: "voicevox-mock" }],
      backends: {
        "piper-mock": { type: "mock" },
        "voicevox-mock": { type: "mock" },
      },
    },
    llm: { default: "mock", backends: { mock: { type: "mock" } } },
  });
}

let server: HearthServer;
let base: string;

beforeAll(async () => {
  server = await startServer(testConfig(), { port: 0 });
  base = `http://127.0.0.1:${server.address.port}`;
});
afterAll(async () => {
  await server.close();
});

describe("GET /v1/health", () => {
  it("reports status, version and configured backends", async () => {
    const resp = await fetch(`${base}/v1/health`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["version"]).toBe("0.1.0");
    expect(body["backends"]).toEqual({
      stt: ["mock"],
      tts: ["piper-mock", "voicevox-mock"],
      llm: ["mock"],
    });
    expect(body["defaults"]).toEqual({
      stt: "mock",
      tts: "piper-mock",
      llm: "mock",
    });
  });
});

describe("POST /v1/chat/text", () => {
  it("runs a text turn and returns reply + base64 audio", async () => {
    const resp = await fetch(`${base}/v1/chat/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, any>;
    expect(body["reply_text"]).toBe(
      "Hello, I am Hearth, your self-hosted assistant.",
    );
    expect(body["backends"]["llm"]["backend"]).toBe("mock");
    expect(body["backends"]["tts"]["backend"]).toBe("piper-mock");
    const wav = Buffer.from(body["audio"]["data_b64"], "base64");
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("keeps session memory across requests", async () => {
    const first = await fetch(`${base}/v1/chat/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", with_audio: false }),
    });
    const sessionId = ((await first.json()) as Record<string, unknown>)[
      "session_id"
    ] as string;
    const second = await fetch(`${base}/v1/chat/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "and again",
        session_id: sessionId,
        with_audio: false,
      }),
    });
    const body = (await second.json()) as Record<string, unknown>;
    expect(body["session_id"]).toBe(sessionId);
    const session = server.pipeline.sessions.getOrCreate(sessionId);
    expect(session.messages).toHaveLength(4);
  });

  it("rejects missing text with 400", async () => {
    const resp = await fetch(`${base}/v1/chat/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
  });

  it("rejects unknown pinned backends with 400 (routing error)", async () => {
    const resp = await fetch(`${base}/v1/chat/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi", llm_backend: "nope" }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(String(body["detail"])).toContain("unknown llm backend");
  });
});

describe("POST /v1/stt", () => {
  it("transcribes an uploaded audio body (mock echoes UTF-8)", async () => {
    const resp = await fetch(`${base}/v1/stt`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: Buffer.from("turn off the lights", "utf-8"),
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, any>;
    expect(body["text"]).toBe("turn off the lights");
    expect(body["backend"]["backend"]).toBe("mock");
  });

  it("rejects an empty upload with 400", async () => {
    const resp = await fetch(`${base}/v1/stt`, { method: "POST" });
    expect(resp.status).toBe(400);
  });
});

describe("POST /v1/tts", () => {
  it("returns WAV bytes and names the serving backend", async () => {
    const resp = await fetch(`${base}/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "good evening" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("audio/wav");
    expect(resp.headers.get("x-hearth-backend")).toBe("piper-mock");
    const wav = Buffer.from(await resp.arrayBuffer());
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("routes Japanese text to the VOICEVOX-slot backend", async () => {
    const resp = await fetch(`${base}/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "こんばんは" }),
    });
    expect(resp.headers.get("x-hearth-backend")).toBe("voicevox-mock");
  });
});

describe("POST /v1/chat/audio", () => {
  it("runs the full voice turn from an audio body", async () => {
    const resp = await fetch(`${base}/v1/chat/audio?with_audio=false`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: Buffer.from("hello", "utf-8"),
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, any>;
    expect(body["transcript"]).toBe("hello");
    expect(body["backends"]["stt"]["backend"]).toBe("mock");
    expect(body["reply_text"]).toContain("Hello, I am Hearth");
    expect(body["audio"]).toBeUndefined();
  });
});

describe("auth token", () => {
  it("gates REST and WebSocket when auth_token is configured", async () => {
    const authed = await startServer(testConfig("s3cret"), { port: 0 });
    const authedBase = `http://127.0.0.1:${authed.address.port}`;
    try {
      const denied = await fetch(`${authedBase}/v1/chat/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      });
      expect(denied.status).toBe(401);

      const allowed = await fetch(`${authedBase}/v1/chat/text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer s3cret",
        },
        body: JSON.stringify({ text: "hi", with_audio: false }),
      });
      expect(allowed.status).toBe(200);

      // Health stays open (used by the phone's "test connection" button).
      const health = await fetch(`${authedBase}/v1/health`);
      expect(health.status).toBe(200);

      // WebSocket: wrong token is rejected with an error event.
      const events = await wsTurn(authed.address.port, [
        JSON.stringify({ type: "start", token: "wrong" }),
      ]);
      expect(events[0]).toMatchObject({ type: "error", message: "invalid token" });
    } finally {
      await authed.close();
    }
  });
});

// ---------------------------------------------------------------------------
// WebSocket /v1/stream
// ---------------------------------------------------------------------------

type WsEvent = Record<string, unknown> | { type: "binary"; size: number };

function wsTurn(port: number, frames: (string | Buffer)[]): Promise<WsEvent[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/stream`);
    const events: WsEvent[] = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`timeout; got ${JSON.stringify(events)}`));
    }, 5000);
    ws.on("open", () => {
      for (const frame of frames) ws.send(frame);
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        events.push({ type: "binary", size: data.length });
      } else {
        events.push(JSON.parse(data.toString("utf-8")) as Record<string, unknown>);
      }
    });
    ws.on("close", () => {
      clearTimeout(timer);
      resolve(events);
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

describe("WebSocket /v1/stream", () => {
  it("streams a full audio turn: transcript, reply, audio, done", async () => {
    const events = await wsTurn(server.address.port, [
      JSON.stringify({ type: "start" }),
      Buffer.from("hel", "utf-8"),
      Buffer.from("lo", "utf-8"),
      JSON.stringify({ type: "end", media_type: "audio/wav" }),
    ]);
    const types = events.map((e) => e["type"]);
    expect(types).toEqual(["transcript", "reply", "audio", "binary", "done"]);
    expect(events[0]).toMatchObject({ text: "hello", backend: "mock" });
    expect(events[1]).toMatchObject({
      text: "Hello, I am Hearth, your self-hosted assistant.",
    });
    const audioMeta = events[2] as Record<string, unknown>;
    const binary = events[3] as { size: number };
    expect(binary.size).toBe(audioMeta["size"]);
    expect(events[4]).toHaveProperty("session_id");
  });

  it("supports text turns that skip STT", async () => {
    const events = await wsTurn(server.address.port, [
      JSON.stringify({ type: "start", with_audio: false }),
      JSON.stringify({ type: "text", text: "こんにちは" }),
    ]);
    const types = events.map((e) => e["type"]);
    expect(types).toEqual(["reply", "done"]);
    expect(String((events[0] as Record<string, unknown>)["text"])).toContain(
      "こんにちは",
    );
  });

  it("rejects a first frame that is not 'start'", async () => {
    const events = await wsTurn(server.address.port, [
      JSON.stringify({ type: "end" }),
    ]);
    expect(events[0]).toMatchObject({ type: "error" });
  });

  it("rejects an empty utterance", async () => {
    const events = await wsTurn(server.address.port, [
      JSON.stringify({ type: "start" }),
      JSON.stringify({ type: "end" }),
    ]);
    expect(events[0]).toMatchObject({ type: "error", message: "no audio sent" });
  });
});
