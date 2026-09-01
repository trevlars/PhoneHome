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
  local to="$2"
  local dir="$SRC/$from"
  [[ -d "$dir" ]] || { echo "missing $dir — run: npm run app-store:screenshots" >&2; exit 1; }
  mkdir -p "$DEST/$to"
  local i=1
  for f in "$dir"/*.png; do
    [[ -f "$f" ]] || continue
    printf -v num "%02d" "$i"
    cp "$f" "$DEST/$to/${num}_$(basename "$f")"
    i=$((i + 1))
  done
  echo "  $from → en-US/$to ($((i - 1)) files)"
}

echo "Preparing deliver screenshots in $DEST"
copy_set "iphone-6.7" "iphone67"
copy_set "ipad-12.9" "ipadPro129"
copy_set "mac" "mac"
