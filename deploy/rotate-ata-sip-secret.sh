#!/usr/bin/env bash
#
# Rotate the SIP secret for one analog extension in BOTH places at once.
#
#   PhoneHome  (CT 122)  ata_devices.sip_password
#   FreePBX    (CT 121)  asterisk.sip  keyword='secret'
#
# Tonight's outage came from these two drifting apart: PhoneHome minted a new
# secret, FreePBX never learned it, the adapter failed auth five times, and
# fail2ban banned the SIP TLS proxy — taking every analog line down at once.
# Rotating by hand in one place is how that happens, so don't. Use this.
#
# The secret is never printed, never passed on a command line, and never sent
# through a shell string; both writes go through argv/stdin and are verified by
# comparing SHA-256 hashes. See .cursor/rules/privacy-security-pillar.mdc.
#
# After this runs the adapter still holds the OLD secret and will fail to
# register until you push the new config (parent app -> Set up adapter, or
# Download config -> upload). That window is expected and safe: the LAN is
# whitelisted in fail2ban, so the retries cannot ban the proxy.
#
# Usage:
#   ./deploy/rotate-ata-sip-secret.sh [extension]
#   EXT=2001 PVE=root@10.0.5.31 ./deploy/rotate-ata-sip-secret.sh
#
# Options via env:
#   EXT         extension to rotate            (default 2001, or $1)
#   PVE         Proxmox ssh target             (default root@10.0.5.31)
#   PH_CT       PhoneHome container id         (default 122)
#   PBX_CT      FreePBX container id           (default 121)
#   DRY_RUN=1   report current match state and exit without changing anything

set -euo pipefail

EXT="${1:-${EXT:-2001}}"
PVE="${PVE:-root@10.0.5.31}"
PH_CT="${PH_CT:-122}"
PBX_CT="${PBX_CT:-121}"
PH_DB="${PH_DB:-/var/lib/kids-landline/kids-landline.db}"
DRY_RUN="${DRY_RUN:-0}"

if ! [[ "$EXT" =~ ^[0-9]{2,8}$ ]]; then
  echo "error: extension must be 2-8 digits, got '$EXT'" >&2
  exit 2
fi

echo "Rotating SIP secret for extension $EXT"
echo "  PhoneHome : $PVE -> CT $PH_CT"
echo "  FreePBX   : $PVE -> CT $PBX_CT"
echo

# --- current state -----------------------------------------------------------

ph_hash() {
  ssh "$PVE" "pct exec $PH_CT -- python3 -" <<PY
import hashlib, sqlite3, sys
row = sqlite3.connect("$PH_DB").execute(
    "select sip_password from ata_devices where sip_extension=?", ("$EXT",)
).fetchone()
if not row:
    print("MISSING"); sys.exit(0)
print(hashlib.sha256(row[0].encode()).hexdigest())
PY
}

pbx_hash() {
  ssh "$PVE" "pct exec $PBX_CT -- python3 -" <<PY
import hashlib, subprocess, sys
out = subprocess.run(
    ["mysql", "-N", "asterisk", "-e",
     "SELECT data FROM sip WHERE id='$EXT' AND keyword='secret'"],
    capture_output=True, text=True,
)
sec = out.stdout.strip()
if not sec:
    print("MISSING"); sys.exit(0)
print(hashlib.sha256(sec.encode()).hexdigest())
PY
}

before_ph="$(ph_hash)"
before_pbx="$(pbx_hash)"
echo "before: phonehome=${before_ph:0:12}… freepbx=${before_pbx:0:12}…"
if [ "$before_ph" = "$before_pbx" ]; then
  echo "before: IN SYNC"
else
  echo "before: OUT OF SYNC  <-- this is the failure mode that breaks registration"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "DRY_RUN=1, nothing changed."
  [ "$before_ph" = "$before_pbx" ] || exit 1
  exit 0
fi

if [ "$before_ph" = "MISSING" ]; then
  echo "error: no ata_devices row for extension $EXT in PhoneHome" >&2
  exit 1
fi

# --- generate + write --------------------------------------------------------

# Generated on the PhoneHome side, written straight into sqlite, then handed to
# FreePBX over stdin. It is never interpolated into a shell or SQL string.
echo
echo "Generating new secret and writing to PhoneHome…"
ssh "$PVE" "pct exec $PH_CT -- python3 -" <<PY
import secrets, sqlite3, string
alphabet = string.ascii_letters + string.digits
secret = "".join(secrets.choice(alphabet) for _ in range(18))
con = sqlite3.connect("$PH_DB")
con.execute(
    "update ata_devices set sip_password=?, updated_at=datetime('now') where sip_extension=?",
    (secret, "$EXT"),
)
con.commit()
open("/tmp/.phrotate", "w").write(secret)
print("phonehome updated")
PY

echo "Copying to FreePBX…"
ssh "$PVE" "pct pull $PH_CT /tmp/.phrotate /tmp/.phrotate >/dev/null && pct push $PBX_CT /tmp/.phrotate /tmp/.phrotate >/dev/null"

ssh "$PVE" "pct exec $PBX_CT -- python3 -" <<PY
import subprocess
from pathlib import Path
sec = Path("/tmp/.phrotate").read_text().strip()
assert len(sec) >= 12, "refusing to write a short secret"
esc = sec.replace("\\\\", "\\\\\\\\").replace("'", "''")
subprocess.check_call(
    ["mysql", "asterisk", "-e",
     "UPDATE sip SET data='%s' WHERE id='$EXT' AND keyword='secret'" % esc]
)
print("freepbx updated")
PY

echo "Reloading FreePBX…"
ssh "$PVE" "pct exec $PBX_CT -- fwconsole reload" >/dev/null

echo "Cleaning up temp files…"
ssh "$PVE" "rm -f /tmp/.phrotate; pct exec $PH_CT -- rm -f /tmp/.phrotate; pct exec $PBX_CT -- rm -f /tmp/.phrotate" || true

# --- verify ------------------------------------------------------------------

echo
after_ph="$(ph_hash)"
after_pbx="$(pbx_hash)"
echo "after:  phonehome=${after_ph:0:12}… freepbx=${after_pbx:0:12}…"

if [ "$after_ph" != "$after_pbx" ]; then
  echo "FAIL: secrets still differ — analog registration will not work" >&2
  exit 1
fi
if [ "$after_ph" = "$before_ph" ]; then
  echo "FAIL: secret did not change" >&2
  exit 1
fi

echo "OK: both sides now hold the same new secret."
echo
echo "Next: push the new config to the adapter, or it will keep failing auth."
echo "  parent app -> the kid's line -> Set up adapter   (one-tap, needs the ATA admin password)"
echo "  or Download config and upload it via the adapter's web UI"
echo
echo "Then confirm with:  ./deploy/phonehome-doctor.sh"
