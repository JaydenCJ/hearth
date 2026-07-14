import { describe, expect, it } from "vitest";
import { CliError, parseCliArgs } from "../src/cli.js";

describe("parseCliArgs", () => {
  it("parses the serve command with config and overrides", () => {
    const opts = parseCliArgs([
      "serve",
      "--config",
      "hearth.yaml",
      "--host",
      "0.0.0.0",
      "--port",
      "9000",
    ]);
    expect(opts).toMatchObject({
      command: "serve",
      config: "hearth.yaml",
      host: "0.0.0.0",
      port: 9000,
      mock: false,
    });
  });

  it("parses --mock and the demo audio flags", () => {
    const opts = parseCliArgs(["demo", "--mock", "--audio", "--audio-out", "r.wav"]);
    expect(opts).toMatchObject({
      command: "demo",
      mock: true,
      audio: true,
      audioOut: "r.wav",
    });
  });

  it("accepts -c as a shorthand for --config", () => {
    expect(parseCliArgs(["check-config", "-c", "x.yaml"]).config).toBe("x.yaml");
  });

  it("parses --version and --help", () => {
    expect(parseCliArgs(["--version"]).version).toBe(true);
    expect(parseCliArgs(["--help"]).help).toBe(true);
  });

  it("rejects unknown options", () => {
    expect(() => parseCliArgs(["serve", "--verbose"])).toThrow(CliError);
  });

  it("rejects out-of-range ports", () => {
    expect(() => parseCliArgs(["serve", "--port", "99999"])).toThrow(
      /between 1 and 65535/,
    );
  });

  it("rejects options that are missing their value", () => {
    expect(() => parseCliArgs(["serve", "--config"])).toThrow(
      /requires a value/,
    );
  });
});
