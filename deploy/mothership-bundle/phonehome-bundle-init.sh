#!/usr/bin/env bash
# Short first-run setup for download bundles (not git clones).
set -euo pipefail

ROOT="${PHONEHOME_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${DATA_DIR:-$HOME/.phonehome}"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR" 2>/dev/null || true

ENV_FILE="$DATA_DIR/phonehome.env"
BRIDGE_FILE="$DATA_DIR/bridge.env"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PhoneHome Mothership — quick setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Config folder: $DATA_DIR"
echo ""

existing_pub=""
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  existing_pub="${PUBLIC_BASE_URL:-}"
fi

echo "Step 1 — Public HTTPS URL (for phones)"
echo ""
echo "  Parents open this link on their phones. It must start with https://"
echo ""
echo "  Easiest (free, no router config):"
echo "    brew install cloudflared"
echo "    cloudflared tunnel --url http://127.0.0.1:8787"
echo "  Copy the https://….trycloudflare.com URL it prints."
echo ""
read -r -p "Paste HTTPS URL now, or press Enter to skip for later: " PUBLIC_BASE_URL
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-${existing_pub:-}}"

if [[ -n "$PUBLIC_BASE_URL" && ! "$PUBLIC_BASE_URL" =~ ^https:// ]]; then
  echo "URL must start with https:// — skipping for now." >&2
  PUBLIC_BASE_URL=""
fi

SIP_PUBLIC_HOST=""
if [[ -n "$PUBLIC_BASE_URL" ]]; then
  SIP_PUBLIC_HOST="$(node -e "try{console.log(new URL(process.argv[1]).hostname)}catch{}" "$PUBLIC_BASE_URL" 2>/dev/null || true)"
fi
SIP_PUBLIC_HOST="${SIP_PUBLIC_HOST:-phonehome.local}"

echo ""
echo "Step 2 — Analog landline (Grandstream HT801)?"
read -r -p "Setting up a house phone adapter? [y/N]: " analog
analog="${analog:-N}"

SIP_SERVER="127.0.0.1"
EXT_MEDIA_HOST="127.0.0.1"
ATA_LAN_PUSH=0
TURN_BLOCK=""
SYNC_NOTE=""

if [[ "$analog" =~ ^[Yy] ]]; then
  ATA_LAN_PUSH=1
  if command -v ip >/dev/null 2>&1; then
    EXT_MEDIA_HOST="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}' || true)"
  elif command -v ifconfig >/dev/null 2>&1; then
    EXT_MEDIA_HOST="$(ifconfig 2>/dev/null | awk '/inet / && $2!="127.0.0.1"{print $2; exit}' || true)"
  fi
  EXT_MEDIA_HOST="${EXT_MEDIA_HOST:-127.0.0.1}"
  read -r -p "FreePBX IP on your LAN [$SIP_SERVER]: " sip_in
  SIP_SERVER="${sip_in:-$SIP_SERVER}"
  SYNC_NOTE="  • Analog: see INSTALL.md → HT801 section"
fi

umask 077
cat >"$ENV_FILE" <<EOF
# PhoneHome Mothership — edit and restart if you change these.
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
SIP_PUBLIC_HOST=${SIP_PUBLIC_HOST}
PORT=8787
DATA_DIR=${DATA_DIR}
NODE_ENV=production
SIP_SERVER=${SIP_SERVER}
BRIDGE_URL=http://127.0.0.1:8790
ATA_LAN_PUSH=${ATA_LAN_PUSH}
${TURN_BLOCK}
EOF

if [[ -f "$BRIDGE_FILE" ]] && grep -q '^BRIDGE_SECRET=' "$BRIDGE_FILE"; then
  BRIDGE_SECRET="$(grep '^BRIDGE_SECRET=' "$BRIDGE_FILE" | cut -d= -f2-)"
else
  BRIDGE_SECRET="$(openssl rand -base64 32 2>/dev/null | tr -d '=+/' | cut -c1-40 || head -c 40 /dev/urandom | base64 | tr -d '=+/' | cut -c1-40)"
fi

ari_pass="$(openssl rand -base64 18 2>/dev/null | tr -d '=+/' | cut -c1-24 || echo "change-me")"

cat >"$BRIDGE_FILE" <<EOF
BRIDGE_SECRET=${BRIDGE_SECRET}
PHONEHOME_URL=http://127.0.0.1:8787
PHONEHOME_WS=ws://127.0.0.1:8787/ws
ARI_URL=http://${SIP_SERVER}:8088
ARI_USER=phonehome
ARI_PASS=${ari_pass}
ARI_APP=phonehome
EXT_MEDIA_HOST=${EXT_MEDIA_HOST}
EXT_MEDIA_PORT_BASE=14000
BRIDGE_HTTP_PORT=8790
BRIDGE_HTTP_BIND=0.0.0.0
EOF

echo ""
echo "✓ Wrote $ENV_FILE"
echo "✓ Wrote $BRIDGE_FILE"

if [[ -z "$PUBLIC_BASE_URL" ]]; then
  echo ""
  echo "  No HTTPS URL yet — that's OK."
  echo "  After install, edit $ENV_FILE"
  echo "  Set PUBLIC_BASE_URL=https://your-tunnel-url"
  echo "  Then restart: launchctl kickstart -k gui/\$(id -u)/com.phonehome.server"
fi

if [[ -n "$SYNC_NOTE" ]]; then
  echo ""
  echo "$SYNC_NOTE"
fi
