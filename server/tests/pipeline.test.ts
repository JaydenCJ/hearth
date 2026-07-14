import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { HearthHub } from "../src/hub.js";
import { MAX_HISTORY_TURNS, Pipeline } from "../src/pipeline.js";

/**
 * A three-layer, all-in-process configuration with two mock TTS voices and
 * two mock LLM "models", so routing decisions are observable end to end.
 */
function routedMockHub(): HearthHub {
  return new HearthHub(
    parseConfig({
      stt: { default: "mock", backends: { mock: { type: "mock" } } },
      tts: {
        default: "piper-mock",
        rules: [{ lang: "ja", backend: "voicevox-mock" }],
        backends: {
          "piper-mock": { type: "mock" },
          "voicevox-mock": { type: "mock" },
        },
      },
      llm: {
        default: "local-mock",
        rules: [{ contains: "search the web", backend: "cloud-mock" }],
        backends: {
          "local-mock": { type: "mock" },
          "cloud-mock": { type: "mock", reply: "cloud says hi" },
        },
      },
    }),
  );
}

describe("Pipeline.runText", () => {
  it("produces a reply and synthesized audio from a text turn", async () => {
    const pipeline = new Pipeline(routedMockHub());
    const result = await pipeline.runText("hello");
    expect(result.replyText).toBe(
      "Hello, I am Hearth, your self-hosted assistant.",
    );
    expect(result.llm).toMatchObject({ backend: "local-mock" });
    expect(result.tts).toMatchObject({ backend: "piper-mock" });
    expect(result.replyAudio?.mediaType).toBe("audio/wav");
    // A real RIFF/WAVE container, not a stub.
    expect(result.replyAudio?.data.subarray(0, 4).toString("ascii")).toBe(
      "RIFF",
    );
    expect(result.sessionId).toBeTruthy();
  });

  it("routes Japanese replies to the VOICEVOX-slot backend", async () => {
    const pipeline = new Pipeline(routedMockHub());
    const result = await pipeline.runText("こんにちは");
    expect(result.lang).toBe("ja");
    expect(result.replyText).toContain("こんにちは");
    expect(result.tts).toMatchObject({
      backend: "voicevox-mock",
      reason: "rule[0]",
    });
  });

  it("routes keyword-matching utterances to the cloud-slot backend", async () => {
    const pipeline = new Pipeline(routedMockHub());
    const result = await pipeline.runText("please search the web for hearth");
    expect(result.llm).toMatchObject({ backend: "cloud-mock" });
    expect(result.replyText).toBe("cloud says hi");
  });

  it("keeps per-session conversation memory", async () => {
    const pipeline = new Pipeline(routedMockHub());
    const first = await pipeline.runText("hello", { withAudio: false });
    await pipeline.runText("second message", {
      sessionId: first.sessionId,
      withAudio: false,
    });
    const session = pipeline.sessions.getOrCreate(first.sessionId);
    expect(session.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(session.messages[2]?.content).toBe("second message");
  });

  it("bounds session history to MAX_HISTORY_TURNS pairs", async () => {
    const pipeline = new Pipeline(routedMockHub());
    let sessionId: string | undefined;
    for (let i = 0; i < MAX_HISTORY_TURNS + 5; i++) {
      const r = await pipeline.runText(`message ${i}`, {
        sessionId,
        withAudio: false,
      });
      sessionId = r.sessionId;
    }
    const session = pipeline.sessions.getOrCreate(sessionId);
    expect(session.messages.length).toBe(MAX_HISTORY_TURNS * 2);
  });

  it("skips TTS when withAudio is false", async () => {
    const pipeline = new Pipeline(routedMockHub());
    const result = await pipeline.runText("hello", { withAudio: false });
    expect(result.replyAudio).toBeUndefined();
    expect(result.tts).toBeUndefined();
  });
});

describe("Pipeline.runAudio", () => {
  it("runs the full turn: audio -> STT -> LLM -> TTS -> audio", async () => {
    const pipeline = new Pipeline(routedMockHub());
    // The mock STT transcribes UTF-8 "audio" verbatim.
    const result = await pipeline.runAudio(Buffer.from("hello", "utf-8"));
    expect(result.transcript).toBe("hello");
    expect(result.stt).toMatchObject({ backend: "mock", reason: "default" });
    expect(result.replyText).toBe(
      "Hello, I am Hearth, your self-hosted assistant.",
    );
    expect(result.replyAudio?.data.length).toBeGreaterThan(44);
  });

  it("detects Japanese from the transcript and routes TTS accordingly", async () => {
    const pipeline = new Pipeline(routedMockHub());
    const result = await pipeline.runAudio(Buffer.from("こんにちは", "utf-8"));
    expect(result.lang).toBe("ja");
    expect(result.tts).toMatchObject({ backend: "voicevox-mock" });
  });

  it("falls back to the configured transcript for binary audio", async () => {
    const hub = new HearthHub(
      parseConfig({
        stt: {
          default: "mock",
          backends: {
            mock: { type: "mock", transcript: "fixed transcript" },
          },
        },
        tts: { default: "mock", backends: { mock: { type: "mock" } } },
        llm: { default: "mock", backends: { mock: { type: "mock" } } },
      }),
    );
    const pipeline = new Pipeline(hub);
    const binary = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02]);
    const result = await pipeline.runAudio(binary);
    expect(result.transcript).toBe("fixed transcript");
  });
});
