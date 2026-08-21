#!/usr/bin/env bash
# Sync Stage 1 app into a Proxmox LXC and restart the service.
# Usage: ./deploy/proxmox-rsync.sh [pve-ssh] [ctid]
set -euo pipefail

PVE="${1:-root@10.0.5.31}"
CTID="${2:-122}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building web assets locally"
(cd "$ROOT" && npm run build -w web)

echo "==> Sync to CT $CTID via $PVE"
ssh "$PVE" "pct exec $CTID -- mkdir -p /opt/kids-landline /var/lib/kids-landline"

tar -C "$ROOT" -cf - \
  --exclude .git \
  --exclude node_modules \
  --exclude data \
  --exclude '**/node_modules' \
  --exclude '**/data' \
  . | ssh "$PVE" "pct exec $CTID -- tar -C /opt/kids-landline -xf -"

ssh "$PVE" "pct exec $CTID -- bash -s" <<'REMOTE'
set -e
cd /opt/kids-landline
npm install
npm run build -w web
if [[ -d bridged ]]; then
  (cd bridged && npm install --omit=dev)
fi
if [[ ! -f /var/lib/kids-landline/bridge.env ]]; then
  umask 077
  SECRET=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-40)
  cat > /var/lib/kids-landline/bridge.env <<EOF
BRIDGE_SECRET=${SECRET}
ARI_URL=http://10.0.5.105:8088
ARI_USER=phonehome
ARI_PASS=PhoneHomeAri!
ARI_APP=phonehome
PHONEHOME_URL=http://127.0.0.1:8787
PHONEHOME_WS=ws://127.0.0.1:8787/ws
EXT_MEDIA_HOST=10.0.5.106
EXT_MEDIA_PORT_BASE=14000
EOF
  echo "Created /var/lib/kids-landline/bridge.env"
fi
mkdir -p /etc/systemd/system/kids-landline.service.d
cat > /etc/systemd/system/kids-landline.service.d/bridge.conf <<'EOF'
[Service]
EnvironmentFile=-/var/lib/kids-landline/bridge.env
EnvironmentFile=-/var/lib/kids-landline/freepbx-sync.env
# FreePBX LAN address (bridge/ARI). ATA configs use SIP_PUBLIC_HOST (FQDN) so P8463 cert validation works.
Environment=SIP_SERVER=10.0.5.105
Environment=SIP_PUBLIC_HOST=y5876647.eero.online
Environment=BRIDGE_URL=http://127.0.0.1:8790
Environment=PUBLIC_BASE_URL=https://y5876647.eero.online:8443
EOF
if [[ ! -f /etc/systemd/system/kids-landline.service ]]; then
  cp /opt/kids-landline/deploy/kids-landline.service /etc/systemd/system/kids-landline.service
  systemctl enable kids-landline
fi
cp /opt/kids-landline/deploy/phonehome-bridge.service /etc/systemd/system/phonehome-bridge.service
systemctl daemon-reload
systemctl enable kids-landline phonehome-bridge
systemctl restart kids-landline
systemctl restart phonehome-bridge || systemctl start phonehome-bridge || true
sleep 2
systemctl is-active kids-landline
systemctl is-active phonehome-bridge || echo "bridge not active yet (check journalctl -u phonehome-bridge)"
curl -sS http://127.0.0.1:8787/api/health; echo
curl -sS http://127.0.0.1:8787/api/bridge/health; echo
curl -sS http://127.0.0.1:8790/health; echo
cat /var/lib/kids-landline/HOST_CODE.txt 2>/dev/null || true
REMOTE

echo "==> FreePBX CT 121 (dialplan + Flite + media cache for *98 IVR)"
FREEPBX_CT="${FREEPBX_CT:-121}"
TMP_EXT="$(ssh "$PVE" mktemp /tmp/ph-ext.XXXXXX.conf)"
TMP_FLITE="$(ssh "$PVE" mktemp /tmp/ph-flite.XXXXXX.conf)"
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/extensions_custom.conf $TMP_EXT"
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/flite.conf $TMP_FLITE"
ssh "$PVE" "pct push $FREEPBX_CT $TMP_EXT /etc/asterisk/extensions_custom.conf"
ssh "$PVE" "pct push $FREEPBX_CT $TMP_FLITE /etc/asterisk/flite.conf"
ssh "$PVE" "rm -f $TMP_EXT $TMP_FLITE"
ssh "$PVE" "pct exec $FREEPBX_CT -- bash -lc '
  set -e
  mkdir -p /var/cache/asterisk
  chown asterisk:asterisk /var/cache/asterisk
  chmod 775 /var/cache/asterisk
  asterisk -rx \"module reload app_flite.so\" >/dev/null 2>&1 || true
  fwconsole reload
  curl -sS -o /dev/null -w \"freepbx-media-health:%{http_code}\\n\" --connect-timeout 3 http://10.0.5.106:8790/health || true
'"

echo "==> Done"
