#!/usr/bin/env bash
set -euo pipefail
URL="${DTIS_SIGNAGE_URL:-http://127.0.0.1:3000/signage/}"

# Wait until the local D-TIS server is ready. No Internet connection is required.
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

BROWSER=""
for candidate in chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then
    BROWSER="$candidate"
    break
  fi
done

if [[ -z "$BROWSER" ]]; then
  echo "Chromium が見つかりません。sudo apt install chromium を実行してください。" >&2
  exit 1
fi

exec "$BROWSER" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-component-update \
  --check-for-update-interval=31536000 \
  "$URL"
