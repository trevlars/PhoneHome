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

echo "==> npm build (server + web only)"
cd "$ROOT"
npm ci --workspace=server --workspace=web --include-workspace-root
npm run build -w web
npm run build -w server
(cd bridged && npm ci --omit=dev)

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> stage mothership tree"
mkdir -p "$STAGE/mothership"
# Do NOT exclude server/dist — a bare "dist" exclude wiped the compiled hub (exit 127 / missing tsx).
rsync -a \
  --exclude .git --exclude node_modules --exclude mobile --exclude hardware \
  --exclude hub-os --exclude lab --exclude data \
  --exclude /dist --exclude coverage --exclude macos \
  --exclude control --exclude gateway \
  "$ROOT/" "$STAGE/mothership/"

mkdir -p "$STAGE/mothership/server/dist" "$STAGE/mothership/web/public"
rsync -a "$ROOT/server/dist/" "$STAGE/mothership/server/dist/"
rsync -a "$ROOT/web/public/" "$STAGE/mothership/web/public/"
if [[ ! -f "$STAGE/mothership/server/dist/index.js" ]]; then
  echo "error: server/dist/index.js missing after stage" >&2
  exit 1
fi

cd "$STAGE/mothership"
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync("package.json","utf8"));
j.workspaces=["server","web"];
if(j.scripts){delete j.scripts["dev:gateway"];delete j.scripts["dev:control"];}
fs.writeFileSync("package.json",JSON.stringify(j,null,2)+"\n");
'
rm -f package-lock.json
npm install --omit=dev --no-audit --no-fund
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
test -f "$MACOS_RES/mothership/server/dist/index.js"
