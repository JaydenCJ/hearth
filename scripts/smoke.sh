#!/usr/bin/env bash
# Smoke test for the Hearth hub: builds the server, boots it with the
# all-mock configuration on 127.0.0.1, and asserts the health endpoint,
# a text chat turn through the full pipeline, TTS output and the demo CLI.
# No network access beyond 127.0.0.1, idempotent, finishes in well under
# five minutes on a warm npm cache.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/../server"
PORT="${HEARTH_SMOKE_PORT:-8399}"
BASE="http://127.0.0.1:$PORT"
TMP_DIR="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "[smoke] FAIL: $1" >&2
  exit 1
}

cd "$SERVER_DIR"

# --- 0. install + build (idempotent) ---------------------------------------
if [[ ! -d node_modules ]]; then
  echo "[smoke] installing dependencies"
  npm install --no-audit --no-fund >/dev/null 2>&1
fi
echo "[smoke] building"
npm run build >/dev/null

# --- 1. boot the hub with mock backends ------------------------------------
node dist/cli.js serve --mock --port "$PORT" >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  if curl -fsS "$BASE/v1/health" >/dev/null 2>&1; then
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || {
    cat "$TMP_DIR/server.log" >&2
    fail "server exited early"
  }
  sleep 0.2
done
echo "[smoke] server started on 127.0.0.1:$PORT"

# --- 2. assert: health endpoint --------------------------------------------
HEALTH_STATUS=$(curl -s -o "$TMP_DIR/health.json" -w '%{http_code}' "$BASE/v1/health")
[[ "$HEALTH_STATUS" == "200" ]] || fail "GET /v1/health returned $HEALTH_STATUS"
grep -q '"status":"ok"' "$TMP_DIR/health.json" || fail "health payload missing status ok"
echo "[smoke] GET /v1/health -> 200 (status ok)"

# --- 3. assert: text chat turn through the mock pipeline --------------------
CHAT_STATUS=$(curl -s -o "$TMP_DIR/chat.json" -w '%{http_code}' \
  -X POST "$BASE/v1/chat/text" \
  -H 'Content-Type: application/json' \
  -d '{"text": "hello"}')
[[ "$CHAT_STATUS" == "200" ]] || fail "POST /v1/chat/text returned $CHAT_STATUS"
grep -q '"reply_text":"Hello, I am Hearth, your self-hosted assistant."' \
  "$TMP_DIR/chat.json" || fail "unexpected chat reply"
grep -q '"data_b64":' "$TMP_DIR/chat.json" || fail "chat response missing audio"
echo "[smoke] POST /v1/chat/text -> 200 (reply + audio)"

# --- 4. assert: TTS returns a RIFF/WAVE container ---------------------------
curl -fsS -X POST "$BASE/v1/tts" \
  -H 'Content-Type: application/json' \
  -d '{"text": "good evening"}' -o "$TMP_DIR/reply.wav" \
  || fail "POST /v1/tts failed"
[[ "$(head -c 4 "$TMP_DIR/reply.wav")" == "RIFF" ]] || fail "TTS output is not a WAV file"
echo "[smoke] POST /v1/tts -> WAV ($(wc -c <"$TMP_DIR/reply.wav") bytes)"

# --- 5. assert: demo CLI answers over the mock pipeline ---------------------
DEMO_OUT=$(printf 'hello\nexit\n' | node dist/cli.js demo --mock)
echo "$DEMO_OUT" | grep -q 'Hello, I am Hearth' || fail "demo CLI gave no mock reply"
echo "[smoke] demo CLI answered over the mock pipeline"

echo "SMOKE OK"
