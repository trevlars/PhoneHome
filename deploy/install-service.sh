#!/usr/bin/env bash
# Install PhoneHome as a background service (macOS LaunchAgent or Linux systemd user).
# Run after phonehome-init.sh and npm run build.
set -euo pipefail

ROOT="${PHONEHOME_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${DATA_DIR:-$HOME/.phonehome}"
NODE=""
if [[ -x "$ROOT/node/bin/node" ]]; then
  NODE="$ROOT/node/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
fi

if [[ -z "$NODE" ]]; then
  echo "node not found — use a Mothership download bundle (includes Node) or install Node.js 20+" >&2
  exit 1
fi

SUPERVISOR="$ROOT/deploy/phonehome-supervisor.mjs"
if [[ ! -f "$SUPERVISOR" ]]; then
  echo "missing $SUPERVISOR" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
OS="$(uname -s)"

install_macos() {
  local plist="$HOME/Library/LaunchAgents/com.phonehome.server.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.phonehome.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${SUPERVISOR}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DATA_DIR</key>
    <string>${DATA_DIR}</string>
    <key>PATH</key>
    <string>${PATH}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${DATA_DIR}/phonehome.log</string>
  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/phonehome.err.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/com.phonehome.server" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  launchctl enable "gui/$(id -u)/com.phonehome.server"
  launchctl kickstart -k "gui/$(id -u)/com.phonehome.server"
  echo "Installed macOS LaunchAgent: $plist"
  echo "Logs: $DATA_DIR/phonehome.log"
  echo "Stop:  launchctl bootout gui/$(id -u)/com.phonehome.server"
}

install_linux_user() {
  local unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir"
  cat >"$unit_dir/phonehome.service" <<EOF
[Unit]
Description=PhoneHome family voice hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
Environment=DATA_DIR=${DATA_DIR}
EnvironmentFile=-${DATA_DIR}/phonehome.env
EnvironmentFile=-${DATA_DIR}/bridge.env
ExecStart=${NODE} ${SUPERVISOR}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now phonehome.service
  echo "Installed systemd user service: $unit_dir/phonehome.service"
  echo "Status: systemctl --user status phonehome"
  echo "Logs:   journalctl --user -u phonehome -f"
  if ! loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q yes; then
    echo ""
    echo "Tip: run 'sudo loginctl enable-linger $USER' so PhoneHome stays up after logout."
  fi
}

install_linux_system() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "Re-run as root for system-wide install, or use user service (default)." >&2
    exit 1
  fi
  DATA_DIR="${DATA_DIR:-/var/lib/kids-landline}"
  mkdir -p "$DATA_DIR" /opt/kids-landline
  if [[ "$ROOT" != "/opt/kids-landline" ]]; then
    echo "Syncing $ROOT → /opt/kids-landline (rsync)..."
    rsync -a --delete --exclude node_modules --exclude .git "$ROOT/" /opt/kids-landline/
    ROOT="/opt/kids-landline"
    SUPERVISOR="$ROOT/deploy/phonehome-supervisor.mjs"
  fi
  cat >/etc/systemd/system/phonehome.service <<EOF
[Unit]
Description=PhoneHome family voice hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
Environment=DATA_DIR=${DATA_DIR}
EnvironmentFile=-${DATA_DIR}/phonehome.env
EnvironmentFile=-${DATA_DIR}/bridge.env
ExecStart=${NODE} ${SUPERVISOR}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now phonehome.service
  echo "Installed system service: phonehome.service (DATA_DIR=$DATA_DIR)"
}

case "$OS" in
  Darwin) install_macos ;;
  Linux)
    if [[ "${PHONEHOME_SYSTEM_SERVICE:-}" == "1" ]] || [[ "$(id -u)" -eq 0 ]]; then
      install_linux_system
    else
      install_linux_user
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "On Windows, run: powershell -ExecutionPolicy Bypass -File deploy\\windows\\install-service.ps1" >&2
    exit 1
    ;;
  *)
    echo "Unsupported OS: $OS — run node deploy/phonehome-supervisor.mjs manually" >&2
    exit 1
    ;;
esac

sleep 2
curl -sS "http://127.0.0.1:8787/api/health" 2>/dev/null && echo "" || echo "(hub not responding yet — check logs)"
