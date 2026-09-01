#!/usr/bin/env bash
# Stage Node + Mothership server tree into the macOS app Resources folder.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MACOS_RES="$ROOT/macos/Mothership/Resources"
NODE_VERSION="${NODE_VERSION:-22.14.0}"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) NODE_ARCH=darwin-arm64 ;;
  x86_64) NODE_ARCH=darwin-x64 ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

echo "==> npm build"
cd "$ROOT"
npm ci
npm run build
(cd bridged && npm ci --omit=dev)

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> stage mothership tree"
mkdir -p "$STAGE/mothership"
rsync -a \
  --exclude .git --exclude node_modules --exclude mobile --exclude hardware \
  --exclude hub-os --exclude digits-fork --exclude lab --exclude data \
  --exclude dist --exclude coverage --exclude macos \
  "$ROOT/" "$STAGE/mothership/"

cd "$STAGE/mothership"
npm ci --omit=dev
(cd bridged && npm ci --omit=dev)

echo "==> embed Node.js $NODE_VERSION ($NODE_ARCH)"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_ARCH}.tar.xz" \
  | tar -xJ -C "$STAGE"
NODE_DIR="$STAGE/node-v${NODE_VERSION}-${NODE_ARCH}"

rm -rf "$MACOS_RES/mothership" "$MACOS_RES/node"
mkdir -p "$MACOS_RES"
mv "$STAGE/mothership" "$MACOS_RES/"
mv "$NODE_DIR" "$MACOS_RES/node"

echo "==> Resources ready at $MACOS_RES"
du -sh "$MACOS_RES"
