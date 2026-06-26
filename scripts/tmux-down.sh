#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${SESSION_NAME:-lumi-ui}"
LEGACY_SESSION_NAME="${LEGACY_SESSION_NAME:-lumi-ngrok}"
BACKEND_SERVICE="${BACKEND_SERVICE:-lumi-backend}"

cd "$ROOT_DIR"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "Dừng tmux session: $SESSION_NAME"
  tmux kill-session -t "$SESSION_NAME"
else
  echo "Không có tmux session: $SESSION_NAME"
fi

if tmux has-session -t "$LEGACY_SESSION_NAME" 2>/dev/null; then
  echo "Dừng tmux session cũ: $LEGACY_SESSION_NAME"
  tmux kill-session -t "$LEGACY_SESSION_NAME"
fi

echo "Dừng backend service: $BACKEND_SERVICE"
docker compose stop "$BACKEND_SERVICE"
