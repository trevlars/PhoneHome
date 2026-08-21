#!/usr/bin/env bash
# Copy Caddy's Let's Encrypt cert for the public SIP hostname onto FreePBX
# Asterisk TLS files, then reload the PJSIP TLS transport.
#
# Run on the Proxmox host (root). Safe to cron / systemd timer after Caddy renews.
#
# Usage:
#   ./deploy/sync-phonehome-sip-cert.sh
#   SIP_HOST=y5876647.eero.online FREEPBX_CT=121 ./deploy/sync-phonehome-sip-cert.sh
set -euo pipefail

SIP_HOST="${SIP_HOST:-y5876647.eero.online}"
FREEPBX_CT="${FREEPBX_CT:-121}"
CADDY_CERT_DIR="${CADDY_CERT_DIR:-/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${SIP_HOST}}"
SRC_CRT="${CADDY_CERT_DIR}/${SIP_HOST}.crt"
SRC_KEY="${CADDY_CERT_DIR}/${SIP_HOST}.key"
DEST_DIR=/etc/asterisk/keys
DEST_CRT="${DEST_DIR}/phonehome-sip.crt"
DEST_KEY="${DEST_DIR}/phonehome-sip.key"
DEST_PEM="${DEST_DIR}/phonehome-sip.pem"

if [[ ! -r "$SRC_CRT" || ! -r "$SRC_KEY" ]]; then
  echo "error: Caddy LE material not readable:" >&2
  echo "  $SRC_CRT" >&2
  echo "  $SRC_KEY" >&2
  exit 1
fi

# Refuse to install a self-signed / non-public leaf
issuer="$(openssl x509 -in "$SRC_CRT" -noout -issuer 2>/dev/null || true)"
if [[ "$issuer" != *"Let's Encrypt"* && "$issuer" != *"ISRG"* && "${ALLOW_NON_LE:-0}" != "1" ]]; then
  echo "error: expected Let's Encrypt issuer, got: $issuer" >&2
  echo "set ALLOW_NON_LE=1 to override" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Full chain as presented by Caddy (leaf + intermediates)
cp -f "$SRC_CRT" "$tmp/phonehome-sip.crt"
cp -f "$SRC_KEY" "$tmp/phonehome-sip.key"
cat "$tmp/phonehome-sip.crt" "$tmp/phonehome-sip.key" >"$tmp/phonehome-sip.pem"
chmod 640 "$tmp/phonehome-sip.crt" "$tmp/phonehome-sip.key" "$tmp/phonehome-sip.pem"

pct exec "$FREEPBX_CT" -- mkdir -p "$DEST_DIR"
# Push via stdin so we never leave key material on the PVE host disk longer than needed
pct push "$FREEPBX_CT" "$tmp/phonehome-sip.crt" "$DEST_CRT"
pct push "$FREEPBX_CT" "$tmp/phonehome-sip.key" "$DEST_KEY"
pct push "$FREEPBX_CT" "$tmp/phonehome-sip.pem" "$DEST_PEM"
pct exec "$FREEPBX_CT" -- chown asterisk:asterisk "$DEST_CRT" "$DEST_KEY" "$DEST_PEM"
pct exec "$FREEPBX_CT" -- chmod 640 "$DEST_CRT" "$DEST_KEY" "$DEST_PEM"

# Reload TLS transport (FreePBX / Asterisk)
if pct exec "$FREEPBX_CT" -- asterisk -rx "module reload res_pjsip.so" >/dev/null 2>&1; then
  :
else
  pct exec "$FREEPBX_CT" -- fwconsole reload >/dev/null 2>&1 || true
fi

echo "synced LE cert for ${SIP_HOST} → CT ${FREEPBX_CT}:${DEST_CRT}"
pct exec "$FREEPBX_CT" -- openssl x509 -in "$DEST_CRT" -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null | sed 's/^/  /'
