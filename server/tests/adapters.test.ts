import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { MockLlmAdapter } from "../src/adapters/llm/mock.js";
import { OpenAiCompatAdapter } from "../src/adapters/llm/openaiCompat.js";
import { MockSttAdapter } from "../src/adapters/stt/mock.js";
import { WhisperCppAdapter } from "../src/adapters/stt/whisperCpp.js";
import { MockTtsAdapter, sineWav } from "../src/adapters/tts/mock.js";
import { PiperAdapter } from "../src/adapters/tts/piper.js";
import { VoicevoxAdapter } from "../src/adapters/tts/voicevox.js";
import { AdapterError } from "../src/adapters/types.js";

// ---------------------------------------------------------------------------
// A tiny local fake engine: one HTTP server on 127.0.0.1 that plays the
// roles of whisper.cpp, Piper, VOICEVOX and an OpenAI-compatible endpoint.
// Per §mock policy, HTTP adapters are tested against localhost only.
// ---------------------------------------------------------------------------

interface Seen {
  path: string;
  contentType: string;
  authorization?: string;
  body: Buffer;
}

const seen: Seen[] = [];

const fake: Server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    seen.push({
      path: req.url ?? "",
      contentType: req.headers["content-type"] ?? "",
      authorization: req.headers.authorization,
      body,
    });
    const path = (req.url ?? "").split("?")[0];
    switch (path) {
      case "/inference":
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ text: " fake transcript ", language: "en" }));
        return;
      case "/": // Piper synthesis
        res.setHeader("Content-Type", "audio/wav");
        res.end(sineWav(0.05));
        return;
      case "/audio_query":
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ accent_phrases: [], outputSamplingRate: 24000 }));
        return;
      case "/synthesis":
        res.setHeader("Content-Type", "audio/wav");
        res.end(sineWav(0.05, 523.25));
        return;
      case "/v1/chat/completions":
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: " fake reply " } }],
          }),
        );
        return;
      case "/broken":
        res.statusCode = 500;
        res.end("boom");
        return;
      default:
        res.statusCode = 404;
        res.end("not found");
    }
  });
});

const baseUrl = await new Promise<string>((resolve) => {
  fake.listen(0, "127.0.0.1", () => {
    const { port } = fake.address() as AddressInfo;
    resolve(`http://127.0.0.1:${port}`);
  });
});
afterAll(() => new Promise<void>((r) => fake.close(() => r())));

// ---------------------------------------------------------------------------
// whisper.cpp
// ---------------------------------------------------------------------------

describe("WhisperCppAdapter", () => {
  it("builds a multipart /inference request with language and format", () => {
    const adapter = new WhisperCppAdapter("http://127.0.0.1:8081/", {
      language: "auto",
    });
    const req = adapter.buildRequest(Buffer.from("x"), {
      mediaType: "audio/ogg",
      lang: "ja",
    });
    expect(req.url).toBe("http://127.0.0.1:8081/inference");
    expect(req.fields).toEqual({
      filename: "audio.ogg",
      language: "ja",
      responseFormat: "json",
    });
    expect(req.form.get("language")).toBe("ja");
    expect(req.form.get("response_format")).toBe("json");
    expect(req.form.get("file")).toBeInstanceOf(Blob);
  });

  it("defaults unknown media types to a .wav filename", () => {
    const adapter = new WhisperCppAdapter("http://127.0.0.1:8081");
    const req = adapter.buildRequest(Buffer.from("x"), {
      mediaType: "application/octet-stream",
    });
    expect(req.fields.filename).toBe("audio.wav");
    expect(req.fields.language).toBe("auto");
  });

  it("transcribes through a live (fake) server and trims the text", async () => {
    const adapter = new WhisperCppAdapter(baseUrl);
    const result = await adapter.transcribe(Buffer.from("audio-bytes"));
    expect(result).toEqual({ text: "fake transcript", lang: "en" });
    const last = seen.at(-1);
    expect(last?.path).toBe("/inference");
    expect(last?.contentType).toContain("multipart/form-data");
    expect(last?.body.toString("utf-8")).toContain("audio-bytes");
  });

  it("maps HTTP errors to AdapterError with layer metadata", async () => {
    const adapter = new WhisperCppAdapter(`${baseUrl}/broken/nested`);
    await expect(adapter.transcribe(Buffer.from("x"))).rejects.toThrow(
      AdapterError,
    );
    await expect(adapter.transcribe(Buffer.from("x"))).rejects.toMatchObject({
      layer: "stt",
      backend: "whisper_cpp",
    });
  });
});

// ---------------------------------------------------------------------------
// Piper
// ---------------------------------------------------------------------------

describe("PiperAdapter", () => {
  it("builds the JSON body with voice and inverted speed", () => {
    const adapter = new PiperAdapter("http://127.0.0.1:5000", {
      voice: "en_US-lessac-medium",
      speed: 2.0,
    });
    const req = adapter.buildRequest("hello");
    expect(req.url).toBe("http://127.0.0.1:5000/");
    expect(req.body).toEqual({
      text: "hello",
      voice: "en_US-lessac-medium",
      length_scale: 0.5,
    });
  });

  it("omits optional fields at their defaults", () => {
    const adapter = new PiperAdapter("http://127.0.0.1:5000");
    expect(adapter.buildRequest("hi").body).toEqual({ text: "hi" });
  });

  it("synthesizes WAV bytes through a live (fake) server", async () => {
    const adapter = new PiperAdapter(baseUrl);
    const clip = await adapter.synthesize("hello");
    expect(clip.mediaType).toBe("audio/wav");
    expect(clip.data.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(JSON.parse(seen.at(-1)?.body.toString("utf-8") ?? "{}")).toEqual({
      text: "hello",
    });
  });
});

// ---------------------------------------------------------------------------
// VOICEVOX
// ---------------------------------------------------------------------------

describe("VoicevoxAdapter", () => {
  it("builds the two-step audio_query / synthesis requests", () => {
    const adapter = new VoicevoxAdapter("http://127.0.0.1:50021", {
      speaker: 3,
      speed: 1.2,
    });
    const queryUrl = adapter.buildQueryUrl("こんにちは");
    expect(queryUrl).toBe(
      "http://127.0.0.1:50021/audio_query?text=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF&speaker=3",
    );
    const synth = adapter.buildSynthesisRequest({ pitch: 0 });
    expect(synth.url).toBe("http://127.0.0.1:50021/synthesis?speaker=3");
    expect(synth.body).toEqual({ pitch: 0, speedScale: 1.2 });
  });

  it("leaves speedScale untouched at speed 1.0", () => {
    const adapter = new VoicevoxAdapter("http://127.0.0.1:50021");
    expect(adapter.buildSynthesisRequest({ pitch: 0 }).body).toEqual({
      pitch: 0,
    });
  });

  it("synthesizes through the two-step flow on a live (fake) server", async () => {
    const adapter = new VoicevoxAdapter(baseUrl, { speaker: 1 });
    const clip = await adapter.synthesize("ずんだもんです");
    expect(clip.data.subarray(0, 4).toString("ascii")).toBe("RIFF");
    const paths = seen.slice(-2).map((s) => s.path.split("?")[0]);
    expect(paths).toEqual(["/audio_query", "/synthesis"]);
  });
});

// ---------------------------------------------------------------------------
// OpenAI-compatible LLM
// ---------------------------------------------------------------------------

describe("OpenAiCompatAdapter", () => {
  it("builds the chat request with model, sampling and bearer auth", () => {
    const adapter = new OpenAiCompatAdapter("http://127.0.0.1:11434/v1/", {
      model: "qwen2.5:7b",
      apiKey: "k-123",
      temperature: 0.2,
      maxTokens: 128,
    });
    const req = adapter.buildRequest([{ role: "user", content: "hi" }]);
    expect(req.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(req.headers["Authorization"]).toBe("Bearer k-123");
    expect(req.body).toEqual({
      model: "qwen2.5:7b",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      max_tokens: 128,
    });
  });

  it("injects the configured system prompt only when none is present", () => {
    const adapter = new OpenAiCompatAdapter("http://127.0.0.1:11434/v1", {
      systemPrompt: "be brief",
    });
    const injected = adapter.buildRequest([{ role: "user", content: "hi" }]);
    expect(injected.body.messages[0]).toEqual({
      role: "system",
      content: "be brief",
    });
    const kept = adapter.buildRequest([
      { role: "system", content: "existing" },
      { role: "user", content: "hi" },
    ]);
    expect(kept.body.messages[0]).toEqual({
      role: "system",
      content: "existing",
    });
    expect(kept.body.messages).toHaveLength(2);
  });

  it("omits the Authorization header for keyless local servers", () => {
    const adapter = new OpenAiCompatAdapter("http://127.0.0.1:8080/v1");
    const req = adapter.buildRequest([{ role: "user", content: "hi" }]);
    expect(req.headers["Authorization"]).toBeUndefined();
  });

  it("chats through a live (fake) server and trims the reply", async () => {
    const adapter = new OpenAiCompatAdapter(`${baseUrl}/v1`);
    const reply = await adapter.chat([{ role: "user", content: "hi" }]);
    expect(reply).toBe("fake reply");
  });

  it("maps unexpected payloads to AdapterError", async () => {
    const adapter = new OpenAiCompatAdapter(baseUrl, {
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await expect(adapter.chat([{ role: "user", content: "x" }])).rejects.toThrow(
      /unexpected payload/,
    );
  });
});

// ---------------------------------------------------------------------------
// Mocks (deterministic in-process backends)
// ---------------------------------------------------------------------------

describe("mock adapters", () => {
  it("MockSttAdapter transcribes UTF-8 audio verbatim", async () => {
    const stt = new MockSttAdapter();
    const result = await stt.transcribe(Buffer.from("  hello hub  ", "utf-8"));
    expect(result).toEqual({ text: "hello hub", lang: "en" });
  });

  it("MockSttAdapter detects Japanese text", async () => {
    const stt = new MockSttAdapter();
    const result = await stt.transcribe(Buffer.from("今何時ですか", "utf-8"));
    expect(result.lang).toBe("ja");
  });

  it("MockSttAdapter falls back to the fixed transcript on binary input", async () => {
    const stt = new MockSttAdapter({ transcript: "canned" });
    const result = await stt.transcribe(Buffer.from([0x00, 0xff, 0x00]));
    expect(result.text).toBe("canned");
  });

  it("MockTtsAdapter renders a valid RIFF/WAVE container", async () => {
    const tts = new MockTtsAdapter();
    const clip = await tts.synthesize("hello world");
    expect(clip.data.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(clip.data.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(clip.sampleRate).toBe(16000);
    // Longer text yields a longer clip.
    const longer = await tts.synthesize("h".repeat(200));
    expect(longer.data.length).toBeGreaterThan(clip.data.length);
  });

  it("MockLlmAdapter returns deterministic canned replies", async () => {
    const llm = new MockLlmAdapter();
    await expect(
      llm.chat([{ role: "user", content: "hello" }]),
    ).resolves.toBe("Hello, I am Hearth, your self-hosted assistant.");
    await expect(
      llm.chat([{ role: "user", content: "unmatched input" }]),
    ).resolves.toBe("You said: unmatched input (mock reply)");
    const fixed = new MockLlmAdapter({ reply: "always this" });
    await expect(fixed.chat([])).resolves.toBe("always this");
  });
});
