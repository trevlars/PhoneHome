#!/usr/bin/env bash
# Prepare an Ubuntu/Debian VPS for one isolated managed PhoneHome tenant.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANAGED="$ROOT/deploy/managed"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the tenant VPS." >&2
  exit 1
fi
if [[ ! -f /etc/os-release ]]; then
  echo "Unsupported host: /etc/os-release is missing." >&2
  exit 1
fi
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) echo "Managed bootstrap currently supports Ubuntu or Debian, got ${ID:-unknown}." >&2; exit 1 ;;
esac

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl docker.io docker-compose-v2 openssl restic sqlite3 ufw
systemctl enable --now docker

install -d -m 700 "$MANAGED/data" "$MANAGED/caddy-data" "$MANAGED/caddy-config"
if [[ ! -f "$MANAGED/.env" ]]; then
  cp "$MANAGED/.env.example" "$MANAGED/.env"
  chmod 600 "$MANAGED/.env"
  python3 - "$MANAGED/.env" <<'PY'
from pathlib import Path
import secrets
import sys

p = Path(sys.argv[1])
text = p.read_text()
for marker in (
    "replace-with-32-random-bytes",
    "replace-with-ari-password",
):
    while marker in text:
        text = text.replace(marker, secrets.token_urlsafe(32), 1)
p.write_text(text)
PY
  echo "Created $MANAGED/.env with generated secrets."
  echo "Set PHONEHOME_HOST, TURN_EXTERNAL_IP, EXT_MEDIA_HOST, and ARI credentials before starting."
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 49160:49200/udp
ufw allow 5061/tcp
ufw allow 10000:10200/udp
ufw allow 14000:14050/udp
ufw --force enable

echo
echo "VPS base is ready."
echo "1. Install FreePBX/Asterisk on this host."
echo "2. Run deploy/managed/install-freepbx-overlays.sh."
echo "3. Edit deploy/managed/.env."
echo "4. Run: docker compose -f deploy/managed/docker-compose.yml --env-file deploy/managed/.env up -d --build"
