#!/usr/bin/env bash
# Copy the managed Caddy certificate to co-located Asterisk for SIP TLS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SIP_HOST="${SIP_HOST:-}"
CADDY_DATA="${CADDY_DATA:-$ROOT/deploy/managed/caddy-data}"
DEST_DIR="${ASTERISK_KEY_DIR:-/etc/asterisk/keys}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the managed VPS." >&2
  exit 1
fi
if [[ -z "$SIP_HOST" ]]; then
  echo "SIP_HOST is required." >&2
  exit 1
fi

shopt -s nullglob
certs=("$CADDY_DATA"/caddy/certificates/*/"$SIP_HOST"/"$SIP_HOST".crt)
keys=("$CADDY_DATA"/caddy/certificates/*/"$SIP_HOST"/"$SIP_HOST".key)
if [[ ${#certs[@]} -ne 1 || ${#keys[@]} -ne 1 ]]; then
  echo "Expected one Caddy certificate/key for $SIP_HOST under $CADDY_DATA." >&2
  exit 1
fi
src_crt="${certs[0]}"
src_key="${keys[0]}"

issuer="$(openssl x509 -in "$src_crt" -noout -issuer)"
if [[ "$issuer" != *"Let's Encrypt"* && "$issuer" != *"ISRG"* && "${ALLOW_NON_LE:-0}" != "1" ]]; then
  echo "Refusing non-Let's Encrypt certificate: $issuer" >&2
  exit 1
fi
if ! openssl x509 -in "$src_crt" -noout -checkhost "$SIP_HOST" >/dev/null; then
  echo "Certificate does not cover SIP_HOST=$SIP_HOST." >&2
  exit 1
fi

install -d -m 750 -o asterisk -g asterisk "$DEST_DIR"
install -m 640 -o asterisk -g asterisk "$src_crt" "$DEST_DIR/phonehome-sip.crt"
install -m 640 -o asterisk -g asterisk "$src_key" "$DEST_DIR/phonehome-sip.key"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cat "$src_crt" "$src_key" >"$tmp"
install -m 640 -o asterisk -g asterisk "$tmp" "$DEST_DIR/phonehome-sip.pem"

if command -v fwconsole >/dev/null 2>&1; then
  fwconsole reload >/dev/null
else
  asterisk -rx "module reload res_pjsip.so" >/dev/null
fi
echo "Synced public SIP TLS certificate for $SIP_HOST."
