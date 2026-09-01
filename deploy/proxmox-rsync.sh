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

# COPYFILE_DISABLE: skip macOS AppleDouble (._*) junk in the tar stream.
# Favicons live under web/src and are copied to web/public by npm run build -w web;
# do not add excludes for favicon* / *.ico / *.png — that would drop the hub icons.
export COPYFILE_DISABLE=1
tar -C "$ROOT" -cf - \
  --exclude .git \
  --exclude node_modules \
  --exclude data \
  --exclude '**/node_modules' \
  --exclude '**/data' \
  --exclude '**/._*' \
  --exclude '._*' \
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
if [[ ! -f /var/lib/kids-landline/phonehome.env ]]; then
  echo "Hint: run deploy/phonehome-init.sh on this CT (or copy phonehome.env) for PUBLIC_BASE_URL / SIP_PUBLIC_HOST"
fi
cat > /etc/systemd/system/kids-landline.service.d/bridge.conf <<'EOF'
[Service]
EnvironmentFile=-/var/lib/kids-landline/phonehome.env
EnvironmentFile=-/var/lib/kids-landline/bridge.env
EnvironmentFile=-/var/lib/kids-landline/freepbx-sync.env
Environment=BRIDGE_URL=http://127.0.0.1:8790
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
# Keep FreePBX RTP/TLS/AOR matched to remote ATA needs (ring/no-audio + dead Contact).
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/rtp_custom.conf /tmp/phonehome-rtp_custom.conf" 2>/dev/null || true
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/pjsip.transports_custom.conf /tmp/phonehome-pjsip.transports_custom.conf" 2>/dev/null || true
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/pjsip.aor_custom_post.conf /tmp/phonehome-pjsip.aor_custom_post.conf" 2>/dev/null || true
ssh "$PVE" "pct push $FREEPBX_CT $TMP_EXT /etc/asterisk/extensions_custom.conf"
ssh "$PVE" "pct push $FREEPBX_CT $TMP_FLITE /etc/asterisk/flite.conf"
ssh "$PVE" "pct push $FREEPBX_CT /tmp/phonehome-rtp_custom.conf /etc/asterisk/rtp_custom.conf" 2>/dev/null || true
ssh "$PVE" "pct push $FREEPBX_CT /tmp/phonehome-pjsip.transports_custom.conf /etc/asterisk/pjsip.transports_custom.conf" 2>/dev/null || true
ssh "$PVE" "pct push $FREEPBX_CT /tmp/phonehome-pjsip.aor_custom_post.conf /etc/asterisk/pjsip.aor_custom_post.conf" 2>/dev/null || true
ssh "$PVE" "rm -f $TMP_EXT $TMP_FLITE /tmp/phonehome-rtp_custom.conf /tmp/phonehome-pjsip.transports_custom.conf /tmp/phonehome-pjsip.aor_custom_post.conf"
ssh "$PVE" "pct exec $FREEPBX_CT -- bash -lc '
  set -e
  mkdir -p /var/cache/asterisk
  chown asterisk:asterisk /var/cache/asterisk
  chmod 775 /var/cache/asterisk
  asterisk -rx \"module reload app_flite.so\" >/dev/null 2>&1 || true
  # Dialplan/flite/AOR overlays — full reload regenerates rtp_additional to 20000.
  fwconsole reload
  # CRITICAL: pin AFTER reload. Asterisk reads rtp_additional before rtp_custom,
  # so custom alone never wins. Mismatch with eero UDP 10000–10200 = ring/no audio.
  if [[ -f /etc/asterisk/rtp_additional.conf ]]; then
    sed -i \"s/^rtpstart=.*/rtpstart=10000/\" /etc/asterisk/rtp_additional.conf || true
    sed -i \"s/^rtpend=.*/rtpend=10200/\" /etc/asterisk/rtp_additional.conf || true
    sed -i \"s/^strictrtp=.*/strictrtp=no/\" /etc/asterisk/rtp_additional.conf || true
  fi
  asterisk -rx \"module reload res_rtp_asterisk.so\" >/dev/null 2>&1 || true
  curl -sS -o /dev/null -w \"freepbx-media-health:%{http_code}\\n\" --connect-timeout 3 http://10.0.5.106:8790/health || true
  asterisk -rx \"rtp show settings\" 2>/dev/null | grep -E \"Port (start|end)\" || true
'"

echo "==> Done"
