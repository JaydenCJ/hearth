# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-08

### Added

- Hub server (TypeScript / Node.js) with the three-layer routable
  architecture:
  - STT adapter for the whisper.cpp HTTP server.
  - TTS adapters for Piper and VOICEVOX.
  - LLM adapter for any OpenAI-compatible chat endpoint.
  - Built-in deterministic mock backends for every layer (tests /
    zero-hardware demo).
- First-match-wins routing rules per layer (`lang`, `contains`, `regex`,
  `max_chars`, `min_chars`, `tag`) plus explicit per-request backend
  pinning.
- YAML/JSON configuration with strict validation (`hearth check-config`).
- Full pipeline orchestration (audio → STT → LLM → TTS → audio) with
  per-session conversation memory and idle expiry.
- REST API (`/v1/health`, `/v1/stt`, `/v1/tts`, `/v1/chat/text`,
  `/v1/chat/audio`) and streaming WebSocket endpoint (`/v1/stream`),
  optional bearer-token auth, `127.0.0.1` bind by default.
- CLI: `hearth serve`, `hearth demo` (interactive text chat), and
  `hearth check-config`.
- Docker deployment: pinned-version image build and a compose file with
  healthcheck and a named config volume.
- Android client (Kotlin, two modules): assistant-role takeover
  (`RoleManager.ROLE_ASSISTANT` / `VoiceInteractionService`), microphone
  capture with energy-based endpointing, WebSocket streaming, reply
  playback, settings screen with connection test; the platform-independent
  protocol codec, WAV writer and endpointer live in the pure-JVM `:core`
  module (`./gradlew :core:test`, no Android SDK needed).
- Client–server protocol specification (`docs/protocol.md`) shared by
  both ends.
- Test-suite: server (vitest, 77 tests) covering config parsing, routing,
  pipeline orchestration, adapter request construction, the
  REST/WebSocket API and the CLI; Android `:core` (JUnit, 33 tests)
  covering the WebSocket frame codec, WAV header, endpointer and URL
  derivation; smoke script asserting the running hub.
- Trilingual documentation (English / Simplified Chinese / Japanese).
