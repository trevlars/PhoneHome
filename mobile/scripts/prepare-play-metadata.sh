#!/usr/bin/env bash
# Map App Store metadata + screenshots into fastlane supply layout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_META="$ROOT/app-store/metadata/en-US"
DEST="$ROOT/play-store/metadata/android/en-US"
IMG="$DEST/images"

mkdir -p "$IMG/phoneScreenshots"

cp "$SRC_META/name.txt" "$DEST/title.txt"
cp "$SRC_META/subtitle.txt" "$DEST/short_description.txt"
cp "$SRC_META/description.txt" "$DEST/full_description.txt"
# Play wants a 512 icon and 1024x500 feature graphic.
python3 - <<PY
from PIL import Image
from pathlib import Path
root = Path("$ROOT")
img_dir = root / "play-store/metadata/android/en-US/images"
hero = root / "app-store/screenshots/iphone-6.7/01-speed-dial.png"
icon_src = root / "app-store/metadata/app_icon.png"
img = Image.open(hero).convert("RGB")
tw, th = 1024, 500
ratio = tw / th
sw, sh = img.size
if sw / sh > ratio:
    nw, nh = int(sh * ratio), sh
else:
    nw, nh = sw, int(sw / ratio)
left, top = (sw - nw) // 2, (sh - nh) // 2
img.crop((left, top, left + nw, top + nh)).resize((tw, th), Image.LANCZOS).save(img_dir / "featureGraphic.png")
Image.open(icon_src).convert("RGBA").resize((512, 512), Image.LANCZOS).save(img_dir / "icon.png")
PY

idx=1
for shot in "$ROOT/app-store/screenshots/iphone-6.7"/*.png; do
  [[ -f "$shot" ]] || continue
  cp "$shot" "$IMG/phoneScreenshots/$(printf '%02d' "$idx")-$(basename "$shot")"
  idx=$((idx + 1))
done

echo "Prepared supply metadata under $DEST ($(ls "$IMG/phoneScreenshots" | wc -l | tr -d ' ') phone screenshots)"
