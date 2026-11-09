#!/usr/bin/env bash
# First-run installer inside a Mothership download bundle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PHONEHOME_ROOT="$ROOT"
export PATH="$ROOT/node/bin:$PATH"
OS="$(uname -s)"

pause_at_end() {
  echo ""
  read -r -p "Press Enter to close…" _ || true
}

on_error() {
  echo ""
  echo "✗ Install failed (line $1). See messages above."
  pause_at_end
}
trap 'on_error $LINENO' ERR

echo ""
echo "PhoneHome Mothership installer"
echo "  Folder: $ROOT"
echo ""

if [[ "$OS" == "Darwin" ]]; then
  # Finder / browser downloads mark everything quarantined — scripts won't run until cleared.
  if xattr -l "$ROOT" 2>/dev/null | grep -q com.apple.quarantine; then
    echo "Removing macOS quarantine (normal for downloaded files)…"
    xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null || true
  fi
fi

if [[ ! -x "$ROOT/node/bin/node" ]]; then
  echo "This bundle should include node/ — download from GitHub Releases." >&2
  pause_at_end
  exit 1
fi

"$ROOT/deploy/mothership-bundle/phonehome-bundle-init.sh"
PHONEHOME_ROOT="$ROOT" "$ROOT/deploy/install-service.sh"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Mothership is running"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  On this computer:  http://127.0.0.1:8787"
echo "  Config / logs:     $HOME/.phonehome/"
echo ""
echo "  First boot prints a setup code — check:"
echo "    $HOME/.phonehome/phonehome.log"
echo "    or $HOME/.phonehome/HOST_CODE.txt"
echo ""
echo "  On a phone: open your PUBLIC_BASE_URL → enter setup code → create Pod."
echo ""

if [[ "$OS" == "Darwin" ]]; then
  sleep 2
  if curl -fsS "http://127.0.0.1:8787/api/health" >/dev/null 2>&1; then
    echo "  Opening setup page in your browser…"
    open "http://127.0.0.1:8787" 2>/dev/null || true
  fi
fi

pause_at_end
