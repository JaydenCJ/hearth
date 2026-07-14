import { describe, expect, it } from "vitest";
import { Router, RoutingError, ruleMatches } from "../src/routing.js";

describe("ruleMatches", () => {
  it("matches language by primary subtag, case-insensitively", () => {
    const rule = { backend: "b", lang: "ja" };
    expect(ruleMatches(rule, { lang: "ja" })).toBe(true);
    expect(ruleMatches(rule, { lang: "ja-JP" })).toBe(true);
    expect(ruleMatches(rule, { lang: "JA_jp" })).toBe(true);
    expect(ruleMatches(rule, { lang: "en" })).toBe(false);
    expect(ruleMatches(rule, {})).toBe(false);
  });

  it("matches substrings case-insensitively", () => {
    const rule = { backend: "b", contains: "Search The Web" };
    expect(ruleMatches(rule, { text: "please search the web for X" })).toBe(
      true,
    );
    expect(ruleMatches(rule, { text: "what time is it" })).toBe(false);
  });

  it("matches regular expressions", () => {
    const rule = { backend: "b", regex: "\\d{4}-\\d{2}" };
    expect(ruleMatches(rule, { text: "since 2026-07" })).toBe(true);
    expect(ruleMatches(rule, { text: "since july" })).toBe(false);
  });

  it("matches text length bounds", () => {
    expect(ruleMatches({ backend: "b", maxChars: 5 }, { text: "hey" })).toBe(
      true,
    );
    expect(
      ruleMatches({ backend: "b", maxChars: 5 }, { text: "hello there" }),
    ).toBe(false);
    expect(
      ruleMatches({ backend: "b", minChars: 5 }, { text: "hello there" }),
    ).toBe(true);
    expect(ruleMatches({ backend: "b", minChars: 5 }, { text: "hey" })).toBe(
      false,
    );
  });

  it("matches tags exactly", () => {
    const rule = { backend: "b", tag: "kitchen" };
    expect(ruleMatches(rule, { tag: "kitchen" })).toBe(true);
    expect(ruleMatches(rule, { tag: "car" })).toBe(false);
    expect(ruleMatches(rule, {})).toBe(false);
  });

  it("requires ALL conditions on a rule to hold (logical AND)", () => {
    const rule = { backend: "b", lang: "ja", minChars: 10 };
    expect(ruleMatches(rule, { lang: "ja", text: "こんにちは、元気ですか" })).toBe(
      true,
    );
    expect(ruleMatches(rule, { lang: "ja", text: "はい" })).toBe(false);
    expect(
      ruleMatches(rule, { lang: "en", text: "long enough text here" }),
    ).toBe(false);
  });
});

describe("Router", () => {
  const router = new Router(
    "llm",
    ["local", "cloud", "mock"],
    [
      { tag: "private", backend: "local" },
      { contains: "search the web", backend: "cloud" },
      { minChars: 400, backend: "cloud" },
    ],
    "local",
  );

  it("falls back to the default when no rule matches", () => {
    const decision = router.route({ text: "what time is it" });
    expect(decision).toMatchObject({ backend: "local", reason: "default" });
  });

  it("uses the first matching rule (order-sensitive)", () => {
    // "private" tag outranks the cloud rules even for long texts.
    const decision = router.route({
      text: "search the web for " + "x".repeat(500),
      tag: "private",
    });
    expect(decision).toMatchObject({ backend: "local", reason: "rule[0]" });
  });

  it("routes keyword and length rules to the cloud backend", () => {
    expect(router.route({ text: "search the web for cats" }).backend).toBe(
      "cloud",
    );
    const long = router.route({ text: "a".repeat(400) });
    expect(long).toMatchObject({ backend: "cloud", reason: "rule[2]" });
  });

  it("lets clients pin a backend explicitly, bypassing rules", () => {
    const decision = router.route({ text: "search the web" }, "mock");
    expect(decision).toMatchObject({ backend: "mock", reason: "explicit" });
  });

  it("raises RoutingError for unknown explicit backends", () => {
    expect(() => router.route({}, "gpu-cluster")).toThrow(RoutingError);
    expect(() => router.route({}, "gpu-cluster")).toThrow(
      /unknown llm backend 'gpu-cluster'/,
    );
  });
});
