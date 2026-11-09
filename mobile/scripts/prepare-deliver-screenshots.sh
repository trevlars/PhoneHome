#!/usr/bin/env bash
# Map PhoneHome generated screenshots → fastlane deliver layout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/app-store/screenshots"
DEST="$ROOT/app-store/screenshots-deliver/en-US"

rm -rf "$DEST"
mkdir -p "$DEST"

copy_set() {
  local from="$1"
  local prefix="$2"
  local dir="$SRC/$from"
  [[ -d "$dir" ]] || { echo "missing $dir — run: npm run app-store:screenshots" >&2; exit 1; }
  local i=1
  for f in "$dir"/*.png; do
    [[ -f "$f" ]] || continue
    printf -v num "%02d" "$i"
    # Deliver only scans images directly inside the locale directory. Device
    # subfolders are silently ignored while fastlane still reports success.
    cp "$f" "$DEST/${prefix}_${num}_$(basename "$f")"
    i=$((i + 1))
  done
  echo "  $from → en-US/${prefix}_*.png ($((i - 1)) files)"
}

echo "Preparing deliver screenshots in $DEST"
copy_set "iphone-6.7" "iphone67"
copy_set "ipad-12.9" "ipadPro129"

# Designed-for-iPhone/iPad apps inherit their iOS screenshots on Apple silicon.
# A 1280×800 desktop set belongs to a separate macOS App Store version and must
# not be mixed into this iOS version.
