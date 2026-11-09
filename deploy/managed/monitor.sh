#!/usr/bin/env bash
# Tenant health probe suitable for a systemd timer or external monitor.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANAGED="$ROOT/deploy/managed"
ENV_FILE="${MANAGED_ENV:-$MANAGED/.env}"
fails=0

fail() { echo "FAIL $*"; fails=$((fails + 1)); }
pass() { echo "PASS $*"; }

host="$(awk -F= '$1=="PHONEHOME_HOST"{print $2}' "$ENV_FILE" 2>/dev/null | tail -1)"
if [[ -z "$host" ]]; then
  fail "PHONEHOME_HOST missing"
else
  curl -fsS --max-time 10 "https://$host/api/health" >/dev/null &&
    pass "HTTPS hub health" || fail "HTTPS hub health"
  echo | openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null |
    openssl x509 -noout -checkend 1209600 >/dev/null &&
    pass "HTTPS certificate valid for 14 days" || fail "HTTPS certificate expiry"
  echo | openssl s_client -connect "$host:5061" -servername "$host" 2>/dev/null |
    openssl x509 -noout -checkend 1209600 >/dev/null &&
    pass "SIP TLS certificate valid for 14 days" || fail "SIP TLS certificate expiry"
fi

docker compose -f "$MANAGED/docker-compose.yml" --env-file "$ENV_FILE" ps --status running |
  grep -q phonehome &&
  pass "PhoneHome containers running" || fail "PhoneHome containers"

disk_pct="$(df -P "$MANAGED" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if [[ -n "$disk_pct" && "$disk_pct" -lt 85 ]]; then
  pass "disk usage ${disk_pct}%"
else
  fail "disk usage ${disk_pct:-unknown}%"
fi

if [[ "$fails" -eq 0 ]]; then
  [[ -n "${HEALTHCHECK_PING_URL:-}" ]] && curl -fsS --max-time 10 "$HEALTHCHECK_PING_URL" >/dev/null || true
  exit 0
fi
[[ -n "${HEALTHCHECK_FAIL_URL:-}" ]] &&
  curl -fsS --max-time 10 "$HEALTHCHECK_FAIL_URL" >/dev/null || true
exit 1
