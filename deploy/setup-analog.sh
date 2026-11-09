#!/usr/bin/env bash
# PhoneHome analog (HT801) setup checklist — run on the PhoneHome host after phonehome-init.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$HOME/.phonehome}"
[[ -d /var/lib/kids-landline/phonehome.env ]] && DATA_DIR=/var/lib/kids-landline
[[ -f "${DATA_DIR}/phonehome.env" ]] || DATA_DIR="${DATA_DIR:-$HOME/.phonehome}"

ENV_FILE="$DATA_DIR/phonehome.env"
BRIDGE_FILE="$DATA_DIR/bridge.env"
SYNC_FILE="$DATA_DIR/freepbx-sync.env"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

step() { echo ""; echo "==> $*"; }

if [[ ! -f "$ENV_FILE" ]]; then
  red "Missing $ENV_FILE — run ./deploy/phonehome-init.sh first"
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
[[ -f "$BRIDGE_FILE" ]] && set -a && source "$BRIDGE_FILE" && set +a

step "1. Hub + bridge health"
if curl -sf "http://127.0.0.1:8787/api/health" >/dev/null; then
  green "Hub OK"
else
  red "Hub not running — npm run serve or ./deploy/install-service.sh"
  exit 1
fi
if curl -sf "http://127.0.0.1:8790/health" >/dev/null; then
  green "Bridge OK"
  curl -sS "http://127.0.0.1:8790/health" | head -c 200; echo ""
else
  red "Bridge not running (needed for analog ↔ softphone)"
  exit 1
fi

step "2. FreePBX ARI"
ARI_URL="${ARI_URL:-http://${SIP_SERVER:-127.0.0.1}:8088}"
if curl -sf -u "${ARI_USER:-phonehome}:${ARI_PASS:-}" "${ARI_URL%/}/ari/api.json" >/dev/null 2>&1; then
  green "ARI reachable at $ARI_URL"
else
  yellow "ARI not reachable at $ARI_URL"
  echo "  FreePBX → Settings → Asterisk REST Interface"
  echo "  User: ${ARI_USER:-phonehome}  App: ${ARI_APP:-phonehome}  (password in $BRIDGE_FILE)"
fi

step "3. FreePBX extension sync (auto-provision on Save)"
if [[ -f "$SYNC_FILE" ]] && grep -q '^FREEPBX_SYNC_URL=' "$SYNC_FILE"; then
  green "freepbx-sync.env present"
else
  yellow "Missing $SYNC_FILE — analog Save/Download will NOT create FreePBX extensions"
  echo ""
  echo "  On your FreePBX server (as root):"
  echo "    SIP_PUBLIC_HOST=${SIP_PUBLIC_HOST:-phonehome.yourname.net} \\"
  echo "      PHONEHOME_HOST_IP=<this host LAN IP> $ROOT/deploy/install-freepbx-sync.sh"
  echo ""
  echo "  Copy the printed freepbx-sync.env lines into $SYNC_FILE and restart PhoneHome."
fi
if [[ -z "${SIP_PUBLIC_HOST:-}" ]]; then
  red "SIP_PUBLIC_HOST unset in $ENV_FILE — remote ATAs will ring with no audio"
else
  green "SIP_PUBLIC_HOST=${SIP_PUBLIC_HOST}"
fi

step "4. FreePBX dialplan overlays"
echo "  Copy from $ROOT/bridged/freepbx/ to FreePBX /etc/asterisk/:"
echo "    extensions_custom.conf  pjsip.*_custom*.conf  rtp_custom.conf  flite.conf"
echo "  Then: fwconsole reload"
echo "  See docs/ht801-lab.md for RTP pin (10000–10200) after reload."

step "5. Public SIP + HTTPS"
echo "  PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-unset}"
echo "  SIP_PUBLIC_HOST=${SIP_PUBLIC_HOST:-unset}"
echo "  Router forwards: TCP 5061 (SIP TLS), UDP 10000–10200 (SRTP), HTTPS + TURN"
echo "  Cert: deploy/sync-phonehome-sip-cert.sh (SIP_HOST=\$SIP_PUBLIC_HOST)"

step "6. Parent flow"
echo "  App → Parent → Analog Phone → Save → Download config (or Set up adapter on LAN)"
echo "  Kid handset: 0=TreeHouse  1=Home/parent  2–9=speed dial  98 or *98=Messages (pulse: 98)"

step "7. Doctor (Proxmox lab)"
if [[ -x "$ROOT/deploy/phonehome-doctor.sh" ]]; then
  echo "  SIP_HOST=\${SIP_PUBLIC_HOST} EXT=2001 $ROOT/deploy/phonehome-doctor.sh"
fi

green "Analog setup checklist complete."
