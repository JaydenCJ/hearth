#!/usr/bin/env node
/**
 * Hearth command-line interface.
 *
 * Commands:
 *
 * - `hearth serve --config hearth.yaml` — run the hub server.
 * - `hearth serve --mock`               — run with all-mock backends (no
 *   hardware, no external services; great for trying the API and the app).
 * - `hearth demo [--mock|--config ...]` — interactive text chat against
 *   the pipeline in-process (no server needed).
 * - `hearth check-config --config ...`  — validate a config file and print
 *   the resolved backends and routing rules.
 */

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  ConfigError,
  loadConfig,
  mockConfig,
  type HearthConfig,
} from "./config.js";
import { HearthHub } from "./hub.js";
import { Pipeline } from "./pipeline.js";
import { startServer } from "./server.js";
import { VERSION } from "./version.js";

const USAGE = `hearth ${VERSION} — self-hosted voice assistant hub. Your voice never leaves home.

Usage:
  hearth serve (--config PATH | --mock) [--host HOST] [--port PORT]
  hearth demo (--config PATH | --mock) [--audio [--audio-out PATH]]
  hearth check-config --config PATH
  hearth --version
  hearth --help

Commands:
  serve         run the hub server (REST + WebSocket on /v1)
  demo          interactive text chat against the in-process pipeline
  check-config  validate a configuration file and print the resolved layers

Options:
  --config, -c PATH   path to hearth.yaml / hearth.json
  --mock              use all-mock backends (no hardware, no services)
  --host HOST         override the bind host from the config
  --port PORT         override the bind port from the config
  --audio             demo: also synthesize each reply to --audio-out
  --audio-out PATH    demo: reply audio path (default: hearth-reply.wav)
`;

export interface CliOptions {
  command?: string;
  config?: string;
  mock: boolean;
  host?: string;
  port?: number;
  audio: boolean;
  audioOut: string;
  version: boolean;
  help: boolean;
}

/** Parse argv (without the node/script prefix) into CLI options. */
export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    mock: false,
    audio: false,
    audioOut: "hearth-reply.wav",
    version: false,
    help: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const next = (): string => {
      i += 1;
      const v = argv[i];
      if (v === undefined) throw new CliError(`${arg} requires a value`);
      return v;
    };
    switch (arg) {
      case "--config":
      case "-c":
        opts.config = next();
        break;
      case "--mock":
        opts.mock = true;
        break;
      case "--host":
        opts.host = next();
        break;
      case "--port": {
        const port = Number(next());
        if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
          throw new CliError("--port must be an integer between 1 and 65535");
        }
        opts.port = port;
        break;
      }
      case "--audio":
        opts.audio = true;
        break;
      case "--audio-out":
        opts.audioOut = next();
        break;
      case "--version":
        opts.version = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        if (arg.startsWith("-")) throw new CliError(`unknown option: ${arg}`);
        positional.push(arg);
    }
  }
  opts.command = positional[0];
  if (positional.length > 1) {
    throw new CliError(`unexpected argument: ${positional[1]}`);
  }
  return opts;
}

export class CliError extends Error {}

function loadFromOptions(opts: CliOptions): HearthConfig {
  if (opts.mock) return mockConfig();
  if (!opts.config) {
    throw new CliError(
      "--config PATH is required (or pass --mock for the zero-hardware " +
        "demo configuration)",
    );
  }
  return loadConfig(opts.config);
}

async function cmdServe(opts: CliOptions): Promise<number> {
  const config = loadFromOptions(opts);
  const server = await startServer(config, {
    host: opts.host,
    port: opts.port,
  });
  const { host, port } = server.address;
  const layers = [
    ["STT", config.stt],
    ["TTS", config.tts],
    ["LLM", config.llm],
  ] as const;
  console.log(`Hearth v${VERSION} listening on http://${host}:${port}`);
  for (const [label, layer] of layers) {
    const names = Object.keys(layer.backends).sort().join(", ");
    console.log(`  ${label} backends: [${names}] (default: ${layer.default})`);
  }
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      server.close().then(resolve, resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

async function cmdDemo(opts: CliOptions): Promise<number> {
  const config = loadFromOptions(opts);
  const hub = new HearthHub(config);
  const pipeline = new Pipeline(hub);
  let sessionId: string | undefined;

  console.log(
    `Hearth v${VERSION} demo — type a message, Ctrl-D or 'exit' to quit.`,
  );
  const interactive = process.stdin.isTTY === true;
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "you: ",
    terminal: interactive,
  });
  if (interactive) rl.prompt();
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) {
      if (interactive) rl.prompt();
      continue;
    }
    if (line.toLowerCase() === "exit" || line.toLowerCase() === "quit") break;
    // Echo piped input so non-interactive transcripts read like a session.
    if (!interactive) console.log(`you: ${line}`);
    const result = await pipeline.runText(line, {
      sessionId,
      withAudio: opts.audio,
    });
    sessionId = result.sessionId;
    let info = `[llm=${result.llm.backend}`;
    if (result.tts) info += ` tts=${result.tts.backend}`;
    info += ` ${result.elapsedMs}ms]`;
    if (opts.audio && result.replyAudio) {
      writeFileSync(opts.audioOut, result.replyAudio.data);
      info += ` audio -> ${opts.audioOut}`;
    }
    console.log(`hearth ${info}: ${result.replyText}`);
    if (interactive) rl.prompt();
  }
  rl.close();
  return 0;
}

function cmdCheckConfig(opts: CliOptions): number {
  const config = loadFromOptions(opts);
  console.log("configuration OK");
  const layers = [
    ["stt", config.stt],
    ["tts", config.tts],
    ["llm", config.llm],
  ] as const;
  for (const [name, layer] of layers) {
    console.log(`${name}:`);
    for (const [backendName, backend] of Object.entries(layer.backends)) {
      const marker = backendName === layer.default ? " (default)" : "";
      console.log(`  backend ${backendName}: type=${backend.type}${marker}`);
    }
    for (const [i, rule] of layer.rules.entries()) {
      const conditions = Object.entries(rule)
        .filter(([k, v]) => k !== "backend" && v !== undefined)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      console.log(`  rule[${i}]: ${conditions} -> ${rule.backend}`);
    }
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseCliArgs(argv);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }
  if (opts.version) {
    console.log(`hearth ${VERSION}`);
    return 0;
  }
  if (opts.help || !opts.command) {
    console.log(USAGE);
    return opts.help ? 0 : 2;
  }
  try {
    switch (opts.command) {
      case "serve":
        return await cmdServe(opts);
      case "demo":
        return await cmdDemo(opts);
      case "check-config":
        return cmdCheckConfig(opts);
      default:
        console.error(`error: unknown command '${opts.command}'`);
        console.error(USAGE);
        return 2;
    }
  } catch (e) {
    if (e instanceof ConfigError || e instanceof CliError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`error: ${String(e)}`);
      process.exitCode = 1;
    },
  );
}
