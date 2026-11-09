#!/usr/bin/env bash
# Install PhoneHome FreePBX sync on THIS machine (FreePBX host or lab PVE).
# PhoneHome hub POSTs SIP secrets here → phonehome-set-sip-secret on FreePBX.
#
# Usage (on FreePBX as root):
#   PHONEHOME_HOST_IP=10.0.0.51 ./deploy/install-freepbx-sync.sh
#
# Lab Proxmox (syncd on PVE, FreePBX in CT):
#   FREEPBX_CT=121 FREEPBX_SYNC_ALLOWED=192.168.2.106,192.168.2.31 ./deploy/install-freepbx-sync.sh
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

# Optional belt-and-suspenders: persist public media host/IP in syncd env.
# The PhoneHome hub now sends media_address in every sync POST (automagic) —
# FreePBX no longer depends on this env surviving pct exec. Still write it when known.
SIP_PUBLIC_HOST_VAL="${SIP_PUBLIC_HOST:-${PHONEHOME_SIP_PUBLIC_HOST:-}}"
PUBLIC_MEDIA_IP_VAL="${PHONEHOME_PUBLIC_MEDIA_IP:-${PHONEHOME_SIP_PUBLIC_IP:-}}"
if [[ -z "$SIP_PUBLIC_HOST_VAL" && -n "${PUBLIC_BASE_URL:-}" ]]; then
  SIP_PUBLIC_HOST_VAL="$(python3 -c "from urllib.parse import urlparse; print(urlparse('${PUBLIC_BASE_URL}').hostname or '')" 2>/dev/null || true)"
fi
is_private_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^10\. ]] && return 0
  [[ "$ip" =~ ^192\.168\. ]] && return 0
  [[ "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && return 0
  [[ "$ip" =~ ^127\. ]] && return 0
  return 1
}
# Do not use system DNS. A mothership AdGuard rewrite of the public SIP name
# is a LAN address, and writing that as PHONEHOME_PUBLIC_MEDIA_IP makes every
# new cousin ATA ring with no audio.
if [[ -n "$PUBLIC_MEDIA_IP_VAL" ]] && is_private_ipv4 "$PUBLIC_MEDIA_IP_VAL"; then
  echo "WARN: ignoring private PHONEHOME_PUBLIC_MEDIA_IP=$PUBLIC_MEDIA_IP_VAL (LAN DNS rewrite)." >&2
  PUBLIC_MEDIA_IP_VAL=""
fi
if [[ -z "$PUBLIC_MEDIA_IP_VAL" && -n "$SIP_PUBLIC_HOST_VAL" ]]; then
  for dns in 1.1.1.1 8.8.8.8; do
    cand="$(dig +short +time=2 +tries=1 A "$SIP_PUBLIC_HOST_VAL" @"$dns" 2>/dev/null | awk '/^[0-9]+(\.[0-9]+){3}$/ {print; exit}')"
    if [[ -n "$cand" ]] && ! is_private_ipv4 "$cand"; then
      PUBLIC_MEDIA_IP_VAL="$cand"
      break
    fi
  done
fi
MEDIA_LINES=""
if [[ -n "$SIP_PUBLIC_HOST_VAL" ]]; then
  MEDIA_LINES+=$'SIP_PUBLIC_HOST='"$SIP_PUBLIC_HOST_VAL"$'\n'
  MEDIA_LINES+=$'PHONEHOME_SIP_PUBLIC_HOST='"$SIP_PUBLIC_HOST_VAL"$'\n'
fi
if [[ -n "$PUBLIC_MEDIA_IP_VAL" ]]; then
  MEDIA_LINES+=$'PHONEHOME_PUBLIC_MEDIA_IP='"$PUBLIC_MEDIA_IP_VAL"$'\n'
  echo "Remote ATA media fallback env: host=${SIP_PUBLIC_HOST_VAL:-?} ip=${PUBLIC_MEDIA_IP_VAL}"
else
  echo "Note: hub will send media_address on each ATA sync (SIP_PUBLIC_HOST from phonehome.env)."
fi

cat >/etc/phonehome/freepbx-syncd.env <<EOF
FREEPBX_SYNC_BIND_HOST=0.0.0.0
FREEPBX_SYNC_BIND_PORT=8797
FREEPBX_SYNC_TOKEN_FILE=$TOKEN_FILE
FREEPBX_SYNC_ALLOWED=$ALLOWED
PHONEHOME_SET_SIP_SECRET=/usr/local/sbin/phonehome-set-sip-secret
${FREEPBX_CT_LINE}
${MEDIA_LINES}EOF
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
