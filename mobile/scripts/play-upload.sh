#!/usr/bin/env bash
# PhoneHome Google Play upload (internal testing ≈ TestFlight).
#   ./scripts/play-upload.sh build_release
#   ./scripts/play-upload.sh upload_internal
#   ./scripts/play-upload.sh release_internal   # listing + AAB → internal track
#   ./scripts/play-upload.sh upload_open        # AAB → open testing (public opt-in)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/scripts/play.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "  cp scripts/play.env.example scripts/play.env"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
export PLAY_PACKAGE_NAME PLAY_JSON_KEY_PATH
export PLAY_UPLOAD_KEYSTORE PLAY_UPLOAD_KEY_ALIAS PLAY_UPLOAD_STORE_PASSWORD PLAY_UPLOAD_KEY_PASSWORD

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$PATH"

cd "$ROOT"
fastlane android "${1:-release_internal}"
