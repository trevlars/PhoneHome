#!/usr/bin/env bash
# First-boot setup for PhoneHome Mothership Docker (Unraid, compose, etc.)
set -euo pipefail

DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR" 2>/dev/null || true

ENV_FILE="$DATA_DIR/phonehome.env"
BRIDGE_FILE="$DATA_DIR/bridge.env"

rand_secret() {
  openssl rand -base64 32 2>/dev/null | tr -d '=+/' | cut -c1-40 \
    || head -c 40 /dev/urandom | base64 | tr -d '=+/' | cut -c1-40
}

if [[ ! -f "$BRIDGE_FILE" ]]; then
  umask 077
  cat >"$BRIDGE_FILE" <<EOF
BRIDGE_SECRET=$(rand_secret)
PHONEHOME_URL=http://127.0.0.1:8787
PHONEHOME_WS=ws://127.0.0.1:8787/ws
ARI_URL=${ARI_URL:-http://host.docker.internal:8088}
ARI_USER=${ARI_USER:-phonehome}
ARI_PASS=${ARI_PASS:-change-me}
ARI_APP=phonehome
EXT_MEDIA_HOST=${EXT_MEDIA_HOST:-127.0.0.1}
EXT_MEDIA_PORT_BASE=14000
BRIDGE_HTTP_PORT=8790
BRIDGE_HTTP_BIND=0.0.0.0
EOF
fi

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  host_hint="${PUBLIC_BASE_URL:-}"
  if [[ -z "$host_hint" ]]; then
    host_hint="https://phonehome.example.com:8443"
  fi
  sip_host="${SIP_PUBLIC_HOST:-}"
  if [[ -z "$sip_host" ]] && [[ "$host_hint" =~ ^https?:// ]]; then
    sip_host="$(node -e "try{console.log(new URL(process.argv[1]).hostname)}catch{}" "$host_hint" 2>/dev/null || true)"
  fi
  cat >"$ENV_FILE" <<EOF
# Edit on the host (appdata volume) or via container env vars, then restart.
PUBLIC_BASE_URL=${host_hint}
SIP_PUBLIC_HOST=${sip_host:-phonehome.example.com}
PORT=8787
DATA_DIR=${DATA_DIR}
NODE_ENV=production
BRIDGE_URL=http://127.0.0.1:8790
SIP_SERVER=${SIP_SERVER:-host.docker.internal}
ATA_LAN_PUSH=${ATA_LAN_PUSH:-0}
EOF
fi

# Docker env vars override persisted files (Unraid template fields).
upsert_env() {
  local file="$1" key="$2" val="$3"
  [[ -z "$val" ]] && return 0
  local tmp
  tmp="$(mktemp)"
  if [[ -f "$file" ]]; then
    grep -v "^${key}=" "$file" >"$tmp" || true
  else
    : >"$tmp"
  fi
  printf '%s=%s\n' "$key" "$val" >>"$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file" 2>/dev/null || true
}

for key in PUBLIC_BASE_URL SIP_PUBLIC_HOST SIP_SERVER ATA_LAN_PUSH \
  DUCKDNS_DOMAIN DUCKDNS_TOKEN DUCKDNS_HTTPS_PORT \
  TURN_URLS TURN_USERNAME TURN_CREDENTIAL BRIDGE_SECRET ARI_URL ARI_USER ARI_PASS EXT_MEDIA_HOST; do
  val="${!key:-}"
  case "$key" in
    BRIDGE_SECRET|ARI_*|EXT_MEDIA_HOST|TURN_*)
      upsert_env "$BRIDGE_FILE" "$key" "$val"
      ;;
    *)
      upsert_env "$ENV_FILE" "$key" "$val"
      ;;
  esac
done

if [[ -n "${PUID:-}" ]] && [[ -n "${PGID:-}" ]]; then
  chown -R "${PUID}:${PGID}" "$DATA_DIR" 2>/dev/null || true
fi

export DATA_DIR
export PORT="${PORT:-8787}"

exec "$@"
