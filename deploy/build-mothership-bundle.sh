#!/usr/bin/env bash
# Build a portable PhoneHome Mothership bundle (hub + bridge + embedded Node.js).
# Run on the target OS/arch (or CI). Output: dist/phonehome-mothership-<platform>.tar.gz|.zip
#
# Usage:
#   ./deploy/build-mothership-bundle.sh
#   MOTHERSHIP_PLATFORM=linux-x64 ./deploy/build-mothership-bundle.sh
#
# Version: MOTHERSHIP_VERSION > git tag vX.Y.Z (GitHub Actions) > package.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="${MOTHERSHIP_VERSION:-}"
if [[ -z "$VERSION" && "${GITHUB_REF_TYPE:-}" == "tag" && "${GITHUB_REF_NAME:-}" == v* ]]; then
  VERSION="${GITHUB_REF_NAME#v}"
fi
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version")"
fi
NODE_VERSION="${NODE_VERSION:-22.14.0}"
OUT_DIR="${OUT_DIR:-$ROOT/dist}"
PLATFORM="${MOTHERSHIP_PLATFORM:-}"

detect_platform() {
  case "$(uname -s)" in
    Linux)
      case "$(uname -m)" in
        x86_64|amd64) echo "linux-x64" ;;
        aarch64|arm64) echo "linux-arm64" ;;
        *) echo "unsupported" ;;
      esac
      ;;
    Darwin)
      case "$(uname -m)" in
        arm64) echo "darwin-arm64" ;;
        x86_64) echo "darwin-x64" ;;
        *) echo "unsupported" ;;
      esac
      ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) echo "win-x64" ;;
    *) echo "unsupported" ;;
  esac
}

if [[ -z "$PLATFORM" ]]; then
  PLATFORM="$(detect_platform)"
fi
if [[ "$PLATFORM" == "unsupported" ]]; then
  echo "unsupported platform — set MOTHERSHIP_PLATFORM manually" >&2
  exit 1
fi

STAGE="$OUT_DIR/stage-$PLATFORM"
BUNDLE="$STAGE/phonehome-mothership"
ARCHIVE_BASE="phonehome-mothership-v${VERSION}-${PLATFORM}"

node_dist() {
  case "$1" in
    linux-x64) echo "linux-x64" ;;
    linux-arm64) echo "linux-arm64" ;;
    darwin-arm64) echo "darwin-arm64" ;;
    darwin-x64) echo "darwin-x64" ;;
    win-x64) echo "win-x64" ;;
    *) echo "unknown" ;;
  esac
}

NODE_ARCH="$(node_dist "$PLATFORM")"
NODE_TARBALL="node-v${NODE_VERSION}-${NODE_ARCH}"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}.tar.xz"
WIN_ZIP="node-v${NODE_VERSION}-win-x64.zip"

echo "==> Building PhoneHome Mothership v${VERSION} for ${PLATFORM}"

rm -rf "$STAGE"
mkdir -p "$BUNDLE"

echo "==> npm install + build (server + web only — not control/gateway)"
cd "$ROOT"
# Host license control plane and APNs gateway are separate deployables; compiling
# them here pulls native deps (and breaks Windows runners that lack a matching VS).
npm ci --workspace=server --workspace=web --include-workspace-root
npm run build -w web
npm run build -w server
(cd bridged && npm ci --omit=dev)

echo "==> Copy app tree"
COPY_EXCLUDES=(
  --exclude .git
  --exclude node_modules
  --exclude mobile
  --exclude hardware
  --exclude hub-os
  --exclude lab
  --exclude data
  # Only repo-root packaging output — never exclude server/dist (hub needs it).
  --exclude /dist
  --exclude coverage
  --exclude control
  --exclude gateway
  --exclude macos
  --exclude '**/.DS_Store'
)
if command -v rsync >/dev/null 2>&1; then
  rsync -a "${COPY_EXCLUDES[@]}" "$ROOT/" "$BUNDLE/"
else
  (cd "$ROOT" && tar --exclude='./dist' --exclude='./node_modules' --exclude='./.git' \
    --exclude='./mobile' --exclude='./control' --exclude='./gateway' --exclude='./macos' \
    -c .) | (cd "$BUNDLE" && tar -x)
fi
# Belt-and-suspenders: compiled hub + static web must be present for supervisor.
mkdir -p "$BUNDLE/server/dist" "$BUNDLE/web/public"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$ROOT/server/dist/" "$BUNDLE/server/dist/"
  rsync -a "$ROOT/web/public/" "$BUNDLE/web/public/"
else
  cp -R "$ROOT/server/dist/." "$BUNDLE/server/dist/"
  cp -R "$ROOT/web/public/." "$BUNDLE/web/public/"
fi
if [[ ! -f "$BUNDLE/server/dist/index.js" ]]; then
  echo "error: server/dist/index.js missing after build — aborting bundle" >&2
  exit 1
fi

echo "==> Production node_modules"
cd "$BUNDLE"
# Bundle is mothership-only — trim workspaces so install does not pull control/gateway.
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync("package.json","utf8"));
j.workspaces=["server","web"];
if(j.scripts){delete j.scripts["dev:gateway"];delete j.scripts["dev:control"];}
fs.writeFileSync("package.json",JSON.stringify(j,null,2)+"\n");
'
# Lockfile still lists control/gateway; regenerate for the trimmed tree.
rm -f package-lock.json
npm install --omit=dev --no-audit --no-fund
(cd bridged && npm ci --omit=dev)

echo "==> Embed Node.js ${NODE_VERSION}"
mkdir -p "$BUNDLE/node"
if [[ "$PLATFORM" == "win-x64" ]]; then
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${WIN_ZIP}" -o "$STAGE/node.zip"
  unzip -q "$STAGE/node.zip" -d "$STAGE"
  mv "$STAGE/${NODE_TARBALL}/"* "$BUNDLE/node/"
else
  curl -fsSL "$NODE_URL" | tar -xJ -C "$STAGE"
  mv "$STAGE/${NODE_TARBALL}"/* "$BUNDLE/node/"
fi

cp "$ROOT/deploy/mothership-bundle/INSTALL.md" "$BUNDLE/INSTALL.md"
cp "$ROOT/deploy/mothership-bundle/START HERE.txt" "$BUNDLE/START HERE.txt"
cp "$ROOT/deploy/mothership-bundle/install-mothership.sh" "$BUNDLE/install-mothership.sh"
cp "$ROOT/deploy/mothership-bundle/phonehome-bundle-init.sh" "$BUNDLE/deploy/mothership-bundle/phonehome-bundle-init.sh"
cp "$ROOT/deploy/mothership-bundle/phonehome-bundle-init.ps1" "$BUNDLE/deploy/mothership-bundle/phonehome-bundle-init.ps1"
chmod +x "$BUNDLE/install-mothership.sh" "$BUNDLE/deploy/mothership-bundle/"*.sh 2>/dev/null || true

if [[ "$PLATFORM" == "darwin-arm64" || "$PLATFORM" == "darwin-x64" ]]; then
  cp "$ROOT/deploy/mothership-bundle/Install PhoneHome Mothership.command" \
    "$BUNDLE/Install PhoneHome Mothership.command"
  chmod +x "$BUNDLE/Install PhoneHome Mothership.command"
fi

if [[ "$PLATFORM" == "win-x64" ]]; then
  cp "$ROOT/deploy/mothership-bundle/install-mothership.ps1" "$BUNDLE/install-mothership.ps1"
fi

mkdir -p "$OUT_DIR"
if [[ "$PLATFORM" == "win-x64" || "$PLATFORM" == darwin-* ]]; then
  # .zip — Finder-friendly on Mac; Git Bash tar -a on Windows.
  (cd "$STAGE" && tar -acf "$OUT_DIR/${ARCHIVE_BASE}.zip" phonehome-mothership)
  echo "==> Wrote $OUT_DIR/${ARCHIVE_BASE}.zip"
else
  tar -czf "$OUT_DIR/${ARCHIVE_BASE}.tar.gz" -C "$STAGE" phonehome-mothership
  echo "==> Wrote $OUT_DIR/${ARCHIVE_BASE}.tar.gz"
fi

rm -rf "$STAGE" "$STAGE/node.zip" 2>/dev/null || true
