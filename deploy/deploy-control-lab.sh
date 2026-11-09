#!/usr/bin/env bash
# Deploy PhoneHome control onto lab CT 122 (free — existing box).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PVE="${PVE_HOST:-}"
CTID="${CONTROL_CTID:-}"
if [[ -z "$PVE" || -z "$CTID" ]]; then
  echo "Set PVE_HOST and CONTROL_CTID. Example: PVE_HOST=root@192.168.1.2 CONTROL_CTID=201 $0" >&2
  exit 1
fi
REMOTE_DIR="/opt/phonehome-control"
DATA_DIR="/var/lib/phonehome-control"
LOCAL_SECRETS="${HOME}/.phonehome-control"

[[ -f "$LOCAL_SECRETS/host-license.pem" ]] || {
  echo "Missing $LOCAL_SECRETS/host-license.pem — generate Ed25519 keys first" >&2
  exit 1
}

echo "==> Build control"
(cd "$ROOT" && npm run build -w @phonehome/control) || (cd "$ROOT/control" && npm run build)

echo "==> Pack + push"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/control/dist"
cp "$ROOT/control/package.json" "$TMP/control/"
rsync -a "$ROOT/control/dist/" "$TMP/control/dist/"
tar -C "$TMP" -czf "$TMP/bundle.tgz" control
scp -q "$TMP/bundle.tgz" "$LOCAL_SECRETS/host-license.pem" "$LOCAL_SECRETS/host-license.pub" "$PVE:/tmp/"
ssh "$PVE" "pct push ${CTID} /tmp/bundle.tgz /tmp/bundle.tgz
pct push ${CTID} /tmp/host-license.pem /tmp/host-license.pem
pct push ${CTID} /tmp/host-license.pub /tmp/host-license.pub"

ssh "$PVE" "pct exec ${CTID} -- bash -s" <<REMOTE
set -euo pipefail
REMOTE_DIR="${REMOTE_DIR}"
DATA_DIR="${DATA_DIR}"
mkdir -p "\$DATA_DIR" "\$REMOTE_DIR"
chmod 700 "\$DATA_DIR"
cp /tmp/host-license.pem "\$DATA_DIR/host-license.pem"
cp /tmp/host-license.pub "\$DATA_DIR/host-license.pub"
chmod 600 "\$DATA_DIR/host-license.pem"

rm -rf "\$REMOTE_DIR.new"
mkdir -p "\$REMOTE_DIR.new"
tar -xzf /tmp/bundle.tgz -C "\$REMOTE_DIR.new"
cd "\$REMOTE_DIR.new/control"
npm install --omit=dev --no-audit --no-fund
rm -rf "\$REMOTE_DIR.bak"
[[ -d "\$REMOTE_DIR" ]] && mv "\$REMOTE_DIR" "\$REMOTE_DIR.bak" || true
mv "\$REMOTE_DIR.new" "\$REMOTE_DIR"

if [[ ! -f "\$DATA_DIR/control.env" ]]; then
  ADMIN_TOKEN="\$(openssl rand -hex 24)"
  cat > "\$DATA_DIR/control.env" <<EOF
PORT=8791
CONTROL_DATA_DIR=\${DATA_DIR}
CONTROL_ADMIN_TOKEN=\${ADMIN_TOKEN}
HOST_LICENSE_PRIVATE_KEY_FILE=\${DATA_DIR}/host-license.pem
HOST_LICENSE_SUCCESS_URL=https://phonehome.pages.dev/buy-success.html?session_id={CHECKOUT_SESSION_ID}
HOST_LICENSE_CANCEL_URL=https://phonehome.pages.dev/buy.html
EOF
  chmod 600 "\$DATA_DIR/control.env"
  echo "\$ADMIN_TOKEN" > "\$DATA_DIR/admin.token"
  chmod 600 "\$DATA_DIR/admin.token"
  echo "NEW_ADMIN_TOKEN=\$ADMIN_TOKEN"
else
  # Ensure key file path is present
  grep -q HOST_LICENSE_PRIVATE_KEY_FILE "\$DATA_DIR/control.env" || \
    echo "HOST_LICENSE_PRIVATE_KEY_FILE=\${DATA_DIR}/host-license.pem" >> "\$DATA_DIR/control.env"
fi

cat > "\$REMOTE_DIR/control/start.sh" <<'START'
#!/usr/bin/env bash
set -euo pipefail
DATA_DIR=/var/lib/phonehome-control
set -a
# shellcheck disable=SC1091
source "\$DATA_DIR/control.env"
set +a
if [[ -n "\${HOST_LICENSE_PRIVATE_KEY_FILE:-}" && -f "\$HOST_LICENSE_PRIVATE_KEY_FILE" ]]; then
  export HOST_LICENSE_PRIVATE_KEY="\$(cat "\$HOST_LICENSE_PRIVATE_KEY_FILE")"
fi
exec /usr/bin/node /opt/phonehome-control/control/dist/index.js
START
chmod +x "\$REMOTE_DIR/control/start.sh"

cat > /etc/systemd/system/phonehome-control.service <<'UNIT'
[Unit]
Description=PhoneHome control plane
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/phonehome-control/control
ExecStart=/opt/phonehome-control/control/start.sh
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable phonehome-control
systemctl restart phonehome-control
sleep 1
systemctl is-active phonehome-control
curl -sf http://127.0.0.1:8791/health
echo
curl -sf http://127.0.0.1:8791/v1/host-license/product
echo
REMOTE

# Pull admin token if new
ssh "$PVE" "pct exec ${CTID} -- cat ${DATA_DIR}/admin.token" > "$LOCAL_SECRETS/admin.token" 2>/dev/null || true
chmod 600 "$LOCAL_SECRETS/admin.token" 2>/dev/null || true
echo "==> Done. Admin token: $LOCAL_SECRETS/admin.token"
echo "==> Health: ssh ${PVE} pct exec ${CTID} -- curl -s http://127.0.0.1:8791/health"
