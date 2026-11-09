#!/usr/bin/env bash
# Build a diagnostics bundle without env files, credentials, SDP, or call content.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANAGED="$ROOT/deploy/managed"
ENV_FILE="${MANAGED_ENV:-$MANAGED/.env}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="${1:-$MANAGED/phonehome-support-$stamp.tar.gz}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

host="$(awk -F= '$1=="PHONEHOME_HOST"{print $2}' "$ENV_FILE" 2>/dev/null | tail -1)"
{
  echo "generated_at=$stamp"
  echo "git_commit=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "kernel=$(uname -sr)"
  echo "hostname=$(hostname -s)"
} >"$stage/system.txt"

docker compose -f "$MANAGED/docker-compose.yml" --env-file "$ENV_FILE" ps \
  >"$stage/compose-ps.txt" 2>&1 || true
docker compose -f "$MANAGED/docker-compose.yml" --env-file "$ENV_FILE" images \
  >"$stage/compose-images.txt" 2>&1 || true
df -h "$MANAGED" >"$stage/disk.txt" 2>&1 || true

if [[ -n "$host" ]]; then
  curl -fsS --max-time 10 "https://$host/api/health" >"$stage/hub-health.json" 2>&1 || true
  echo | openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null |
    openssl x509 -noout -subject -issuer -dates -ext subjectAltName \
    >"$stage/https-certificate.txt" 2>&1 || true
  echo | openssl s_client -connect "$host:5061" -servername "$host" 2>/dev/null |
    openssl x509 -noout -subject -issuer -dates -ext subjectAltName \
    >"$stage/sip-certificate.txt" 2>&1 || true
fi

if command -v asterisk >/dev/null 2>&1; then
  asterisk -rx "core show version" >"$stage/asterisk-version.txt" 2>&1 || true
  asterisk -rx "pjsip show transports" >"$stage/pjsip-transports.txt" 2>&1 || true
  contacts="$(asterisk -rx "pjsip show contacts" 2>/dev/null | awk '/^  Contact:/ {n++} END {print n+0}')"
  echo "registered_contact_rows=$contacts" >"$stage/pjsip-summary.txt"
fi

tar -C "$stage" -czf "$out" .
chmod 600 "$out"
echo "Wrote redacted support bundle: $out"
