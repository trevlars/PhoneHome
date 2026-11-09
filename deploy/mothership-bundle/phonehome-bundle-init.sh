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
existing_duck_domain=""
existing_duck_token=""
existing_duck_port="8443"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  existing_pub="${PUBLIC_BASE_URL:-}"
  existing_duck_domain="${DUCKDNS_DOMAIN:-}"
  existing_duck_token="${DUCKDNS_TOKEN:-}"
  existing_duck_port="${DUCKDNS_HTTPS_PORT:-8443}"
fi

normalize_duck_domain() {
  local d
  d="$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*##; s#:.*##; s/\.duckdns\.org$//')"
  if [[ "$d" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    echo "$d"
  else
    echo ""
  fi
}

echo "Step 1 — Public hostname (phones need HTTPS)"
echo ""
echo "  Recommended: DuckDNS (free hostname that follows your home IP)"
echo "    1. Open https://www.duckdns.org  → sign in → create a subdomain"
echo "    2. Copy the token shown on that page"
echo "    3. Enter them below — Mothership will keep DNS updated for you"
echo ""
echo "  Still need on your router: forward TCP ${existing_duck_port} → this machine"
echo "  (HTTPS in front of PhoneHome :8787, e.g. Caddy + Let's Encrypt)."
echo ""
echo "  Other options later: Cloudflare Tunnel or your own domain"
echo "  (see INSTALL.md)."
echo ""

read -r -p "DuckDNS subdomain [${existing_duck_domain:-skip}]: " duck_in
duck_in="${duck_in:-$existing_duck_domain}"
DUCKDNS_DOMAIN="$(normalize_duck_domain "$duck_in")"
DUCKDNS_TOKEN=""
DUCKDNS_HTTPS_PORT="$existing_duck_port"
PUBLIC_BASE_URL=""
SIP_PUBLIC_HOST="phonehome.local"

if [[ -n "$DUCKDNS_DOMAIN" ]]; then
  read -r -p "DuckDNS token [${existing_duck_token:+saved}]: " token_in
  DUCKDNS_TOKEN="${token_in:-$existing_duck_token}"
  if [[ -z "$DUCKDNS_TOKEN" ]]; then
    echo "No token — DuckDNS skipped for now." >&2
    DUCKDNS_DOMAIN=""
  else
    read -r -p "HTTPS port on DuckDNS hostname [$existing_duck_port]: " port_in
    DUCKDNS_HTTPS_PORT="${port_in:-$existing_duck_port}"
    DUCKDNS_HTTPS_PORT="${DUCKDNS_HTTPS_PORT:-8443}"
    if [[ "$DUCKDNS_HTTPS_PORT" == "443" ]]; then
      PUBLIC_BASE_URL="https://${DUCKDNS_DOMAIN}.duckdns.org"
    else
      PUBLIC_BASE_URL="https://${DUCKDNS_DOMAIN}.duckdns.org:${DUCKDNS_HTTPS_PORT}"
    fi
    SIP_PUBLIC_HOST="${DUCKDNS_DOMAIN}.duckdns.org"
    echo ""
    echo "  Updating DuckDNS…"
    if body="$(curl -fsS --max-time 20 \
      "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" 2>/dev/null)"; then
      if [[ "$body" == OK* ]]; then
        echo "  ✓ DuckDNS OK — ${DUCKDNS_DOMAIN}.duckdns.org"
      else
        echo "  ! DuckDNS responded: ${body} (check subdomain/token; continuing)" >&2
      fi
    else
      echo "  ! Could not reach DuckDNS (continuing; updater retries when Mothership runs)" >&2
    fi
  fi
fi

if [[ -z "$PUBLIC_BASE_URL" ]]; then
  echo ""
  echo "  Optional: paste an existing HTTPS URL (Cloudflare Tunnel / own domain),"
  echo "  or press Enter to skip."
  read -r -p "HTTPS URL [${existing_pub:-}]: " PUBLIC_BASE_URL
  PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-${existing_pub:-}}"
  if [[ -n "$PUBLIC_BASE_URL" && ! "$PUBLIC_BASE_URL" =~ ^https:// ]]; then
    echo "URL must start with https:// — skipping for now." >&2
    PUBLIC_BASE_URL=""
  fi
  if [[ -n "$PUBLIC_BASE_URL" ]]; then
    SIP_PUBLIC_HOST="$(node -e "try{console.log(new URL(process.argv[1]).hostname)}catch{}" "$PUBLIC_BASE_URL" 2>/dev/null || true)"
  fi
  SIP_PUBLIC_HOST="${SIP_PUBLIC_HOST:-phonehome.local}"
fi

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
DUCKDNS_DOMAIN=${DUCKDNS_DOMAIN}
DUCKDNS_TOKEN=${DUCKDNS_TOKEN}
DUCKDNS_HTTPS_PORT=${DUCKDNS_HTTPS_PORT:-8443}
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

if [[ -n "$DUCKDNS_DOMAIN" ]]; then
  echo ""
  echo "  DuckDNS: ${DUCKDNS_DOMAIN}.duckdns.org (updater runs with Mothership)"
  echo "  Phones:  ${PUBLIC_BASE_URL}"
  echo "  Next:    HTTPS reverse proxy + router forward → this host :8787"
elif [[ -z "$PUBLIC_BASE_URL" ]]; then
  echo ""
  echo "  No public URL yet — that's OK."
  echo "  Re-run setup or edit $ENV_FILE"
  echo "  Set DUCKDNS_DOMAIN + DUCKDNS_TOKEN (or PUBLIC_BASE_URL=https://…)"
fi

if [[ -n "$SYNC_NOTE" ]]; then
  echo ""
  echo "$SYNC_NOTE"
fi
