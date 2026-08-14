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

ssh "$PVE" "pct exec $CTID -- bash -lc '
  set -e
  cd /opt/kids-landline
  npm install
  npm run build -w web
  if [[ ! -f /etc/systemd/system/kids-landline.service ]]; then
    cp /opt/kids-landline/deploy/kids-landline.service /etc/systemd/system/kids-landline.service
    systemctl daemon-reload
    systemctl enable kids-landline
  fi
  systemctl restart kids-landline
  sleep 2
  systemctl is-active kids-landline
  curl -sS http://127.0.0.1:8787/api/health
  echo
  cat /var/lib/kids-landline/HOST_CODE.txt 2>/dev/null || true
'"

echo "==> Done"
