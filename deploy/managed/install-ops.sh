#!/usr/bin/env bash
# Install backup, monitoring, and SIP certificate maintenance timers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANAGED="$ROOT/deploy/managed"
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

write_service() {
  local name="$1" command="$2"
  cat >"/etc/systemd/system/$name.service" <<EOF
[Unit]
Description=PhoneHome managed $name
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$ROOT
ExecStart=$command
EOF
}

write_timer() {
  local name="$1" schedule="$2"
  cat >"/etc/systemd/system/$name.timer" <<EOF
[Unit]
Description=Schedule PhoneHome managed $name

[Timer]
OnCalendar=$schedule
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
EOF
}

write_service phonehome-managed-backup "$MANAGED/backup.sh"
write_timer phonehome-managed-backup "*-*-* 03:15:00"
write_service phonehome-managed-monitor "$MANAGED/monitor.sh"
write_timer phonehome-managed-monitor "*:0/5"
write_service phonehome-managed-sip-cert \
  "/usr/bin/env bash -lc 'set -a; source \"$MANAGED/.env\"; set +a; SIP_HOST=\"\$PHONEHOME_HOST\" \"$MANAGED/sync-sip-cert.sh\"'"
write_timer phonehome-managed-sip-cert "*-*-* 04:10:00"

systemctl daemon-reload
systemctl enable --now \
  phonehome-managed-backup.timer \
  phonehome-managed-monitor.timer \
  phonehome-managed-sip-cert.timer

echo "Installed managed PhoneHome operations timers."
