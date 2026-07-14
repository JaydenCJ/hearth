/**
 * Backend routing.
 *
 * Every pipeline layer (STT, TTS, LLM) owns a Router built from its
 * configuration section. For each request the router evaluates the layer's
 * rules in order against a RouteContext; the first rule whose conditions
 * all match wins. If no rule matches, the layer's default backend is used.
 * A client may also pin a backend explicitly by name, which bypasses the
 * rules entirely.
 *
 * Typical uses:
 *
 * - send Japanese utterances to VOICEVOX and everything else to Piper;
 * - keep short/private prompts on a local llama.cpp model and only route
 *   long analytical prompts to a cloud API — or never leave home at all;
 * - let the phone app tag a request (`tag: kitchen`) to pick a voice.
 */

import type { RouteRule } from "./config.js";
import { normalizeLang } from "./lang.js";

/** Raised when an explicitly requested backend does not exist. */
export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingError";
  }
}

/** Everything a rule may look at when picking a backend. */
export interface RouteContext {
  text?: string;
  /** Detected or client-declared language. */
  lang?: string;
  /** Free-form client hint ("kitchen", "car", ...). */
  tag?: string;
}

/** The outcome of a routing pass, kept for observability. */
export interface RouteDecision {
  backend: string;
  /** "explicit" | "rule[<i>]" | "default" */
  reason: string;
  rule?: RouteRule;
}

/** True when *all* conditions present on the rule hold for the context. */
export function ruleMatches(rule: RouteRule, ctx: RouteContext): boolean {
  const text = ctx.text ?? "";
  if (rule.lang !== undefined) {
    if (normalizeLang(ctx.lang) !== normalizeLang(rule.lang)) return false;
  }
  if (rule.contains !== undefined) {
    if (!text.toLowerCase().includes(rule.contains.toLowerCase())) return false;
  }
  if (rule.regex !== undefined) {
    if (!new RegExp(rule.regex).test(text)) return false;
  }
  if (rule.maxChars !== undefined) {
    if (text.length > rule.maxChars) return false;
  }
  if (rule.minChars !== undefined) {
    if (text.length < rule.minChars) return false;
  }
  if (rule.tag !== undefined) {
    if (ctx.tag !== rule.tag) return false;
  }
  return true;
}

/** Order-sensitive first-match router over a set of named backends. */
export class Router {
  readonly layer: string;
  readonly backends: ReadonlySet<string>;
  readonly default: string;
  private readonly rules: RouteRule[];

  constructor(
    layer: string,
    backends: Iterable<string>,
    rules: RouteRule[],
    defaultBackend: string,
  ) {
    this.layer = layer;
    this.backends = new Set(backends);
    this.rules = [...rules];
    this.default = defaultBackend;
  }

  /**
   * Pick a backend for `ctx`. `explicit` pins a backend by name (client
   * override) and must name a configured backend, otherwise RoutingError
   * is thrown.
   */
  route(ctx: RouteContext, explicit?: string): RouteDecision {
    if (explicit !== undefined && explicit !== null) {
      if (!this.backends.has(explicit)) {
        throw new RoutingError(
          `unknown ${this.layer} backend '${explicit}' ` +
            `(known: ${[...this.backends].sort().join(", ")})`,
        );
      }
      return { backend: explicit, reason: "explicit" };
    }
    for (const [i, rule] of this.rules.entries()) {
      if (ruleMatches(rule, ctx)) {
        return { backend: rule.backend, reason: `rule[${i}]`, rule };
      }
    }
    return { backend: this.default, reason: "default" };
  }
}
