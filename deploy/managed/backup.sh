#!/usr/bin/env bash
# Consistent, encrypted managed-tenant backup via restic.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANAGED="$ROOT/deploy/managed"
DATA_DIR="${PHONEHOME_DATA_DIR:-$MANAGED/data}"
DB_PATH="${PHONEHOME_DB_PATH:-$DATA_DIR/kids-landline.db}"
RESTIC_ENV="${RESTIC_ENV:-$MANAGED/restic.env}"

if [[ ! -r "$RESTIC_ENV" ]]; then
  echo "Missing $RESTIC_ENV (RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE are required)." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$RESTIC_ENV"
set +a
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE required}"
if [[ ! -r "$RESTIC_PASSWORD_FILE" ]]; then
  echo "RESTIC_PASSWORD_FILE is not readable." >&2
  exit 1
fi
command -v restic >/dev/null
command -v sqlite3 >/dev/null

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
install -d -m 700 "$stage/phonehome" "$stage/asterisk"

if [[ -f "$DB_PATH" ]]; then
  sqlite3 "$DB_PATH" ".timeout 10000" ".backup '$stage/phonehome/kids-landline.db'"
fi
for name in HOST_CODE.txt phonehome.env bridge.env; do
  [[ -r "$DATA_DIR/$name" ]] && install -m 600 "$DATA_DIR/$name" "$stage/phonehome/$name"
done
[[ -r "$MANAGED/.env" ]] && install -m 600 "$MANAGED/.env" "$stage/phonehome/managed.env"

for file in \
  pjsip.transports_custom.conf \
  pjsip.endpoint_custom_post.conf \
  pjsip.aor_custom_post.conf \
  rtp_custom.conf \
  extensions_custom.conf \
  sip_notify_custom.conf
do
  [[ -r "/etc/asterisk/$file" ]] && install -m 600 "/etc/asterisk/$file" "$stage/asterisk/$file"
done
if [[ -d /etc/asterisk/keys ]]; then
  tar -C /etc/asterisk -czf "$stage/asterisk/keys.tar.gz" keys
  chmod 600 "$stage/asterisk/keys.tar.gz"
fi

restic snapshots >/dev/null 2>&1 || restic init
restic backup "$stage" --tag phonehome-managed --host "$(hostname -s)"
restic forget --tag phonehome-managed --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune
restic check --read-data-subset=5%

echo "Encrypted PhoneHome backup completed."
