/**
 * Configuration loading and validation for Hearth.
 *
 * Configuration is a YAML or JSON document with four top-level sections:
 *
 * - `server` — bind host/port for the hub itself (defaults to 127.0.0.1).
 * - `stt` / `tts` / `llm` — one block per pipeline layer. Each block
 *   declares named `backends` (each with a `type` selecting an adapter),
 *   a `default` backend name, and optional routing `rules` that pick a
 *   backend per request (see routing.ts).
 *
 * Every layer is swappable and routable — that is the core promise of the
 * three-layer architecture. Validation is hand-rolled and strict: unknown
 * keys, missing URLs and dangling backend references are all rejected with
 * a message that names the offending path.
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/** Raised when a configuration file is missing, malformed or invalid. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ---------------------------------------------------------------------------
// Validated configuration shapes
// ---------------------------------------------------------------------------

/**
 * A single routing rule. All specified match conditions must hold (logical
 * AND) for the rule to fire. The first matching rule wins; otherwise the
 * layer's `default` backend is used.
 */
export interface RouteRule {
  backend: string;
  /** BCP-47-ish language code, e.g. "ja", "en". */
  lang?: string;
  /** Case-insensitive substring of the text. */
  contains?: string;
  /** Regular expression searched in the text. */
  regex?: string;
  /** Text length <= N. */
  maxChars?: number;
  /** Text length >= N. */
  minChars?: number;
  /** Explicit client-provided routing tag. */
  tag?: string;
}

export interface SttBackendConfig {
  type: "whisper_cpp" | "mock";
  /** Base URL of the whisper.cpp server (required for whisper_cpp). */
  url?: string;
  /** Language hint forwarded to the backend ("auto" by default). */
  language: string;
  /** Fixed transcript returned by the mock for binary input. */
  transcript?: string;
}

export interface TtsBackendConfig {
  type: "piper" | "voicevox" | "mock";
  url?: string;
  /** Piper voice/model name. */
  voice?: string;
  /** VOICEVOX speaker (style) id. */
  speaker: number;
  /** Speaking speed multiplier. */
  speed: number;
}

export interface LlmBackendConfig {
  type: "openai_compat" | "mock";
  /** OpenAI-compatible base URL, e.g. http://127.0.0.1:11434/v1 */
  baseUrl?: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  /** Fixed reply returned by the mock. */
  reply?: string;
}

export interface LayerConfig<B> {
  default: string;
  rules: RouteRule[];
  backends: Record<string, B>;
}

export interface ServerConfig {
  host: string;
  port: number;
  /**
   * Optional shared-secret token. When set, REST calls must send
   * "Authorization: Bearer <token>" and WebSocket clients must pass it in
   * the first control frame.
   */
  authToken?: string;
}

/** Root configuration object. */
export interface HearthConfig {
  server: ServerConfig;
  stt: LayerConfig<SttBackendConfig>;
  tts: LayerConfig<TtsBackendConfig>;
  llm: LayerConfig<LlmBackendConfig>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(path: string, message: string): never {
  throw new ConfigError(`${path}: ${message}`);
}

function optString(obj: Raw, key: string, path: string): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(`${path}.${key}`, "must be a string");
  return v;
}

function optNumber(obj: Raw, key: string, path: string): number | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || Number.isNaN(v)) {
    fail(`${path}.${key}`, "must be a number");
  }
  return v;
}

function checkKeys(obj: Raw, allowed: string[], path: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      fail(path, `unknown key '${key}' (allowed: ${allowed.join(", ")})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section parsers
// ---------------------------------------------------------------------------

const RULE_KEYS = [
  "backend",
  "lang",
  "contains",
  "regex",
  "max_chars",
  "min_chars",
  "tag",
];

function parseRule(raw: unknown, path: string): RouteRule {
  if (!isObject(raw)) fail(path, "must be a mapping");
  checkKeys(raw, RULE_KEYS, path);
  const backend = optString(raw, "backend", path);
  if (!backend) fail(path, "missing required key 'backend'");
  const rule: RouteRule = { backend };
  rule.lang = optString(raw, "lang", path);
  rule.contains = optString(raw, "contains", path);
  rule.regex = optString(raw, "regex", path);
  rule.maxChars = optNumber(raw, "max_chars", path);
  rule.minChars = optNumber(raw, "min_chars", path);
  rule.tag = optString(raw, "tag", path);
  if (rule.maxChars !== undefined && rule.maxChars < 0) {
    fail(`${path}.max_chars`, "must be >= 0");
  }
  if (rule.minChars !== undefined && rule.minChars < 0) {
    fail(`${path}.min_chars`, "must be >= 0");
  }
  if (rule.regex !== undefined) {
    try {
      new RegExp(rule.regex);
    } catch (e) {
      fail(`${path}.regex`, `invalid regular expression: ${String(e)}`);
    }
  }
  const hasCondition =
    rule.lang !== undefined ||
    rule.contains !== undefined ||
    rule.regex !== undefined ||
    rule.maxChars !== undefined ||
    rule.minChars !== undefined ||
    rule.tag !== undefined;
  if (!hasCondition) {
    fail(
      path,
      "routing rule must define at least one match condition " +
        "(lang, contains, regex, max_chars, min_chars, tag)",
    );
  }
  return rule;
}

function parseSttBackend(raw: unknown, path: string): SttBackendConfig {
  if (!isObject(raw)) fail(path, "must be a mapping");
  checkKeys(raw, ["type", "url", "language", "transcript"], path);
  const type = optString(raw, "type", path);
  if (type !== "whisper_cpp" && type !== "mock") {
    fail(`${path}.type`, "must be 'whisper_cpp' or 'mock'");
  }
  const url = optString(raw, "url", path);
  if (type === "whisper_cpp" && !url) {
    fail(path, "whisper_cpp backend requires 'url'");
  }
  return {
    type,
    url,
    language: optString(raw, "language", path) ?? "auto",
    transcript: optString(raw, "transcript", path),
  };
}

function parseTtsBackend(raw: unknown, path: string): TtsBackendConfig {
  if (!isObject(raw)) fail(path, "must be a mapping");
  checkKeys(raw, ["type", "url", "voice", "speaker", "speed"], path);
  const type = optString(raw, "type", path);
  if (type !== "piper" && type !== "voicevox" && type !== "mock") {
    fail(`${path}.type`, "must be 'piper', 'voicevox' or 'mock'");
  }
  const url = optString(raw, "url", path);
  if ((type === "piper" || type === "voicevox") && !url) {
    fail(path, `${type} backend requires 'url'`);
  }
  const speed = optNumber(raw, "speed", path) ?? 1.0;
  if (speed <= 0) fail(`${path}.speed`, "must be > 0");
  return {
    type,
    url,
    voice: optString(raw, "voice", path),
    speaker: optNumber(raw, "speaker", path) ?? 1,
    speed,
  };
}

function parseLlmBackend(raw: unknown, path: string): LlmBackendConfig {
  if (!isObject(raw)) fail(path, "must be a mapping");
  checkKeys(
    raw,
    [
      "type",
      "base_url",
      "model",
      "api_key",
      "temperature",
      "max_tokens",
      "system_prompt",
      "reply",
    ],
    path,
  );
  const type = optString(raw, "type", path);
  if (type !== "openai_compat" && type !== "mock") {
    fail(`${path}.type`, "must be 'openai_compat' or 'mock'");
  }
  const baseUrl = optString(raw, "base_url", path);
  if (type === "openai_compat" && !baseUrl) {
    fail(path, "openai_compat backend requires 'base_url'");
  }
  const temperature = optNumber(raw, "temperature", path) ?? 0.7;
  if (temperature < 0 || temperature > 2) {
    fail(`${path}.temperature`, "must be between 0 and 2");
  }
  const maxTokens = optNumber(raw, "max_tokens", path) ?? 512;
  if (maxTokens <= 0) fail(`${path}.max_tokens`, "must be > 0");
  return {
    type,
    baseUrl,
    model: optString(raw, "model", path) ?? "default",
    apiKey: optString(raw, "api_key", path),
    temperature,
    maxTokens,
    systemPrompt: optString(raw, "system_prompt", path),
    reply: optString(raw, "reply", path),
  };
}

function parseLayer<B>(
  raw: unknown,
  path: string,
  parseBackend: (raw: unknown, path: string) => B,
): LayerConfig<B> {
  if (!isObject(raw)) fail(path, "must be a mapping");
  checkKeys(raw, ["default", "rules", "backends"], path);
  const backendsRaw = raw["backends"];
  if (!isObject(backendsRaw) || Object.keys(backendsRaw).length === 0) {
    fail(`${path}.backends`, "must be a non-empty mapping of named backends");
  }
  const backends: Record<string, B> = {};
  for (const [name, cfg] of Object.entries(backendsRaw)) {
    backends[name] = parseBackend(cfg, `${path}.backends.${name}`);
  }
  const def = optString(raw, "default", path);
  if (!def) fail(path, "missing required key 'default'");
  if (!(def in backends)) {
    fail(
      `${path}.default`,
      `backend '${def}' is not defined (known: ${Object.keys(backends).sort().join(", ")})`,
    );
  }
  const rulesRaw = raw["rules"] ?? [];
  if (!Array.isArray(rulesRaw)) fail(`${path}.rules`, "must be a list");
  const rules = rulesRaw.map((r, i) => parseRule(r, `${path}.rules[${i}]`));
  for (const [i, rule] of rules.entries()) {
    if (!(rule.backend in backends)) {
      fail(
        `${path}.rules[${i}]`,
        `references unknown backend '${rule.backend}' ` +
          `(known: ${Object.keys(backends).sort().join(", ")})`,
      );
    }
  }
  return { default: def, rules, backends };
}

function parseServer(raw: unknown): ServerConfig {
  const defaults: ServerConfig = { host: "127.0.0.1", port: 8321 };
  if (raw === undefined || raw === null) return defaults;
  if (!isObject(raw)) fail("server", "must be a mapping");
  checkKeys(raw, ["host", "port", "auth_token"], "server");
  const port = optNumber(raw, "port", "server") ?? defaults.port;
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
    fail("server.port", "must be an integer between 1 and 65535");
  }
  return {
    host: optString(raw, "host", "server") ?? defaults.host,
    port,
    authToken: optString(raw, "auth_token", "server"),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate an already-parsed mapping into a HearthConfig. */
export function parseConfig(data: unknown): HearthConfig {
  if (!isObject(data)) throw new ConfigError("top level must be a mapping");
  checkKeys(data, ["server", "stt", "tts", "llm"], "config");
  for (const section of ["stt", "tts", "llm"]) {
    if (!(section in data)) {
      throw new ConfigError(`missing required section '${section}'`);
    }
  }
  return {
    server: parseServer(data["server"]),
    stt: parseLayer(data["stt"], "stt", parseSttBackend),
    tts: parseLayer(data["tts"], "tts", parseTtsBackend),
    llm: parseLayer(data["llm"], "llm", parseLlmBackend),
  };
}

/** Load a YAML (.yaml/.yml) or JSON (.json) configuration file. */
export function loadConfig(path: string): HearthConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    throw new ConfigError(`configuration file not found: ${path}`);
  }
  let data: unknown;
  try {
    data = path.toLowerCase().endsWith(".json")
      ? JSON.parse(text)
      : parseYaml(text);
  } catch (e) {
    throw new ConfigError(`cannot parse ${path}: ${String(e)}`);
  }
  return parseConfig(data);
}

/**
 * A fully in-process configuration: every layer uses its mock backend.
 * Used by `hearth serve --mock`, `hearth demo --mock` and the test-suite;
 * needs no hardware and no external services.
 */
export function mockConfig(): HearthConfig {
  return parseConfig({
    server: { host: "127.0.0.1", port: 8321 },
    stt: { default: "mock", backends: { mock: { type: "mock" } } },
    tts: { default: "mock", backends: { mock: { type: "mock" } } },
    llm: { default: "mock", backends: { mock: { type: "mock" } } },
  });
}
