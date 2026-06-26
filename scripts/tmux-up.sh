#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${SESSION_NAME:-lumi-ui}"
LEGACY_SESSION_NAME="${LEGACY_SESSION_NAME:-lumi-ngrok}"
BACKEND_SERVICE="${BACKEND_SERVICE:-lumi-backend}"
BACKEND_PORT="${BACKEND_PORT:-8765}"
FRONTEND_PORT="${FRONTEND_PORT:-8880}"
WAIT_SECONDS="${WAIT_SECONDS:-180}"
NGROK_WEB_ADDR="${NGROK_WEB_ADDR:-127.0.0.1:4041}"
NGROK_API_URL="http://${NGROK_WEB_ADDR}/api/tunnels"
NGROK_BASE_CONFIG="${NGROK_BASE_CONFIG:-$HOME/.config/ngrok/ngrok.yml}"
NGROK_EXTRA_CONFIG="$ROOT_DIR/tmpdir/ngrok-helper.yml"
CLIENT_ROOT="${CLIENT_ROOT:-$ROOT_DIR/echo-presence-ai/dist/client}"
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
SERVER_ENTRY="${SERVER_ENTRY:-$ROOT_DIR/echo-presence-ai/dist/server/server.js}"
FRONTEND_CMD="cd '$ROOT_DIR' && PORT='$FRONTEND_PORT' BACKEND_URL='http://127.0.0.1:$BACKEND_PORT' CLIENT_ROOT='$CLIENT_ROOT' SERVER_ENTRY='$SERVER_ENTRY' node '$ROOT_DIR/frontend-server.mjs'"
NGROK_CMD="cd '$ROOT_DIR' && ngrok http $FRONTEND_PORT --config '$NGROK_BASE_CONFIG' --config '$NGROK_EXTRA_CONFIG' --log stdout"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Thiếu lệnh bắt buộc: $1" >&2
    exit 1
  fi
}

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

wait_for_url() {
  local url=""
  for _ in $(seq 1 15); do
    url="$(get_public_url)"
    if [[ -n "$url" ]]; then
      printf '%s\n' "$url"
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local deadline=$((SECONDS + WAIT_SECONDS))
  until curl -fsS "$url" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "$label chưa sẵn sàng sau ${WAIT_SECONDS}s." >&2
      return 1
    fi
    sleep 2
  done
}

require_cmd docker
require_cmd tmux
require_cmd ngrok
require_cmd curl
require_cmd python3
require_cmd node

cd "$ROOT_DIR"
mkdir -p "$ROOT_DIR/tmpdir"

cat <<EOF2 > "$NGROK_EXTRA_CONFIG"
version: 2
web_addr: $NGROK_WEB_ADDR
EOF2

ngrok config check --config "$NGROK_BASE_CONFIG" --config "$NGROK_EXTRA_CONFIG" >/dev/null

if [[ ! -f "$SERVER_ENTRY" ]]; then
  echo "Không tìm thấy frontend build tại: $SERVER_ENTRY" >&2
  echo "Hãy build echo-presence-ai trước khi chạy script này." >&2
  exit 1
fi

echo "TTS provider sẽ dùng: $EFFECTIVE_TTS_PROVIDER"
if [[ "$EFFECTIVE_TTS_PROVIDER" == "zipvoice" ]]; then
  echo "ZipVoice speaker profile: $EFFECTIVE_TTS_REFERENCE_SPEAKER"
fi

# echo "[1/5] Rebuild backend image: $BACKEND_SERVICE"
# docker compose build "$BACKEND_SERVICE"

echo "[1/5] Bật backend Docker service: $BACKEND_SERVICE"
docker compose up -d --no-build "$BACKEND_SERVICE"

echo "[3/5] Chờ backend sẵn sàng tại http://127.0.0.1:$BACKEND_PORT/"
wait_for_http "http://127.0.0.1:$BACKEND_PORT/" "Backend" || {
  echo "Xem log bằng: docker compose logs $BACKEND_SERVICE" >&2
  exit 1
}

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[4/5] Xóa session tmux cũ: $SESSION_NAME"
  tmux kill-session -t "$SESSION_NAME"
fi
if tmux has-session -t "$LEGACY_SESSION_NAME" 2>/dev/null; then
  echo "[4/5] Xóa session tmux cũ: $LEGACY_SESSION_NAME"
  tmux kill-session -t "$LEGACY_SESSION_NAME"
fi

echo "[4/5] Khởi động frontend echo-presence-ai trong tmux session: $SESSION_NAME"
tmux new-session -d -s "$SESSION_NAME" -n frontend "$FRONTEND_CMD"

echo "[5/5] Chờ frontend sẵn sàng tại http://127.0.0.1:$FRONTEND_PORT/"
if ! wait_for_http "http://127.0.0.1:$FRONTEND_PORT/" "Frontend"; then
  echo "Frontend không lên được. Xem log bằng: tmux attach -t $SESSION_NAME" >&2
  exit 1
fi

echo "[6/6] Khởi động ngrok cho giao diện ở cổng $FRONTEND_PORT"
tmux new-window -t "$SESSION_NAME" -n ngrok "$NGROK_CMD"

url=""
if url="$(wait_for_url)"; then
  true
fi

echo "Hoàn tất"
echo "Frontend local: http://127.0.0.1:$FRONTEND_PORT"
echo "Backend API local: http://127.0.0.1:$BACKEND_PORT"
if [[ -n "$url" ]]; then
  echo "Public URL: $url"
else
  echo "Ngrok đã chạy nhưng chưa lấy được URL. Dùng ./scripts/tmux-status.sh để kiểm tra."
fi
echo "Xem log: tmux attach -t $SESSION_NAME"
echo "Cửa sổ trong tmux: frontend, ngrok"
echo "Dừng toàn bộ: ./scripts/tmux-down.sh"
