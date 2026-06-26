#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${SESSION_NAME:-lumi-ui}"
BACKEND_SERVICE="${BACKEND_SERVICE:-lumi-backend}"
BACKEND_PORT="${BACKEND_PORT:-8765}"
FRONTEND_PORT="${FRONTEND_PORT:-8880}"
NGROK_WEB_ADDR="${NGROK_WEB_ADDR:-127.0.0.1:4041}"
NGROK_API_URL="http://${NGROK_WEB_ADDR}/api/tunnels"
compose_env_value() {
  local key="$1"
  local fallback="$2"
  local value
  value="$(cd "$ROOT_DIR" && docker compose config 2>/dev/null | awk -F': ' -v key="$key" '$1 ~ "^[[:space:]]*" key "$" { gsub(/"/, "", $2); print $2; exit }')"
  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$fallback"
  fi
}

EFFECTIVE_TTS_PROVIDER="${LUMI_TTS_PROVIDER:-$(compose_env_value LUMI_TTS_PROVIDER edge-tts)}"
EFFECTIVE_TTS_REFERENCE_SPEAKER="${LUMI_TTS_REFERENCE_SPEAKER:-$(compose_env_value LUMI_TTS_REFERENCE_SPEAKER Uyên)}"

get_public_url() {
  python3 - "$NGROK_API_URL" <<'PY'
import json
import sys
import urllib.request

url = sys.argv[1]
try:
    with urllib.request.urlopen(url, timeout=5) as response:
        data = json.load(response)
except Exception:
    print('')
    raise SystemExit(0)

for tunnel in data.get('tunnels', []):
    public_url = tunnel.get('public_url', '')
    if public_url.startswith('https://'):
        print(public_url)
        break
else:
    print('')
PY
}

http_state() {
  local url="$1"
  if curl -fsS "$url" >/dev/null 2>&1; then
    echo "up"
  else
    echo "down"
  fi
}

cd "$ROOT_DIR"

echo "Backend container:"
docker compose ps "$BACKEND_SERVICE"
echo

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "tmux session: $SESSION_NAME (running)"
else
  echo "tmux session: $SESSION_NAME (not running)"
fi
echo

echo "TTS provider cấu hình: $EFFECTIVE_TTS_PROVIDER"
if [[ "$EFFECTIVE_TTS_PROVIDER" == "zipvoice" ]]; then
  echo "ZipVoice speaker profile: $EFFECTIVE_TTS_REFERENCE_SPEAKER"
fi
echo

url="$(get_public_url)"
if [[ -n "$url" ]]; then
  echo "Public URL: $url"
else
  echo "Public URL: chưa lấy được từ ngrok"
fi

echo "Frontend local: http://127.0.0.1:$FRONTEND_PORT ($(http_state "http://127.0.0.1:$FRONTEND_PORT/"))"
echo "Backend API local: http://127.0.0.1:$BACKEND_PORT ($(http_state "http://127.0.0.1:$BACKEND_PORT/"))"
echo "Ngrok API: $NGROK_API_URL"
echo "Xem log: tmux attach -t $SESSION_NAME"
echo "Dừng toàn bộ: ./scripts/tmux-down.sh"
