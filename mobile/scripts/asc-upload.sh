#!/usr/bin/env bash
# Upload PhoneHome App Store / TestFlight listing (metadata + screenshots) via API.
#   ./scripts/asc-upload.sh upload_testflight  # What to Test + beta description on latest build
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/scripts/asc.env"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$HOME/path/to/asc.env" ]]; then
    ENV_FILE="$HOME/path/to/asc.env"
    echo "Using another app asc.env"
  else
    echo "Missing $ROOT/scripts/asc.env"
    echo "  cp scripts/asc.env.example scripts/asc.env"
    echo "  # or: source ~/path/to/asc.env"
    exit 1
  fi
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
export ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH
# Optional: App Review demo password for deliver (see review_information/demo_user.txt)
[[ -n "${ASC_REVIEW_DEMO_PASSWORD:-}" ]] && export ASC_REVIEW_DEMO_PASSWORD

cd "$ROOT"
fastlane ios "${1:-upload_all}"
