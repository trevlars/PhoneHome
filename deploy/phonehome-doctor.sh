#!/usr/bin/env bash
# PhoneHome analog-line doctor — read-only. Prints PASS/FAIL per check and
# exits non-zero if anything is broken.
#
# Written after an outage where fail2ban banned the SIP TLS proxy IP, so the
# HT801 could not register at all while the parent UI still said "Working".
# Checks, in the order they bite:
#   1. bridge  — /health and /sip-status (what the app believes)
#   2. contact — is the extension actually registered on FreePBX
#   3. fail2ban— is a LAN/proxy IP banned, and is the whitelist in effect
#   4. tls     — does the SIP TLS proxy still present a valid cert
#   5. secret  — do PhoneHome and FreePBX agree (SHA-256 compared, never printed)
#
# Usage:
#   ./deploy/phonehome-doctor.sh
#   EXT=2002 ./deploy/phonehome-doctor.sh
#   PVE_SSH=root@10.0.5.31 FREEPBX_CT=121 PHONEHOME_CT=122 ./deploy/phonehome-doctor.sh
#
# Runs from anywhere with SSH to the Proxmox host; if run on the PVE host
# itself (pct present) it skips SSH.
set -uo pipefail

EXT="${EXT:-2001}"
PVE_SSH="${PVE_SSH:-root@10.0.5.31}"
PHONEHOME_CT="${PHONEHOME_CT:-122}"
FREEPBX_CT="${FREEPBX_CT:-121}"
FREEPBX_IP="${FREEPBX_IP:-10.0.5.105}"
# SIP TLS proxy (socat on the PVE host). Asterisk sees this as the client IP for
# every analog REGISTER, which is exactly why banning it took the line down.
SIP_PROXY_IP="${SIP_PROXY_IP:-10.0.5.31}"
SIP_PROXY_PORT="${SIP_PROXY_PORT:-5061}"
SIP_HOST="${SIP_HOST:-y5876647.eero.online}"
F2B_JAIL="${F2B_JAIL:-asterisk-iptables}"
F2B_WHITELIST="${F2B_WHITELIST:-/etc/fail2ban/jail.d/zz-phonehome-trusted.local}"
TRUSTED_NETS="${TRUSTED_NETS:-10.0.4.0/24 10.0.5.0/24}"
PH_DB="${PH_DB:-/var/lib/kids-landline/kids-landline.db}"
BRIDGE_PORT="${BRIDGE_PORT:-8790}"
BRIDGE_ENV="${BRIDGE_ENV:-/var/lib/kids-landline/bridge.env}"

fails=0
warns=0

if [[ -t 1 ]]; then
  C_PASS=$'\033[32m'; C_FAIL=$'\033[31m'; C_WARN=$'\033[33m'; C_HEAD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_PASS=""; C_FAIL=""; C_WARN=""; C_HEAD=""; C_OFF=""
fi

section() { printf '\n%s== %s ==%s\n' "$C_HEAD" "$1" "$C_OFF"; }
pass()    { printf '%sPASS%s %s\n' "$C_PASS" "$C_OFF" "$1"; }
warn()    { printf '%sWARN%s %s\n' "$C_WARN" "$C_OFF" "$1"; warns=$((warns + 1)); }
fail()    { printf '%sFAIL%s %s\n' "$C_FAIL" "$C_OFF" "$1"; fails=$((fails + 1)); }
detail()  { sed 's/^/     /'; }

# Run a command on the Proxmox host (locally when we are already on it).
pve() {
  if command -v pct >/dev/null 2>&1; then
    bash -c "$1"
  else
    ssh -o ConnectTimeout=8 -o BatchMode=yes "$PVE_SSH" "$1"
  fi
}
ct() { pve "pct exec $1 -- sh -c $(printf '%q' "$2")"; }

printf '%sPhoneHome doctor%s  ext=%s  freepbx=CT%s  phonehome=CT%s  proxy=%s\n' \
  "$C_HEAD" "$C_OFF" "$EXT" "$FREEPBX_CT" "$PHONEHOME_CT" "$SIP_PROXY_IP"

if ! pve 'true' >/dev/null 2>&1; then
  fail "cannot reach the Proxmox host ($PVE_SSH) — every other check needs it"
  exit 1
fi

# ---------------------------------------------------------------- bridge ----
section "bridge (what the app believes)"

health="$(ct "$PHONEHOME_CT" "curl -sS --max-time 5 http://127.0.0.1:${BRIDGE_PORT}/health" 2>&1)"
if printf '%s' "$health" | grep -q '"ok":true'; then
  pass "bridge /health"
  printf '%s\n' "$health" | detail
  printf '%s' "$health" | grep -q '"ari":true' || warn "bridge is up but not connected to ARI"
else
  fail "bridge /health on CT ${PHONEHOME_CT}:${BRIDGE_PORT}"
  printf '%s\n' "$health" | detail
fi

# BRIDGE_SECRET is read inside the CT and never echoed.
sip_status="$(ct "$PHONEHOME_CT" \
  ". ${BRIDGE_ENV} 2>/dev/null; curl -sS --max-time 6 -H \"Authorization: Bearer \$BRIDGE_SECRET\" 'http://127.0.0.1:${BRIDGE_PORT}/sip-status?ext=${EXT}'" 2>&1)"
if printf '%s' "$sip_status" | grep -q '"registered":true'; then
  pass "bridge /sip-status says ext ${EXT} is registered"
elif printf '%s' "$sip_status" | grep -q '"registered":false'; then
  fail "bridge /sip-status says ext ${EXT} is NOT registered"
else
  fail "bridge /sip-status did not answer"
fi
printf '%s\n' "$sip_status" | detail
printf '%s' "$sip_status" | grep -q '"confidence":"low"' &&
  warn 'status is ARI endpoint state only — it cannot see contacts (set AMI_USER/AMI_PASSWORD on the bridge, and keep qualify on the AOR)'

# --------------------------------------------------------------- contact ----
section "FreePBX registration (ground truth)"

contacts="$(ct "$FREEPBX_CT" "asterisk -rx 'pjsip show contacts'" 2>&1)"
ext_contacts="$(printf '%s\n' "$contacts" | grep -E "^[[:space:]]*Contact:[[:space:]]+${EXT}/" || true)"
if [[ -z "$ext_contacts" ]]; then
  fail "no Contact for ext ${EXT} — the adapter is not registered (check fail2ban below first)"
  printf '%s\n' "$contacts" | detail
else
  if printf '%s\n' "$ext_contacts" | grep -qiE 'Unavail|Unreachable'; then
    fail "ext ${EXT} has a Contact but it is unreachable"
  elif printf '%s\n' "$ext_contacts" | grep -qiE 'Avail|Reachable'; then
    pass "ext ${EXT} Contact is available"
  else
    warn "ext ${EXT} has a Contact but no qualify result (qualify off? RTT is how we notice a dead adapter)"
  fi
  printf '%s\n' "$ext_contacts" | detail
fi

qualify="$(ct "$FREEPBX_CT" "asterisk -rx 'pjsip show aor ${EXT}' | grep -iE 'qualify_frequency'" 2>&1)"
if printf '%s' "$qualify" | grep -qE 'qualify_frequency[[:space:]]*:[[:space:]]*0([^0-9]|$)'; then
  fail "qualify_frequency=0 on AOR ${EXT} — Asterisk never probes the adapter, so ARI reports 'online' even with no Contact"
  printf '%s\n' "$qualify" | detail
elif [[ -n "$qualify" ]]; then
  pass "qualify is on for AOR ${EXT}"
  printf '%s\n' "$qualify" | detail
else
  warn "could not read qualify_frequency for AOR ${EXT}"
fi

# -------------------------------------------------------------- fail2ban ----
section "fail2ban (can the proxy still talk to Asterisk?)"

banned="$(ct "$FREEPBX_CT" "fail2ban-client get ${F2B_JAIL} banned" 2>&1)"
if printf '%s' "$banned" | grep -q 'NOK\|not exist'; then
  warn "jail ${F2B_JAIL} not found"
  printf '%s\n' "$banned" | detail
else
  printf '     banned: %s\n' "$banned"
  bad=""
  for ip in "$SIP_PROXY_IP" "$FREEPBX_IP" 127.0.0.1; do
    printf '%s' "$banned" | grep -qF "'${ip}'" && bad="${bad} ${ip}"
  done
  # Any 10.x address in the ban list is a self-ban, not an attacker.
  lan_banned="$(printf '%s' "$banned" | grep -oE "'10\.[0-9]+\.[0-9]+\.[0-9]+'" | tr -d "'" | tr '\n' ' ')"
  if [[ -n "${bad// /}" || -n "${lan_banned// /}" ]]; then
    fail "LAN/proxy IP banned by ${F2B_JAIL}:${bad}${lan_banned:+ }${lan_banned}"
    echo "     unban with:  ${PVE_SSH:+ssh $PVE_SSH }pct exec ${FREEPBX_CT} -- fail2ban-client set ${F2B_JAIL} unbanip ${SIP_PROXY_IP}"
  else
    pass "no LAN or proxy IP banned by ${F2B_JAIL}"
  fi
fi

rules="$(ct "$FREEPBX_CT" "iptables -S 2>/dev/null | grep -E 'REJECT|DROP'" 2>&1)"
lan_rules="$(printf '%s\n' "$rules" | grep -E '(^|[ ])-s (10\.|127\.)' || true)"
if [[ -n "$lan_rules" ]]; then
  fail "iptables is rejecting LAN sources on FreePBX"
  printf '%s\n' "$lan_rules" | detail
else
  pass "no iptables REJECT/DROP rule targets a LAN source"
  [[ -n "${rules// /}" ]] && printf '%s\n' "$rules" | detail
fi

if ct "$FREEPBX_CT" "test -f ${F2B_WHITELIST}" 2>/dev/null; then
  pass "whitelist file ${F2B_WHITELIST} exists"
else
  fail "missing ${F2B_WHITELIST} — a proxy self-ban can happen again after any fail2ban reload"
fi

ignoreip="$(ct "$FREEPBX_CT" "fail2ban-client get ${F2B_JAIL} ignoreip" 2>&1)"
missing=""
for net in $TRUSTED_NETS; do
  printf '%s' "$ignoreip" | grep -qF "$net" || missing="${missing} ${net}"
done
if [[ -z "${missing// /}" ]]; then
  pass "trusted nets are in effect for ${F2B_JAIL}"
else
  fail "ignoreip for ${F2B_JAIL} is missing:${missing} (file present but not loaded? run: fail2ban-client reload)"
fi
printf '%s\n' "$ignoreip" | detail

# ------------------------------------------------------------------- tls ----
section "SIP TLS proxy ${SIP_PROXY_IP}:${SIP_PROXY_PORT}"

cert="$(pve "echo | timeout 10 openssl s_client -connect ${SIP_PROXY_IP}:${SIP_PROXY_PORT} -servername ${SIP_HOST} 2>/dev/null | openssl x509 -noout -subject -issuer -enddate 2>/dev/null" 2>&1)"
if printf '%s' "$cert" | grep -q 'notAfter='; then
  not_after="$(printf '%s\n' "$cert" | sed -n 's/^notAfter=//p')"
  # Days left, computed on the PVE host so we are not at the mercy of BSD date(1).
  days_left="$(pve "python3 -c \"
import datetime,sys
d=datetime.datetime.strptime('${not_after}','%b %d %H:%M:%S %Y %Z')
print((d-datetime.datetime.utcnow()).days)\"" 2>/dev/null || echo "")"
  if [[ -n "$days_left" && "$days_left" -lt 0 ]]; then
    fail "SIP TLS cert EXPIRED (${not_after})"
  elif [[ -n "$days_left" && "$days_left" -lt 14 ]]; then
    warn "SIP TLS cert expires in ${days_left} days (${not_after})"
  else
    pass "SIP TLS handshake ok${days_left:+, cert valid for ${days_left} days}"
  fi
  printf '%s\n' "$cert" | detail
else
  fail "no certificate from ${SIP_PROXY_IP}:${SIP_PROXY_PORT} — the proxy is down or refusing TLS"
  printf '%s\n' "$cert" | detail
fi

# ---------------------------------------------------------------- secret ----
section "SIP secret agreement (hashes only)"

ph_hash="$(ct "$PHONEHOME_CT" \
  "sqlite3 ${PH_DB} \"SELECT sip_password FROM ata_devices WHERE sip_extension='${EXT}'\" | tr -d '\n' | sha256sum | cut -c1-16" 2>&1)"
pbx_hash="$(ct "$FREEPBX_CT" \
  "mysql -N -B asterisk -e \"SELECT data FROM sip WHERE id='${EXT}' AND keyword='secret'\" | tr -d '\n' | sha256sum | cut -c1-16" 2>&1)"
# Hash of the empty string, so "both sides missing" can't look like agreement.
if command -v sha256sum >/dev/null 2>&1; then
  empty_hash="$(printf '' | sha256sum | cut -c1-16)"
else
  empty_hash="$(printf '' | shasum -a 256 | cut -c1-16)"
fi

if [[ "$ph_hash" == *"rror"* || -z "$ph_hash" ]]; then
  fail "could not read the PhoneHome secret hash for ext ${EXT}"
  printf '%s\n' "$ph_hash" | detail
elif [[ "$pbx_hash" == *"rror"* || -z "$pbx_hash" ]]; then
  fail "could not read the FreePBX secret hash for ext ${EXT}"
  printf '%s\n' "$pbx_hash" | detail
elif [[ "$ph_hash" == "$empty_hash" ]]; then
  fail "PhoneHome has no SIP secret stored for ext ${EXT}"
elif [[ "$pbx_hash" == "$empty_hash" ]]; then
  fail "FreePBX has no secret for ext ${EXT} — the extension does not exist on the PBX"
elif [[ "$ph_hash" == "$pbx_hash" ]]; then
  pass "PhoneHome and FreePBX agree on the ext ${EXT} secret (sha256 ${ph_hash}…)"
else
  fail "SIP secret drift on ext ${EXT}: PhoneHome ${ph_hash}… vs FreePBX ${pbx_hash}… — the adapter will fail REGISTER with 401/403"
fi

# --------------------------------------------------------------- summary ----
section "summary"
if (( fails )); then
  printf '%s%d check(s) failed%s, %d warning(s)\n' "$C_FAIL" "$fails" "$C_OFF" "$warns"
  exit 1
fi
printf '%sall checks passed%s, %d warning(s)\n' "$C_PASS" "$C_OFF" "$warns"
exit 0
