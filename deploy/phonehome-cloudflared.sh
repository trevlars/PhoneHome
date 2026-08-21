#!/bin/bash
# Run on the Proxmox host (not inside the CT).
# Starts a Cloudflare quick tunnel and syncs PUBLIC_BASE_URL + TURN into CT 122.
set -euo pipefail
LOG=/var/log/phonehome-cloudflared.log
umask 077
: > "$LOG"
# Prefer HTTP/2 — QUIC to Cloudflare edge has been flaky on this host.
/usr/bin/cloudflared tunnel --no-autoupdate --protocol http2 --url http://10.0.5.106:8787 2>&1 | tee -a "$LOG" &
CFPID=$!
synced=""
for _ in $(seq 1 90); do
  if ! kill -0 "$CFPID" 2>/dev/null; then
    wait "$CFPID" || true
    exit 1
  fi
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | grep -v 'api\.trycloudflare' | tail -1 || true)
  if [[ -n "$URL" && "$URL" != "$synced" ]]; then
    /usr/local/sbin/phonehome-sync-public-url.sh "$URL" || true
    synced="$URL"
    break
  fi
  sleep 1
done
wait "$CFPID"
