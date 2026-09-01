#!/usr/bin/env bash
# Install PhoneHome FreePBX sync on THIS machine (FreePBX host or lab PVE).
# PhoneHome hub POSTs SIP secrets here → phonehome-set-sip-secret on FreePBX.
#
# Usage (on FreePBX as root):
#   PHONEHOME_HOST_IP=10.0.0.51 ./deploy/install-freepbx-sync.sh
#
# Lab Proxmox (syncd on PVE, FreePBX in CT):
#   FREEPBX_CT=121 FREEPBX_SYNC_ALLOWED=10.0.5.106,10.0.5.31 ./deploy/install-freepbx-sync.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_DIR=/etc/phonehome
TOKEN_FILE="$TOKEN_DIR/sync.token"
PHONEHOME_HOST_IP="${PHONEHOME_HOST_IP:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the FreePBX host (or Proxmox host in lab mode)." >&2
  exit 1
fi

mkdir -p "$TOKEN_DIR"
chmod 700 "$TOKEN_DIR"
if [[ ! -f "$TOKEN_FILE" ]]; then
  if [[ -n "${FREEPBX_SYNC_TOKEN:-}" ]]; then
    printf '%s' "$FREEPBX_SYNC_TOKEN" >"$TOKEN_FILE"
  else
    openssl rand -hex 32 >"$TOKEN_FILE"
  fi
  chmod 600 "$TOKEN_FILE"
  echo "Created $TOKEN_FILE"
fi
TOKEN="$(cat "$TOKEN_FILE")"

install -m 755 "$ROOT/deploy/phonehome-set-sip-secret.py" /usr/local/sbin/phonehome-set-sip-secret
install -m 755 "$ROOT/deploy/phonehome-freepbx-syncd.py" /usr/local/sbin/phonehome-freepbx-syncd

ALLOWED="${FREEPBX_SYNC_ALLOWED:-}"
if [[ -z "$ALLOWED" && -n "$PHONEHOME_HOST_IP" ]]; then
  ALLOWED="$PHONEHOME_HOST_IP,127.0.0.1"
fi
if [[ -z "$ALLOWED" ]]; then
  ALLOWED="127.0.0.1"
  echo "WARN: FREEPBX_SYNC_ALLOWED not set — only localhost can sync." >&2
  echo "      Re-run with PHONEHOME_HOST_IP=<PhoneHome LAN IP>" >&2
fi

FREEPBX_CT_LINE=""
if [[ -n "${FREEPBX_CT:-}" ]]; then
  FREEPBX_CT_LINE="FREEPBX_CT=${FREEPBX_CT}"
fi

cat >/etc/phonehome/freepbx-syncd.env <<EOF
FREEPBX_SYNC_BIND_HOST=0.0.0.0
FREEPBX_SYNC_BIND_PORT=8797
FREEPBX_SYNC_TOKEN_FILE=$TOKEN_FILE
FREEPBX_SYNC_ALLOWED=$ALLOWED
PHONEHOME_SET_SIP_SECRET=/usr/local/sbin/phonehome-set-sip-secret
${FREEPBX_CT_LINE}
EOF
chmod 600 /etc/phonehome/freepbx-syncd.env

cat >/etc/systemd/system/phonehome-freepbx-syncd.service <<'UNIT'
[Unit]
Description=PhoneHome FreePBX SIP secret sync
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-/etc/phonehome/freepbx-syncd.env
ExecStart=/usr/bin/python3 /usr/local/sbin/phonehome-freepbx-syncd
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now phonehome-freepbx-syncd.service

SYNC_URL="http://$(hostname -I 2>/dev/null | awk '{print $1}'):8797/sip-secret"
echo ""
echo "==> FreePBX sync daemon running on port 8797"
echo ""
echo "On the PhoneHome host, write \$DATA_DIR/freepbx-sync.env :"
echo ""
cat <<EOF
FREEPBX_SYNC_URL=${SYNC_URL}
FREEPBX_SYNC_TOKEN=${TOKEN}
EOF
echo ""
echo "Then restart PhoneHome. Parent → Analog Phone → Save will auto-create PJSIP extensions."
