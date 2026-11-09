#!/usr/bin/env bash
# Install PhoneHome Asterisk overlays on a co-located managed VPS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/bridged/freepbx"
SIP_HOST="${SIP_HOST:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the FreePBX/Asterisk host." >&2
  exit 1
fi
if [[ -z "$SIP_HOST" ]]; then
  echo "SIP_HOST is required, e.g. SIP_HOST=family.example.com $0" >&2
  exit 1
fi
if ! command -v asterisk >/dev/null 2>&1; then
  echo "Asterisk/FreePBX must be installed first." >&2
  exit 1
fi

install -d -m 750 -o asterisk -g asterisk /etc/asterisk/keys
for name in \
  pjsip.endpoint_custom_post.conf \
  pjsip.aor_custom_post.conf \
  rtp_custom.conf \
  extensions_custom.conf \
  flite.conf \
  sip_notify_custom.conf
do
  install -m 640 -o asterisk -g asterisk "$SRC/$name" "/etc/asterisk/$name"
done

# The checked-in transport documents the live lab. Managed tenants use their
# own public hostname and direct 5061, with no broad RFC1918 local-network trust.
sed \
  -e "s/mothership\\.example/${SIP_HOST//\//\\/}/g" \
  -e 's/^local_net=.*/; managed VPS: remote ATAs are never trusted as local/' \
  "$SRC/pjsip.transports_custom.conf" \
  > /etc/asterisk/pjsip.transports_custom.conf
chown asterisk:asterisk /etc/asterisk/pjsip.transports_custom.conf
chmod 640 /etc/asterisk/pjsip.transports_custom.conf

"$ROOT/deploy/install-freepbx-sync.sh"

if command -v fwconsole >/dev/null 2>&1; then
  fwconsole reload
else
  asterisk -rx "core reload"
fi

echo "Installed PhoneHome FreePBX overlays for $SIP_HOST."
echo "Run deploy/managed/sync-sip-cert.sh after Caddy obtains its certificate."
