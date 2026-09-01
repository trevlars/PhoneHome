#!/usr/bin/env bash
# Upload PhoneHome App Store / TestFlight listing (metadata + screenshots) via API.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/scripts/asc.env"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$HOME/GameSphere/Scripts/asc.env" ]]; then
    ENV_FILE="$HOME/GameSphere/Scripts/asc.env"
    echo "Using GameSphere asc.env"
  else
    echo "Missing $ROOT/scripts/asc.env"
    echo "  cp scripts/asc.env.example scripts/asc.env"
    echo "  # or: source ~/GameSphere/Scripts/asc.env"
    exit 1
  fi
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
export ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH

cd "$ROOT"
fastlane ios "${1:-upload_all}"
