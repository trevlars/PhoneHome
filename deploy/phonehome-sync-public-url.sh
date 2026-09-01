#!/bin/bash
# Run on the Proxmox host. Pushes HTTPS origin + TURN into CT 122 PhoneHome unit.
set -euo pipefail
URL="${1:-}"
if [[ -z "$URL" || ! "$URL" =~ ^https:// ]]; then
  echo "usage: $0 https://....trycloudflare.com" >&2
  exit 1
fi
URL="${URL%/}"
CREDS=/root/.kids-landline-turn-creds
if [[ ! -f "$CREDS" ]]; then
  echo "missing $CREDS (TURN username password on one line)" >&2
  exit 1
fi
TURN_USER=$(awk '{print $1}' "$CREDS")
TURN_PASS=$(awk '{print $2}' "$CREDS")
WAN=$(curl -4 -sS --max-time 5 ifconfig.me || true)
if [[ -z "$WAN" && -f /etc/turnserver.conf ]]; then
  WAN=$(awk -F= '/^external-ip=/{print $2}' /etc/turnserver.conf | cut -d/ -f1)
fi
CT="${PHONEHOME_CT:-122}"
pct exec "$CT" -- bash -lc "mkdir -p /etc/systemd/system/kids-landline.service.d
cat > /etc/systemd/system/kids-landline.service.d/https-turn.conf << EOF
[Service]
Environment=PUBLIC_BASE_URL=${URL}
Environment=TURN_URLS=turn:${WAN}:3478
Environment=TURN_USERNAME=${TURN_USER}
Environment=TURN_CREDENTIAL=${TURN_PASS}
EOF
# Bridge ATA↔softphone WebRTC needs the same TURN (coturn on PVE).
umask 077
touch /var/lib/kids-landline/bridge.env
grep -q '^BRIDGE_SECRET=' /var/lib/kids-landline/bridge.env 2>/dev/null || true
# Upsert TURN keys without wiping BRIDGE_SECRET / ARI creds.
tmp=\$(mktemp)
grep -vE '^(TURN_URLS|TURN_LAN_URLS|TURN_USERNAME|TURN_CREDENTIAL)=' /var/lib/kids-landline/bridge.env > \"\$tmp\" || true
cat >> \"\$tmp\" << EOF
TURN_URLS=turn:${WAN}:3478
TURN_LAN_URLS=turn:10.0.5.31:3478
TURN_USERNAME=${TURN_USER}
TURN_CREDENTIAL=${TURN_PASS}
EOF
mv \"\$tmp\" /var/lib/kids-landline/bridge.env
chmod 600 /var/lib/kids-landline/bridge.env
systemctl daemon-reload
systemctl restart kids-landline
systemctl restart phonehome-bridge || true
"
echo "PhoneHome PUBLIC_BASE_URL=${URL} TURN=${WAN}:3478 (hub + bridge)"
echo "$URL" > /var/lib/phonehome-public-url.txt
