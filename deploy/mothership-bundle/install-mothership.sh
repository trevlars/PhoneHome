#!/usr/bin/env bash
# First-run installer inside a Mothership download bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PHONEHOME_ROOT="$ROOT"
export PATH="$ROOT/node/bin:$PATH"

echo "PhoneHome Mothership installer"
echo "  Folder: $ROOT"
echo ""

if [[ ! -x "$ROOT/node/bin/node" ]]; then
  echo "This bundle should include node/ — use a release download from GitHub." >&2
  exit 1
fi

"$ROOT/deploy/phonehome-init.sh"
"$ROOT/deploy/install-service.sh"

echo ""
echo "Done. Open your PUBLIC_BASE_URL on a phone to finish Pod setup."
