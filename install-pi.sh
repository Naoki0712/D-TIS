#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="$(id -un)"
USER_HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)"
SERVICE_NAME="d-tis-signage.service"
SUDOERS_PATH="/etc/sudoers.d/d-tis-signage-power"
POWER_ENABLED=0

if [[ "$(id -u)" -eq 0 ]]; then
  echo "このスクリプトは通常ユーザーで実行してください。必要な箇所だけ sudo を使います。" >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "Node.js が必要です (推奨: Node.js 22 LTS)。" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm が必要です。" >&2; exit 1; }
command -v sudo >/dev/null 2>&1 || { echo "sudo が必要です。" >&2; exit 1; }

# The user name is written into sudoers and the systemd unit as a literal.
if [[ ! "$USER_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]; then
  echo "セットアップに対応していないユーザー名です: $USER_NAME" >&2
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo ".env を作成しました。ODPT_API_TOKEN を設定してください。"
fi

mkdir -p "$ROOT/server/data"
chmod 0700 "$ROOT/server/data"
if [[ -f "$ROOT/server/data/pairing.json" ]]; then
  chmod 0600 "$ROOT/server/data/pairing.json"
fi

cd "$ROOT"
npm install
npm run build

TMP_SERVICE="$(mktemp)"
TMP_SUDOERS="$(mktemp)"
trap 'rm -f -- "$TMP_SERVICE" "$TMP_SUDOERS"' EXIT

# Enable host power commands only on an actual Raspberry Pi. Never grant a
# wildcard command, an interactive shell, or root privileges to the service.
IS_RASPBERRY_PI=0
if [[ "$(uname -s)" == "Linux" ]]; then
  for MODEL_PATH in /proc/device-tree/model /sys/firmware/devicetree/base/model; do
    if [[ -r "$MODEL_PATH" ]] && [[ "$(tr -d '\000' < "$MODEL_PATH")" == *"Raspberry Pi"* ]]; then
      IS_RASPBERRY_PI=1
      break
    fi
  done
fi

if [[ "$IS_RASPBERRY_PI" -eq 1 ]] && [[ -x /usr/bin/sudo && -x /usr/bin/systemctl ]]; then
  cat > "$TMP_SUDOERS" <<SUDOERS
# Managed by D-TIS install-pi.sh. Only these exact commands are permitted.
$USER_NAME ALL=(root) NOPASSWD: /usr/bin/systemctl --no-block reboot, /usr/bin/systemctl --no-block poweroff
SUDOERS
  if sudo visudo -cf "$TMP_SUDOERS" \
      && sudo install -o root -g root -m 0440 "$TMP_SUDOERS" "$SUDOERS_PATH" \
      && /usr/bin/sudo -n -l /usr/bin/systemctl --no-block reboot >/dev/null 2>&1 \
      && /usr/bin/sudo -n -l /usr/bin/systemctl --no-block poweroff >/dev/null 2>&1; then
    POWER_ENABLED=1
  else
    echo "電源操作の sudoers 設定を確認できませんでした。遠隔電源操作は無効にします。" >&2
  fi
else
  echo "Raspberry Pi / systemctl を確認できないため、遠隔電源操作は無効にします。"
fi

cat > "$TMP_SERVICE" <<SERVICE
[Unit]
Description=D-TIS Signage local server
After=network.target
Wants=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$ROOT
ExecStart=/usr/bin/env npm start
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=DTIS_POWER_CONTROL=$POWER_ENABLED
UMask=0077

[Install]
WantedBy=multi-user.target
SERVICE

sudo install -m 0644 "$TMP_SERVICE" "/etc/systemd/system/$SERVICE_NAME"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
# A restart also applies updated code and permissions when already installed.
sudo systemctl restart "$SERVICE_NAME"

# Raspberry Pi OS desktop autostart: launch Chromium after login.
mkdir -p "$USER_HOME/.config/autostart"
cat > "$USER_HOME/.config/autostart/d-tis-signage.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=D-TIS Signage
Exec=$ROOT/kiosk.sh
Terminal=false
X-GNOME-Autostart-enabled=true
DESKTOP
chmod +x "$ROOT/start.sh" "$ROOT/kiosk.sh" "$ROOT/install-pi.sh"

echo
echo "D-TIS Signage のインストールが完了しました。"
echo "Server: http://127.0.0.1:3000/signage/"
echo "Controller: http://127.0.0.1:3000/controller/"
echo "Service: systemctl status $SERVICE_NAME"
echo "Raspberry Pi の遠隔電源操作: $POWER_ENABLED (1=有効 / 0=無効)"
echo "DesktopへログインするとChromiumがキオスク表示で起動します。"
