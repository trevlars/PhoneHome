#!/usr/bin/env bash
# Versioned tenant rollout with encrypted backup, health gate, and rollback.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANAGED="$ROOT/deploy/managed"
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 vX.Y.Z" >&2
  exit 1
fi
if ! git -C "$ROOT" diff --quiet || ! git -C "$ROOT" diff --cached --quiet; then
  echo "Refusing upgrade with tracked local changes." >&2
  exit 1
fi

previous="$(git -C "$ROOT" rev-parse HEAD)"
"$MANAGED/backup.sh"
git -C "$ROOT" fetch --tags --prune
git -C "$ROOT" rev-parse --verify "${TARGET}^{commit}" >/dev/null

rollback() {
  echo "Upgrade health gate failed; rolling back to $previous." >&2
  git -C "$ROOT" switch --detach "$previous"
  docker compose -f "$MANAGED/docker-compose.yml" --env-file "$MANAGED/.env" up -d --build
}
trap rollback ERR

git -C "$ROOT" switch --detach "$TARGET"
docker compose -f "$MANAGED/docker-compose.yml" --env-file "$MANAGED/.env" up -d --build
"$MANAGED/monitor.sh"
trap - ERR
echo "Managed Mothership upgraded to $TARGET."
