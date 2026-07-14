#!/bin/sh
# Start the Hearth hub. If the user has dropped a config file onto the
# /config volume, use it; otherwise start with the built-in mock backends so
# `docker compose up` works with zero prerequisites. Inside the container we
# bind 0.0.0.0 — compose maps it back to 127.0.0.1 on the host.
set -eu

CONFIG_FILE="${HEARTH_CONFIG:-/config/hearth.yaml}"

if [ -f "$CONFIG_FILE" ]; then
  echo "hearth: using configuration $CONFIG_FILE"
  exec node dist/cli.js serve --config "$CONFIG_FILE" --host 0.0.0.0
fi

echo "hearth: no configuration at $CONFIG_FILE — starting with mock backends."
echo "hearth: copy examples/hearth.example.yaml to the config volume to wire"
echo "hearth: up whisper.cpp / Piper / VOICEVOX / your LLM endpoint."
exec node dist/cli.js serve --mock --host 0.0.0.0
