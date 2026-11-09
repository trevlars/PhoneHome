#!/usr/bin/env bash
# Write mobile/android/keystore.properties from scripts/play.env (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/scripts/play.env"
PROPS="$ROOT/android/keystore.properties"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — cp scripts/play.env.example scripts/play.env and fill signing passwords"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${PLAY_UPLOAD_KEYSTORE:?}"
: "${PLAY_UPLOAD_KEY_ALIAS:?}"
: "${PLAY_UPLOAD_STORE_PASSWORD:?}"
: "${PLAY_UPLOAD_KEY_PASSWORD:?}"

cat >"$PROPS" <<EOF
storeFile=${PLAY_UPLOAD_KEYSTORE}
storePassword=${PLAY_UPLOAD_STORE_PASSWORD}
keyAlias=${PLAY_UPLOAD_KEY_ALIAS}
keyPassword=${PLAY_UPLOAD_KEY_PASSWORD}
EOF

echo "Wrote $PROPS"
