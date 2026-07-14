# Contributing to Hearth

Thanks for your interest in making self-hosted voice assistants better.

## Getting started

1. Fork and clone the repository.
2. Server development (TypeScript, Node.js >= 20):
   ```bash
   cd server
   npm install
   npm run build
   npm test
   ```
3. Android development: open `android/` in Android Studio (SDK 35,
   minSdk 29). The `:app` module cannot be built without the Android SDK;
   the pure-JVM `:core` module (protocol codec, WAV writer, endpointer)
   can — run its tests on any JVM with `./gradlew :core:test`, and put
   platform-independent logic (with tests) there rather than in `:app`.
4. Before pushing, run the smoke test from the project root:
   ```bash
   bash scripts/smoke.sh
   ```

## Ground rules

- **Tests**: every server change needs tests. The whole suite must pass
  (`npm test`) and must not require a GPU, models, or network access
  beyond `127.0.0.1` — use the mock backends and local fake HTTP servers,
  as the existing tests do.
- **Privacy first**: features must never send audio or transcripts to
  third parties by default. Anything that can leave the local network has
  to be opt-in and clearly documented.
- **Adapters**: new STT/TTS/LLM backends live under
  `server/src/adapters/<layer>/` and should expose a `buildRequest`-style
  method so request construction stays unit-testable without a live
  engine.
- **Protocol**: the hub and the Android client share
  [docs/protocol.md](docs/protocol.md). If you change the wire format,
  update the document and both implementations in the same PR.
- **Docs**: the three READMEs (`README.md`, `README.zh.md`,
  `README.ja.md`) are kept aligned. If you change one, change all three
  (English-only PRs are fine — mark the untranslated sections and a
  maintainer will help).
- Code and code comments are written in English.

## Commit / PR flow

- Small, focused PRs are easiest to review.
- Describe *what* changed and *why*; link related issues.
- Update `CHANGELOG.md` under an `Unreleased` heading (Keep a Changelog
  format).

## Reporting issues

Please include your config (redact tokens), the hub log output, and the
engines (whisper.cpp / Piper / VOICEVOX / LLM server) with versions.
