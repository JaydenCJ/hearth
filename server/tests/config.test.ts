import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  ConfigError,
  loadConfig,
  mockConfig,
  parseConfig,
} from "../src/config.js";

const EXAMPLE = fileURLToPath(
  new URL("../examples/hearth.example.yaml", import.meta.url),
);

const tmp = mkdtempSync(join(tmpdir(), "hearth-config-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function minimal(): Record<string, unknown> {
  return {
    stt: { default: "mock", backends: { mock: { type: "mock" } } },
    tts: { default: "mock", backends: { mock: { type: "mock" } } },
    llm: { default: "mock", backends: { mock: { type: "mock" } } },
  };
}

describe("parseConfig", () => {
  it("accepts a minimal all-mock config and applies defaults", () => {
    const config = parseConfig(minimal());
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.port).toBe(8321);
    expect(config.stt.default).toBe("mock");
    expect(config.tts.backends["mock"]?.speed).toBe(1.0);
    expect(config.llm.backends["mock"]?.maxTokens).toBe(512);
  });

  it("binds to localhost by default (no accidental exposure)", () => {
    expect(mockConfig().server.host).toBe("127.0.0.1");
  });

  it("rejects a default that references an unknown backend", () => {
    const data = minimal();
    (data["llm"] as Record<string, unknown>)["default"] = "nope";
    expect(() => parseConfig(data)).toThrow(/nope.*not defined/);
  });

  it("rejects rules that reference unknown backends", () => {
    const data = minimal();
    (data["tts"] as Record<string, unknown>)["rules"] = [
      { lang: "ja", backend: "voicevox" },
    ];
    expect(() => parseConfig(data)).toThrow(/unknown backend 'voicevox'/);
  });

  it("rejects rules without any match condition", () => {
    const data = minimal();
    (data["llm"] as Record<string, unknown>)["rules"] = [{ backend: "mock" }];
    expect(() => parseConfig(data)).toThrow(/at least one match condition/);
  });

  it("rejects invalid regular expressions in rules", () => {
    const data = minimal();
    (data["llm"] as Record<string, unknown>)["rules"] = [
      { regex: "([", backend: "mock" },
    ];
    expect(() => parseConfig(data)).toThrow(/invalid regular expression/);
  });

  it("requires url for whisper_cpp backends", () => {
    const data = minimal();
    (data["stt"] as Record<string, unknown>)["backends"] = {
      mock: { type: "mock" },
      whisper: { type: "whisper_cpp" },
    };
    expect(() => parseConfig(data)).toThrow(/requires 'url'/);
  });

  it("requires base_url for openai_compat backends", () => {
    const data = minimal();
    (data["llm"] as Record<string, unknown>)["backends"] = {
      mock: { type: "mock" },
      local: { type: "openai_compat" },
    };
    expect(() => parseConfig(data)).toThrow(/requires 'base_url'/);
  });

  it("rejects unknown keys with the offending path", () => {
    const data = minimal();
    (data["stt"] as Record<string, unknown>)["bakends"] = {};
    expect(() => parseConfig(data)).toThrow(/unknown key 'bakends'/);
  });

  it("rejects out-of-range ports", () => {
    const data = { ...minimal(), server: { port: 70000 } };
    expect(() => parseConfig(data)).toThrow(/between 1 and 65535/);
  });

  it("rejects a missing layer section", () => {
    const data = minimal();
    delete data["tts"];
    expect(() => parseConfig(data)).toThrow(/missing required section 'tts'/);
  });
});

describe("loadConfig", () => {
  it("loads the shipped example YAML", () => {
    const config = loadConfig(EXAMPLE);
    expect(config.server.port).toBe(8321);
    expect(Object.keys(config.stt.backends).sort()).toEqual([
      "mock",
      "whisper",
    ]);
    expect(config.tts.rules[0]).toMatchObject({
      lang: "ja",
      backend: "voicevox",
    });
    expect(config.llm.rules.map((r) => r.backend)).toEqual([
      "local",
      "cloud",
      "cloud",
    ]);
    expect(config.llm.backends["local"]?.baseUrl).toBe(
      "http://127.0.0.1:11434/v1",
    );
  });

  it("loads JSON configuration files", () => {
    const path = join(tmp, "hearth.json");
    writeFileSync(path, JSON.stringify(minimal()));
    const config = loadConfig(path);
    expect(config.llm.default).toBe("mock");
  });

  it("reports missing files as ConfigError", () => {
    expect(() => loadConfig(join(tmp, "missing.yaml"))).toThrow(ConfigError);
  });

  it("reports YAML syntax errors as ConfigError", () => {
    const path = join(tmp, "broken.yaml");
    writeFileSync(path, "stt: [unclosed");
    expect(() => loadConfig(path)).toThrow(/cannot parse/);
  });
});
