/**
 * Public API of the hearth-server package.
 *
 * Most users run the `hearth` CLI, but everything is importable for
 * embedding the hub in another Node application.
 */

export {
  ConfigError,
  loadConfig,
  mockConfig,
  parseConfig,
} from "./config.js";
export type {
  HearthConfig,
  LayerConfig,
  LlmBackendConfig,
  RouteRule,
  ServerConfig,
  SttBackendConfig,
  TtsBackendConfig,
} from "./config.js";
export { Router, RoutingError, ruleMatches } from "./routing.js";
export type { RouteContext, RouteDecision } from "./routing.js";
export { guessLang, normalizeLang } from "./lang.js";
export { AdapterError } from "./adapters/types.js";
export type {
  AudioClip,
  ChatMessage,
  FetchLike,
  LlmAdapter,
  SttAdapter,
  SttResult,
  TtsAdapter,
} from "./adapters/types.js";
export { MockSttAdapter } from "./adapters/stt/mock.js";
export { WhisperCppAdapter } from "./adapters/stt/whisperCpp.js";
export { MockTtsAdapter, sineWav, MOCK_SAMPLE_RATE } from "./adapters/tts/mock.js";
export { PiperAdapter } from "./adapters/tts/piper.js";
export { VoicevoxAdapter } from "./adapters/tts/voicevox.js";
export { MockLlmAdapter } from "./adapters/llm/mock.js";
export { OpenAiCompatAdapter } from "./adapters/llm/openaiCompat.js";
export {
  HearthHub,
  buildLlmAdapter,
  buildSttAdapter,
  buildTtsAdapter,
} from "./hub.js";
export {
  DEFAULT_SYSTEM_PROMPT,
  MAX_HISTORY_TURNS,
  Pipeline,
  SessionStore,
} from "./pipeline.js";
export type {
  AudioTurnOptions,
  PipelineResult,
  Session,
  StageInfo,
  TextTurnOptions,
} from "./pipeline.js";
export { startServer } from "./server.js";
export type { HearthServer } from "./server.js";
export { VERSION } from "./version.js";
