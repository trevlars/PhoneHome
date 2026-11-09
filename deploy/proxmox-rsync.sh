#!/usr/bin/env bash
# Sync Stage 1 app into a Proxmox LXC and restart the service.
# Usage: ./deploy/proxmox-rsync.sh [pve-ssh] [ctid]
#
# Calling-infrastructure guards (.cursor/rules/calling-infrastructure.mdc):
#   - One deploy at a time (lock directory on the PVE host).
#   - Refuses uncommitted changes in deployed paths so what is live is always a
#     commit. PHONEHOME_DEPLOY_DIRTY=1 overrides for a lab-only experiment.
#   - Waits for FreePBX to report zero active channels before restarting
#     services or reloading FreePBX (PHONEHOME_DEPLOY_WAIT_SECS, default 300).
#     PHONEHOME_DEPLOY_FORCE=1 skips the wait and drops live calls.
#   - HT801 check-sync makes each adapter re-provision and restart, and the first
#     calls after that have lost the house uplink. It only runs with
#     PHONEHOME_ATA_SYNC=1, for provisioning changes.
#   - FreePBX reloads only when bridged/freepbx or the FreePBX helpers changed
#     (PHONEHOME_FREEPBX_SYNC=1 forces one).
set -euo pipefail

PVE="${1:-}"
CTID="${2:-}"
FREEPBX_CT="${FREEPBX_CT:-}"
if [[ -z "$PVE" || -z "$CTID" || -z "$FREEPBX_CT" ]]; then
  echo "usage: FREEPBX_CT=<freepbx-ctid> $0 <user@proxmox-host> <phonehome-ctid>" >&2
  echo "Example: FREEPBX_CT=200 $0 root@192.168.1.2 201" >&2
  exit 1
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEPLOY_LOCK=/run/phonehome-deploy.lock
if ! ssh "$PVE" "find $DEPLOY_LOCK -maxdepth 0 -mmin +45 -exec rm -rf {} + 2>/dev/null; mkdir $DEPLOY_LOCK 2>/dev/null"; then
  echo "Could not take $DEPLOY_LOCK on $PVE: another PhoneHome deploy is running (or SSH failed)." >&2
  exit 1
fi
trap 'ssh "$PVE" "rm -rf $DEPLOY_LOCK" >/dev/null 2>&1 || true' EXIT

DEPLOY_REV="$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
# web/public is build output; web/storefront-pages is the marketing site (not served by the CT).
DIRTY="$(git -C "$ROOT" status --porcelain -- server web bridged deploy gateway control package.json package-lock.json \
  ':(exclude)web/public' ':(exclude)web/storefront-pages' 2>/dev/null || true)"
if [[ -n "$DIRTY" ]]; then
  if [[ "${PHONEHOME_DEPLOY_DIRTY:-0}" != "1" ]]; then
    echo "Refusing to deploy uncommitted changes (what is live must be a commit):" >&2
    echo "$DIRTY" >&2
    echo "Commit your own changes first. Never deploy another agent's work in progress." >&2
    echo "Lab-only experiment: PHONEHOME_DEPLOY_DIRTY=1 (stamped +dirty on the CT)." >&2
    exit 1
  fi
  DEPLOY_REV="${DEPLOY_REV}+dirty"
fi
echo "==> Deploying $DEPLOY_REV to CT $CTID via $PVE"

# Counts SIP call legs (HT801s, trunks). Orphaned UnicastRTP ExternalMedia legs
# are not calls; bridged ends those itself on startup.
freepbx_call_legs() {
  local out
  out="$(ssh -n "$PVE" "pct exec $FREEPBX_CT -- asterisk -rx 'core show channels concise'" 2>/dev/null)" || {
    echo unknown
    return 0
  }
  grep -c '^PJSIP/' <<<"$out" || true
}

# Restarting kids-landline/phonehome-bridge or reloading FreePBX drops live family calls.
wait_for_no_calls() {
  local action="$1" limit="${PHONEHOME_DEPLOY_WAIT_SECS:-300}" waited=0 active
  if [[ "${PHONEHOME_DEPLOY_FORCE:-0}" == "1" ]]; then
    echo "PHONEHOME_DEPLOY_FORCE=1: not checking for live calls before $action"
    return 0
  fi
  while :; do
    active="$(freepbx_call_legs)"
    [[ "$active" == "0" ]] && return 0
    if (( waited >= limit )); then
      echo "Refusing to $action: FreePBX CT $FREEPBX_CT reports ${active} SIP call leg(s) after ${waited}s." >&2
      echo "Retry when the lines are idle. PHONEHOME_DEPLOY_FORCE=1 drops live calls; only with Cameron's OK." >&2
      exit 1
    fi
    echo "Waiting for live calls to end before $action (${active} SIP call leg(s), ${waited}s/${limit}s)"
    sleep 10
    waited=$((waited + 10))
  done
}

wait_for_no_calls "start the deploy"

echo "==> Pre-deploy analog media smoke (blocks bridged regressions)"
"$ROOT/deploy/phonehome-media-smoke.sh"

echo "==> Building web assets locally"
(cd "$ROOT" && npm run build -w web)

echo "==> Sync to CT $CTID via $PVE"
ssh "$PVE" "pct exec $CTID -- mkdir -p /opt/kids-landline /var/lib/kids-landline"

# COPYFILE_DISABLE: skip macOS AppleDouble (._*) junk in the tar stream.
# Favicons live under web/src and are copied to web/public by npm run build -w web;
# do not add excludes for favicon* / *.ico / *.png — that would drop the hub icons.
# Exclude native/desktop build trees — they balloon the stream past ~1GB and
# break SSH mid-tar (Write error / Broken pipe). CT only needs server/web/bridged.
export COPYFILE_DISABLE=1
tar -C "$ROOT" -cf - \
  --exclude .git \
  --exclude .cursor \
  --exclude node_modules \
  --exclude data \
  --exclude macos \
  --exclude 'mobile/build' \
  --exclude 'mobile/ios' \
  --exclude 'mobile/app-store' \
  --exclude 'mobile/android/.gradle' \
  --exclude 'mobile/android/build' \
  --exclude 'mobile/android/app/build' \
  --exclude 'mobile/android/local.properties' \
  --exclude 'mobile/android/app/google-services.json' \
  --exclude '*.mobileprovision' \
  --exclude '**/node_modules' \
  --exclude '**/data' \
  --exclude '**/DerivedData' \
  --exclude '**/._*' \
  --exclude '._*' \
  . | ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=12 "$PVE" \
    "pct exec $CTID -- tar -C /opt/kids-landline -xf -"

ssh "$PVE" "pct exec $CTID -- bash -s" <<'REMOTE'
set -e
cd /opt/kids-landline
npm install
npm run build -w web
npm run build -w server
if [[ -d bridged ]]; then
  (cd bridged && npm install --omit=dev)
fi
if [[ ! -f /var/lib/kids-landline/bridge.env ]]; then
  umask 077
  SECRET=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-40)
  ARI_PASS=$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)
  cat > /var/lib/kids-landline/bridge.env <<EOF
BRIDGE_SECRET=${SECRET}
ARI_URL=http://127.0.0.1:8088
ARI_USER=phonehome
ARI_PASS=${ARI_PASS}
ARI_APP=phonehome
PHONEHOME_URL=http://127.0.0.1:8787
PHONEHOME_WS=ws://127.0.0.1:8787/ws
EXT_MEDIA_HOST=127.0.0.1
EXT_MEDIA_PORT_BASE=14000
EOF
  echo "Created /var/lib/kids-landline/bridge.env"
  echo "Edit ARI_URL and EXT_MEDIA_HOST. Set the FreePBX ARI user to the ARI_PASS in that file. The password was not printed."
fi
mkdir -p /etc/systemd/system/kids-landline.service.d
if [[ ! -f /var/lib/kids-landline/phonehome.env ]]; then
  echo "Hint: run deploy/phonehome-init.sh on this CT (or copy phonehome.env) for PUBLIC_BASE_URL / SIP_PUBLIC_HOST"
fi
cat > /etc/systemd/system/kids-landline.service.d/bridge.conf <<'EOF'
[Service]
EnvironmentFile=-/var/lib/kids-landline/phonehome.env
EnvironmentFile=-/var/lib/kids-landline/bridge.env
EnvironmentFile=-/var/lib/kids-landline/freepbx-sync.env
Environment=BRIDGE_URL=http://127.0.0.1:8790
EOF
if [[ ! -f /etc/systemd/system/kids-landline.service ]]; then
  cp /opt/kids-landline/deploy/kids-landline.service /etc/systemd/system/kids-landline.service
  systemctl enable kids-landline
fi
cp /opt/kids-landline/deploy/phonehome-bridge.service /etc/systemd/system/phonehome-bridge.service
systemctl daemon-reload
systemctl enable kids-landline phonehome-bridge
REMOTE

# FreePBX runs before the service restart: kids-landline re-syncs every line
# through phonehome-set-sip-secret on start, so the new helper must be live first.
# Each full FreePBX reload risks an Asterisk crash (Oct 4: res_digium_phone reload,
# pjproject assert) that drops every family's calls and registrations. Only
# reload when the FreePBX inputs changed since the last applied deploy.
FREEPBX_STAMP=/etc/phonehome/freepbx-overlay.sha256
FREEPBX_HASH="$(cd "$ROOT" && {
  git ls-files -z bridged/freepbx | xargs -0 cat
  cat deploy/phonehome-set-sip-secret.py deploy/phonehome-freepbx-syncd.py deploy/phonehome-freepbx-syncd.service
} | shasum -a 256 | cut -d' ' -f1)"
LIVE_FREEPBX_HASH="$(ssh -n "$PVE" "cat $FREEPBX_STAMP 2>/dev/null" || true)"
if [[ "$FREEPBX_HASH" == "$LIVE_FREEPBX_HASH" && "${PHONEHOME_FREEPBX_SYNC:-0}" != "1" ]]; then
  echo "==> FreePBX inputs unchanged since the last deploy; no FreePBX reload. Force with PHONEHOME_FREEPBX_SYNC=1."
else
wait_for_no_calls "reload FreePBX"

echo "==> FreePBX syncd + set-sip-secret (remote media_address for new ATAs)"
# Keep PVE syncd + FreePBX helper in lockstep with the repo. Missing
# PHONEHOME_PUBLIC_MEDIA_IP / SIP_PUBLIC_HOST here used to create remote
# extensions that ring with no audio (SDP advertised FreePBX LAN IP).
scp -q "$ROOT/deploy/phonehome-set-sip-secret.py" "$ROOT/deploy/phonehome-freepbx-syncd.py" \
  "$ROOT/deploy/phonehome-freepbx-syncd.service" "$PVE:/tmp/"
ssh "$PVE" "bash -s" <<SYNC
set -euo pipefail
install -m 755 /tmp/phonehome-set-sip-secret.py /usr/local/sbin/phonehome-set-sip-secret
install -m 755 /tmp/phonehome-freepbx-syncd.py /usr/local/sbin/phonehome-freepbx-syncd
install -m 644 /tmp/phonehome-freepbx-syncd.service /etc/systemd/system/phonehome-freepbx-syncd.service
pct push ${FREEPBX_CT} /tmp/phonehome-set-sip-secret.py /usr/local/sbin/phonehome-set-sip-secret
pct exec ${FREEPBX_CT} -- chmod 755 /usr/local/sbin/phonehome-set-sip-secret
mkdir -p /etc/phonehome
ENV=/etc/phonehome/freepbx-syncd.env
# Preserve token/allowed; refresh media host/IP from the PhoneHome CT.
SIP_HOST=\$(pct exec ${CTID} -- bash -lc "grep -hE '^SIP_PUBLIC_HOST=' /etc/systemd/system/kids-landline.service.d/*.conf /var/lib/kids-landline/phonehome.env 2>/dev/null | head -1 | cut -d= -f2-" || true)
SIP_HOST=\${SIP_HOST:-mothership.example}
# System DNS is often a LAN rewrite of the public SIP name (AdGuard → mothership).
# That address must not be stored as PHONEHOME_PUBLIC_MEDIA_IP.
is_private_ipv4() {
  local ip="\$1"
  [[ "\$ip" =~ ^10\\. ]] && return 0
  [[ "\$ip" =~ ^192\\.168\\. ]] && return 0
  [[ "\$ip" =~ ^172\\.(1[6-9]|2[0-9]|3[0-1])\\. ]] && return 0
  [[ "\$ip" =~ ^127\\. ]] && return 0
  return 1
}
MEDIA_IP=""
for dns in 1.1.1.1 8.8.8.8; do
  cand="\$(dig +short +time=2 +tries=1 A "\$SIP_HOST" @"\$dns" 2>/dev/null | awk '/^[0-9]+(\\.[0-9]+){3}\$/ {print; exit}')"
  if [[ -n "\$cand" ]] && ! is_private_ipv4 "\$cand"; then
    MEDIA_IP="\$cand"
    break
  fi
done
if [[ -z "\$MEDIA_IP" ]]; then
  echo "WARN: public A for \$SIP_HOST was missing or private. Not writing PHONEHOME_PUBLIC_MEDIA_IP." >&2
fi
if [[ ! -f "\$ENV" ]]; then
  umask 077
  cat > "\$ENV" <<EOF
FREEPBX_SYNC_BIND_HOST=0.0.0.0
FREEPBX_SYNC_BIND_PORT=8797
FREEPBX_SYNC_TOKEN_FILE=/etc/phonehome/sync.token
FREEPBX_SYNC_ALLOWED=192.168.2.106,192.168.2.31,127.0.0.1
PHONEHOME_SET_SIP_SECRET=/usr/local/sbin/phonehome-set-sip-secret
FREEPBX_CT=${FREEPBX_CT}
EOF
fi
grep -vE '^(SIP_PUBLIC_HOST|PHONEHOME_SIP_PUBLIC_HOST|PHONEHOME_PUBLIC_MEDIA_IP|PHONEHOME_SIP_PUBLIC_IP|FREEPBX_CT)=' "\$ENV" > "\$ENV.tmp" || true
mv "\$ENV.tmp" "\$ENV"
{
  echo "FREEPBX_CT=${FREEPBX_CT}"
  echo "SIP_PUBLIC_HOST=\$SIP_HOST"
  echo "PHONEHOME_SIP_PUBLIC_HOST=\$SIP_HOST"
  [[ -n "\$MEDIA_IP" ]] && echo "PHONEHOME_PUBLIC_MEDIA_IP=\$MEDIA_IP"
} >> "\$ENV"
chmod 600 "\$ENV"
systemctl daemon-reload
systemctl enable --now phonehome-freepbx-syncd >/dev/null
systemctl restart phonehome-freepbx-syncd
systemctl is-active phonehome-freepbx-syncd
echo "freepbx-syncd media: SIP_HOST=\$SIP_HOST MEDIA_IP=\${MEDIA_IP:-UNRESOLVED}"
SYNC

echo "==> FreePBX CT 121 (dialplan + Flite + media cache for *98 IVR)"
TMP_EXT="$(ssh "$PVE" mktemp /tmp/ph-ext.XXXXXX.conf)"
TMP_FLITE="$(ssh "$PVE" mktemp /tmp/ph-flite.XXXXXX.conf)"
TMP_NOTIFY="$(ssh "$PVE" mktemp /tmp/ph-notify.XXXXXX.conf)"
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/extensions_custom.conf $TMP_EXT"
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/flite.conf $TMP_FLITE"
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/sip_notify_custom.conf $TMP_NOTIFY"
# Keep FreePBX RTP/TLS matched to remote ATA needs (ring/no-audio).
# Do NOT push pjsip.aor_custom_post.conf / endpoint_custom_post.conf from the
# repo reference — phonehome-set-sip-secret owns those live. A stale "2001 lan"
# AOR overlay (remove_unavailable=no) stuck Alex+Riley Unavail after qualify.
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/rtp_custom.conf /tmp/phonehome-rtp_custom.conf" 2>/dev/null || true
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/pjsip.transports_custom.conf /tmp/phonehome-pjsip.transports_custom.conf" 2>/dev/null || true
# Evidence log: SRTP unprotect failures + bridge technology per call are
# verbose-level and invisible at FreePBX's default verbosity 0.
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/logger_logfiles_custom.conf /tmp/phonehome-logger_logfiles_custom.conf" 2>/dev/null || true
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/logrotate-phonehome-asterisk /tmp/phonehome-logrotate-asterisk" 2>/dev/null || true
# Cleartext SIP (UDP 5060) stays LAN-only even while the eero forwards it.
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/phonehome-sip-lanonly.sh /tmp/phonehome-sip-lanonly.sh" 2>/dev/null || true
ssh "$PVE" "pct pull $CTID /opt/kids-landline/bridged/freepbx/phonehome-sip-lanonly.service /tmp/phonehome-sip-lanonly.service" 2>/dev/null || true
ssh "$PVE" "pct push $FREEPBX_CT $TMP_EXT /etc/asterisk/extensions_custom.conf"
ssh "$PVE" "pct push $FREEPBX_CT $TMP_FLITE /etc/asterisk/flite.conf"
ssh "$PVE" "pct push $FREEPBX_CT $TMP_NOTIFY /etc/asterisk/sip_notify_custom.conf"
ssh "$PVE" "pct push $FREEPBX_CT /tmp/phonehome-rtp_custom.conf /etc/asterisk/rtp_custom.conf" 2>/dev/null || true
ssh "$PVE" "pct push $FREEPBX_CT /tmp/phonehome-pjsip.transports_custom.conf /etc/asterisk/pjsip.transports_custom.conf" 2>/dev/null || true
ssh "$PVE" "pct push $FREEPBX_CT /tmp/phonehome-logger_logfiles_custom.conf /etc/asterisk/logger_logfiles_custom.conf" 2>/dev/null || true
ssh "$PVE" "pct push $FREEPBX_CT /tmp/phonehome-logrotate-asterisk /etc/logrotate.d/phonehome-asterisk" 2>/dev/null || true
ssh "$PVE" "pct push $FREEPBX_CT /tmp/phonehome-sip-lanonly.sh /usr/local/sbin/phonehome-sip-lanonly.sh --perms 0755" 2>/dev/null || true
ssh "$PVE" "pct push $FREEPBX_CT /tmp/phonehome-sip-lanonly.service /etc/systemd/system/phonehome-sip-lanonly.service --perms 0644" 2>/dev/null || true
ssh "$PVE" "rm -f $TMP_EXT $TMP_FLITE $TMP_NOTIFY /tmp/phonehome-rtp_custom.conf /tmp/phonehome-pjsip.transports_custom.conf /tmp/phonehome-logger_logfiles_custom.conf /tmp/phonehome-logrotate-asterisk /tmp/phonehome-sip-lanonly.sh /tmp/phonehome-sip-lanonly.service"
ssh "$PVE" "pct exec $FREEPBX_CT -- bash -lc '
  set -e
  if [[ -x /usr/local/sbin/phonehome-sip-lanonly.sh ]]; then
    systemctl daemon-reload
    systemctl enable --now phonehome-sip-lanonly.service >/dev/null 2>&1 || true
    /usr/local/sbin/phonehome-sip-lanonly.sh || true
  fi
  mkdir -p /var/cache/asterisk
  chown asterisk:asterisk /var/cache/asterisk
  chmod 775 /var/cache/asterisk
  asterisk -rx \"module reload app_flite.so\" >/dev/null 2>&1 || true
  # Dialplan/flite/AOR overlays — full reload regenerates rtp_additional to 20000.
  fwconsole reload
  # CRITICAL: pin AFTER reload. Asterisk reads rtp_additional before rtp_custom,
  # so custom alone never wins. Mismatch with eero UDP 10000–10200 = ring/no audio.
  if [[ -f /etc/asterisk/rtp_additional.conf ]]; then
    sed -i \"s/^rtpstart=.*/rtpstart=10000/\" /etc/asterisk/rtp_additional.conf || true
    sed -i \"s/^rtpend=.*/rtpend=10200/\" /etc/asterisk/rtp_additional.conf || true
    sed -i \"s/^strictrtp=.*/strictrtp=no/\" /etc/asterisk/rtp_additional.conf || true
  fi
  asterisk -rx \"module reload res_rtp_asterisk.so\" >/dev/null 2>&1 || true
  curl -sS -o /dev/null -w \"freepbx-media-health:%{http_code}\\n\" --connect-timeout 3 http://192.168.2.106:8790/health || true
  asterisk -rx \"rtp show settings\" 2>/dev/null | grep -E \"Port (start|end)\" || true
'"
ssh -n "$PVE" "mkdir -p /etc/phonehome && echo $FREEPBX_HASH > $FREEPBX_STAMP"
fi

wait_for_no_calls "restart kids-landline and phonehome-bridge"

ssh "$PVE" "pct exec $CTID -- env DEPLOY_REV=$DEPLOY_REV bash -s" <<'REMOTE'
set -e
systemctl restart kids-landline
systemctl restart phonehome-bridge || systemctl start phonehome-bridge || true
sleep 2
systemctl is-active kids-landline
systemctl is-active phonehome-bridge || echo "bridge not active yet (check journalctl -u phonehome-bridge)"
curl -sS http://127.0.0.1:8787/api/health; echo
curl -sS http://127.0.0.1:8787/api/bridge/health; echo
curl -sS http://127.0.0.1:8790/health; echo
cat /var/lib/kids-landline/HOST_CODE.txt 2>/dev/null || true
printf '%s %s\n' "$DEPLOY_REV" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /opt/kids-landline/DEPLOYED_REVISION
echo "DEPLOYED_REVISION $(cat /opt/kids-landline/DEPLOYED_REVISION)"
REMOTE

if [[ "${PHONEHOME_ATA_SYNC:-0}" == "1" ]]; then
  echo "==> PHONEHOME_ATA_SYNC=1: HT801 check-sync (each idle adapter re-provisions and restarts; its registration drops)"
  ATA_EXTENSIONS="$(ssh "$PVE" "pct exec $CTID -- sqlite3 /var/lib/kids-landline/kids-landline.db \"SELECT sip_extension FROM ata_devices WHERE model = 'ht801' ORDER BY sip_extension;\"")"
  ACTIVE_CHANNELS="$(ssh -n "$PVE" "pct exec $FREEPBX_CT -- asterisk -rx 'core show channels concise'" 2>/dev/null || true)"
  while IFS= read -r ext; do
    [[ "$ext" =~ ^[0-9]+$ ]] || continue
    if grep -q "^PJSIP/${ext}-" <<<"$ACTIVE_CHANNELS"; then
      echo "skip $ext: in a call; re-run with PHONEHOME_ATA_SYNC=1 when it is idle"
      continue
    fi
    # -n keeps ssh from consuming the rest of the extension list from this loop.
    # Plain check-sync performs the config request. reboot=true alone can reboot
    # without fetching, leaving a stale configuration on the adapter.
    ssh -n "$PVE" "pct exec $FREEPBX_CT -- asterisk -rx 'pjsip send notify phonehome-check-sync endpoint $ext'" || true
  done <<<"$ATA_EXTENSIONS"
else
  echo "==> HT801s untouched. After an HT801 provisioning change, re-run with PHONEHOME_ATA_SYNC=1."
fi

echo "==> Done ($DEPLOY_REV)"
