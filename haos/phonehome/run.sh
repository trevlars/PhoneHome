#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
set -euo pipefail

DATA_DIR="${PHONEHOME_DATA_DIR:-/data/phonehome}"
mkdir -p "$DATA_DIR"

LICENSE="$(bashio::config 'host_license' || true)"
ENFORCE="$(bashio::config 'host_license_enforce' || echo true)"
BUY_URL="$(bashio::config 'host_license_buy_url' || echo 'https://phonehome.app/buy')"
PUBLIC_URL="$(bashio::config 'public_base_url' || true)"

export HOST_LICENSE_BUY_URL="$BUY_URL"
if [[ "$ENFORCE" == "false" || "$ENFORCE" == "0" ]]; then
  export HOST_LICENSE_ENFORCE=0
else
  export HOST_LICENSE_ENFORCE=1
fi

# Public key ships in image / env for production builds; operators paste license blob only.
if [[ -n "${HOST_LICENSE_PUBLIC_KEY:-}" ]]; then
  :
elif [[ -f /opt/phonehome/host-license.pub ]]; then
  export HOST_LICENSE_PUBLIC_KEY="$(cat /opt/phonehome/host-license.pub)"
fi

if [[ -n "$LICENSE" ]]; then
  printf '%s\n' "$LICENSE" >"$DATA_DIR/host-license.blob"
  export HOST_LICENSE_BLOB="$LICENSE"
fi

export DATA_DIR="$DATA_DIR"
export PHONEHOME_DATA_DIR="$DATA_DIR"
if [[ -n "$PUBLIC_URL" ]]; then
  export PUBLIC_BASE_URL="$PUBLIC_URL"
fi

bashio::log.info "Starting PhoneHome Mothership (data=${DATA_DIR})"
cd /opt/phonehome/server
exec node dist/index.js
