#!/bin/sh
set -e
cd "$(dirname "$0")/.."

command -v whisper-cli >/dev/null || brew install whisper-cpp
command -v ffmpeg >/dev/null || brew install ffmpeg
npm install

model="models/ggml-${WHISPER_MODEL:-small}.bin"
if [ ! -f "$model" ]; then
  mkdir -p models
  curl -L --fail -o "$model" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$(basename "$model")"
fi

claude plugin marketplace add "$(pwd)"
claude plugin install deskphone@deskphone-local

echo "Done. Next: start Asterisk (https://xvilo.github.io/claude-code-deskphone/asterisk), run npm run daemon, then scripts/claude-phone."
