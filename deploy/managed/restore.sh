#!/usr/bin/env bash
# Restore the latest encrypted managed-tenant backup with local rollback.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANAGED="$ROOT/deploy/managed"
DATA_DIR="${PHONEHOME_DATA_DIR:-$MANAGED/data}"
RESTIC_ENV="${RESTIC_ENV:-$MANAGED/restic.env}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root so Asterisk material can be restored safely." >&2
  exit 1
fi
if [[ ! -r "$RESTIC_ENV" ]]; then
  echo "Missing $RESTIC_ENV." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$RESTIC_ENV"
set +a
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE required}"

stage="$(mktemp -d)"
rollback="$MANAGED/restore-rollback-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -rf "$stage"' EXIT
restic restore latest --tag phonehome-managed --target "$stage"
[[ -r "$stage/phonehome/kids-landline.db" ]] || {
  echo "Backup does not contain a PhoneHome database." >&2
  exit 1
}

docker compose -f "$MANAGED/docker-compose.yml" --env-file "$MANAGED/.env" down
install -d -m 700 "$rollback"
[[ -d "$DATA_DIR" ]] && cp -a "$DATA_DIR" "$rollback/data"
[[ -r "$MANAGED/.env" ]] && cp -a "$MANAGED/.env" "$rollback/managed.env"

install -d -m 700 "$DATA_DIR"
install -m 600 "$stage/phonehome/kids-landline.db" "$DATA_DIR/kids-landline.db"
for name in HOST_CODE.txt phonehome.env bridge.env; do
  [[ -r "$stage/phonehome/$name" ]] && install -m 600 "$stage/phonehome/$name" "$DATA_DIR/$name"
done
[[ -r "$stage/phonehome/managed.env" ]] &&
  install -m 600 "$stage/phonehome/managed.env" "$MANAGED/.env"

for file in "$stage"/asterisk/*.conf; do
  [[ -r "$file" ]] || continue
  install -m 640 -o asterisk -g asterisk "$file" "/etc/asterisk/$(basename "$file")"
done
if [[ -r "$stage/asterisk/keys.tar.gz" ]]; then
  tar -C /etc/asterisk -xzf "$stage/asterisk/keys.tar.gz"
  chown -R asterisk:asterisk /etc/asterisk/keys
  chmod 750 /etc/asterisk/keys
  chmod 640 /etc/asterisk/keys/*
fi
command -v fwconsole >/dev/null 2>&1 && fwconsole reload >/dev/null

docker compose -f "$MANAGED/docker-compose.yml" --env-file "$MANAGED/.env" up -d
host="$(awk -F= '$1=="PHONEHOME_HOST"{print $2}' "$MANAGED/.env" | tail -1)"
if [[ -z "$host" ]] || ! curl -fsS --retry 12 --retry-delay 5 "https://$host/api/health" >/dev/null; then
  echo "Restored tenant failed health verification. Previous files remain at $rollback." >&2
  exit 1
fi
echo "Restore verified. Previous local state is preserved at $rollback."
