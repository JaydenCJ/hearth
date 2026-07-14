# Hearth client–server protocol (v1)

This document is the shared contract between the Hearth hub
(`server/`, TypeScript) and its clients — the Android app (`android/`,
Kotlin) and anything else that wants to talk to the hub. Both ends are
implemented against this file; if you change one side, change this file and
the other side in the same commit.

- Base URL: `http://<hub-host>:8321` (default port `8321`, path prefix `/v1`)
- Transport: REST over HTTP for one-shot calls, one WebSocket endpoint for
  streaming voice turns.
- Encoding: JSON bodies are UTF-8. Audio is transferred as raw bytes
  (recommended: WAV, 16 kHz mono PCM16 — the format the Android client
  records and whisper.cpp prefers).
- Versioning: breaking changes bump the path prefix (`/v1` → `/v2`).

## Authentication

Optional. When the server config sets `server.auth_token`:

- REST requests (except `GET /v1/health`) must send
  `Authorization: Bearer <token>`; otherwise the hub replies `401`.
- WebSocket clients must include `"token": "<token>"` in the `start` frame;
  otherwise the hub sends an `error` event and closes with code `4401`.

`GET /v1/health` stays unauthenticated so clients can implement a
"test connection" button without storing the token first.

## Common objects

### StageInfo

Reported for every pipeline stage so clients can show which backend served
a request and why it was picked.

| field     | type   | description                                          |
|-----------|--------|------------------------------------------------------|
| `backend` | string | configured backend name, e.g. `"voicevox"`           |
| `reason`  | string | `"explicit"`, `"rule[<index>]"` or `"default"`       |

### TurnResult (REST chat responses)

| field        | type            | description                                   |
|--------------|-----------------|-----------------------------------------------|
| `session_id` | string          | conversation id; send it back to keep memory  |
| `transcript` | string          | what the hub heard (or the submitted text)    |
| `lang`       | string \| null  | detected/declared language, e.g. `"ja"`       |
| `reply_text` | string          | the assistant's reply                         |
| `elapsed_ms` | number          | wall time for the whole turn                  |
| `backends`   | object          | `{stt: StageInfo|null, llm: StageInfo, tts: StageInfo|null}` |
| `audio`      | object, optional| `{media_type: string, data_b64: string}` — synthesized reply |

### Error responses

| status | body                                            | meaning                          |
|--------|--------------------------------------------------|----------------------------------|
| `400`  | `{"detail": "..."}`                             | bad input / unknown pinned backend |
| `401`  | `{"detail": "invalid or missing token"}`        | auth failure                     |
| `404`  | `{"detail": "no such endpoint: ..."}`           | wrong path                       |
| `413`  | `{"detail": "request body too large"}`          | body over 32 MiB                 |
| `502`  | `{"detail": "...", "layer": "...", "backend": "..."}` | an engine (whisper.cpp / Piper / VOICEVOX / LLM) failed |

## REST endpoints

### `GET /v1/health`

Liveness plus the configured backend names per layer.

```json
{
  "status": "ok",
  "version": "0.1.0",
  "backends": {"stt": ["mock", "whisper"], "tts": ["mock", "piper", "voicevox"], "llm": ["cloud", "local", "mock"]},
  "defaults": {"stt": "whisper", "tts": "piper", "llm": "local"}
}
```

### `POST /v1/stt`

STT stage only. Body: raw audio bytes; `Content-Type` describes the
container (`audio/wav`, `audio/ogg`, ...).

Query parameters: `lang` (hint, e.g. `ja`), `backend` (pin an STT backend
by name).

Response `200`:

```json
{"text": "turn off the lights", "lang": "en", "backend": {"backend": "whisper", "reason": "default"}}
```

### `POST /v1/tts`

TTS stage only. JSON body:

| field     | type   | required | description                        |
|-----------|--------|----------|------------------------------------|
| `text`    | string | yes      | text to speak                      |
| `lang`    | string | no       | language hint used by routing      |
| `tag`     | string | no       | client tag used by routing         |
| `backend` | string | no       | pin a TTS backend by name          |

Response `200`: audio bytes (`Content-Type: audio/wav`), with the serving
backend named in the `X-Hearth-Backend` response header.

### `POST /v1/chat/text`

One assistant turn starting from text (skips STT). JSON body:

| field         | type    | required | description                            |
|---------------|---------|----------|----------------------------------------|
| `text`        | string  | yes      | the user's utterance                   |
| `session_id`  | string  | no       | continue an existing conversation      |
| `lang`        | string  | no       | language hint                          |
| `tag`         | string  | no       | routing tag (`kitchen`, `private`, ...)|
| `llm_backend` | string  | no       | pin an LLM backend                     |
| `tts_backend` | string  | no       | pin a TTS backend                      |
| `with_audio`  | boolean | no       | default `true`; `false` skips TTS      |

Response `200`: a TurnResult.

### `POST /v1/chat/audio`

The full voice turn: audio → STT → LLM → TTS → audio. Body: raw audio
bytes (like `/v1/stt`). Options travel as query parameters because the body
is the audio itself: `session_id`, `lang`, `tag`, `stt_backend`,
`llm_backend`, `tts_backend`, `with_audio` (`"false"` to skip TTS).

Response `200`: a TurnResult (with `backends.stt` populated).

## WebSocket `/v1/stream`

The phone client's endpoint. One connection = one assistant turn.

### Client → server frames

1. Exactly one `start` control frame (text/JSON), first:

```json
{
  "type": "start",
  "session_id": "optional",
  "lang": "optional BCP-47 hint",
  "tag": "optional routing tag",
  "token": "required when auth_token is configured",
  "stt_backend": "optional pin",
  "llm_backend": "optional pin",
  "tts_backend": "optional pin",
  "with_audio": true
}
```

2. Then either
   - any number of **binary frames** carrying the utterance (a WAV byte
     stream, chunked arbitrarily — the Android client sends the 44-byte WAV
     header first, then PCM16 chunks), terminated by
     `{"type": "end", "media_type": "audio/wav"}`; or
   - a single `{"type": "text", "text": "..."}` frame to skip STT.

### Server → client events (in order)

| event        | payload                                                       | when                        |
|--------------|---------------------------------------------------------------|-----------------------------|
| `transcript` | `{"type":"transcript","text":...,"lang":...,"backend":...}`   | after STT (audio turns only)|
| `reply`      | `{"type":"reply","text":...,"backend":...}`                   | after the LLM stage         |
| `audio`      | `{"type":"audio","media_type":...,"size":...,"backend":...}`  | before the binary frame     |
| *(binary)*   | one binary frame with exactly `size` bytes of audio           | right after `audio`         |
| `done`       | `{"type":"done","session_id":...,"elapsed_ms":...}`           | turn finished; hub closes with code 1000 |
| `error`      | `{"type":"error","message":...}`                              | any failure                 |

### Close codes

| code   | meaning                                    |
|--------|--------------------------------------------|
| `1000` | turn completed normally                    |
| `1002` | protocol violation (bad first frame)       |
| `1008` | empty utterance / empty text               |
| `1011` | engine failure mid-turn (after `error`)    |
| `4401` | authentication failure (after `error`)     |

## Audio format notes

- The Android client records 16 kHz mono PCM16 (`AudioRecord`,
  `VOICE_RECOGNITION` source) and wraps it in a 44-byte canonical WAV
  header (`android/.../audio/WavCodec.kt`).
- The hub forwards the container as-is to the STT backend; whisper.cpp
  accepts WAV and several compressed containers (see `Content-Type` →
  filename mapping in `server/src/adapters/stt/whisperCpp.ts`).
- Synthesized replies are WAV (Piper and VOICEVOX both emit WAV; the mock
  emits 16 kHz mono PCM16 WAV).
