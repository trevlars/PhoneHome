#!/usr/bin/env bash
# PhoneHome Mothership — Proxmox VE helper installer.
#
# Run on the Proxmox host as root (community-scripts style one-liner):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/trevlars/PhoneHome/master/deploy/proxmox-ve-install.sh)"
#
# Unattended example:
#   PHONEHOME_CTID=122 PHONEHOME_HOSTNAME=phonehome PHONEHOME_STORAGE=local-lvm \
#   PHONEHOME_BRIDGE=vmbr0 PHONEHOME_CORES=2 PHONEHOME_RAM=2048 PHONEHOME_DISK=8 \
#   bash deploy/proxmox-ve-install.sh
#
# After install: pct enter $CTID, edit /var/lib/kids-landline/phonehome.env, restart services.
set -euo pipefail

APP="PhoneHome Mothership"
REPO_RAW="${PHONEHOME_INSTALL_URL:-https://raw.githubusercontent.com/trevlars/PhoneHome/master}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the Proxmox VE host." >&2
  exit 1
fi
if ! command -v pct >/dev/null 2>&1 || [[ ! -d /etc/pve ]]; then
  echo "pct not found — this script must run on Proxmox VE." >&2
  exit 1
fi

CTID="${PHONEHOME_CTID:-}"
HOSTNAME="${PHONEHOME_HOSTNAME:-phonehome}"
STORAGE="${PHONEHOME_STORAGE:-}"
BRIDGE="${PHONEHOME_BRIDGE:-vmbr0}"
CORES="${PHONEHOME_CORES:-2}"
RAM="${PHONEHOME_RAM:-2048}"
DISK="${PHONEHOME_DISK:-8}"
TEMPLATE_STORAGE="${PHONEHOME_TEMPLATE_STORAGE:-local}"
DEBIAN_VERSION="${PHONEHOME_DEBIAN:-12}"
UNPRIVILEGED="${PHONEHOME_UNPRIVILEGED:-1}"
PASSWORD="${PHONEHOME_PASSWORD:-}"
RELEASE="${PHONEHOME_RELEASE:-latest}"

pick_storage() {
  pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active"{print $1}' | head -1
}

pick_template() {
  local ver="$1"
  pveam available --section system 2>/dev/null \
    | awk -v v="debian-${ver}-standard" '$2 ~ v && $2 ~ /_amd64\.tar/ {print $2}' \
    | sort -V | tail -1
}

next_ctid() {
  local id=100
  while pct status "$id" &>/dev/null; do id=$((id + 1)); done
  echo "$id"
}

prompt_default() {
  local var="$1" default="$2" label="$3" val
  if [[ -n "${!var:-}" ]]; then
    return 0
  fi
  read -r -p "${label} [${default}]: " val
  printf -v "$var" '%s' "${val:-$default}"
}

echo "=============================================="
echo "  ${APP} — Proxmox VE installer"
echo "=============================================="
echo ""

[[ -z "$CTID" ]] && CTID="$(next_ctid)"
[[ -z "$STORAGE" ]] && STORAGE="$(pick_storage)"
[[ -z "$STORAGE" ]] && { echo "No rootdir storage found. Set PHONEHOME_STORAGE." >&2; exit 1; }

if [[ -z "${PHONEHOME_CTID:-}" ]]; then
  prompt_default CTID "$CTID" "Container ID"
  prompt_default HOSTNAME "$HOSTNAME" "Hostname"
  prompt_default STORAGE "$STORAGE" "Container storage"
  prompt_default BRIDGE "$BRIDGE" "Network bridge"
  prompt_default CORES "$CORES" "CPU cores"
  prompt_default RAM "$RAM" "Memory (MiB)"
  prompt_default DISK "$DISK" "Disk (GiB)"
fi

if pct status "$CTID" &>/dev/null; then
  echo "CT $CTID already exists — skipping creation, running in-container setup only." >&2
else
  TEMPLATE="$(pick_template "$DEBIAN_VERSION")"
  if [[ -z "$TEMPLATE" ]]; then
    echo "Downloading Debian ${DEBIAN_VERSION} template..."
    pveam update || true
    TEMPLATE="$(pick_template "$DEBIAN_VERSION")"
  fi
  if [[ -z "$TEMPLATE" ]]; then
    echo "No Debian ${DEBIAN_VERSION} amd64 template. Run: pveam update && pveam available --section system" >&2
    exit 1
  fi
  if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
    echo "Fetching template ${TEMPLATE}..."
    pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
  fi

  if [[ -z "$PASSWORD" ]]; then
    PASSWORD="$(openssl rand -base64 18 | tr -d '=+/' | cut -c1-16)"
    echo "$PASSWORD" >"/root/phonehome-${CTID}.creds"
    chmod 600 "/root/phonehome-${CTID}.creds"
  fi

  echo "Creating CT ${CTID} (${HOSTNAME}) on ${STORAGE}..."
  pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
    --hostname "$HOSTNAME" \
    --cores "$CORES" \
    --memory "$RAM" \
    --rootfs "${STORAGE}:${DISK}" \
    --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
    --unprivileged "$UNPRIVILEGED" \
    --features nesting=1,keyctl=1 \
    --onboot 1 \
    --password "$PASSWORD"

  pct start "$CTID"
  echo "Waiting for network in CT ${CTID}..."
  for _ in $(seq 1 30); do
    if pct exec "$CTID" -- ping -c1 -W2 1.1.1.1 &>/dev/null; then
      break
    fi
    sleep 2
  done
fi

echo "Installing PhoneHome inside CT ${CTID}..."
pct exec "$CTID" -- bash -c "
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y curl ca-certificates openssl git tar xz-utils
  curl -fsSL '${REPO_RAW}/deploy/proxmox-lxc-setup.sh' -o /tmp/proxmox-lxc-setup.sh
  chmod +x /tmp/proxmox-lxc-setup.sh
  PHONEHOME_RELEASE='${RELEASE}' bash /tmp/proxmox-lxc-setup.sh
"

IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"

echo ""
echo "=============================================="
echo "  ${APP} ready in CT ${CTID}"
echo "=============================================="
echo "  LAN UI:     http://${IP:-<ct-ip>}:8787"
echo "  Config:     /var/lib/kids-landline/phonehome.env"
echo "  Setup code: pct exec ${CTID} -- cat /var/lib/kids-landline/HOST_CODE.txt"
if [[ -f "/root/phonehome-${CTID}.creds" ]]; then
  echo "  root password: /root/phonehome-${CTID}.creds"
fi
echo ""
echo "Next:"
echo "  1. pct enter ${CTID}"
echo "  2. Edit PUBLIC_BASE_URL in /var/lib/kids-landline/phonehome.env"
echo "  3. Put HTTPS in front (Caddy on PVE or Cloudflare Tunnel)"
echo "  4. systemctl restart kids-landline phonehome-bridge"
echo ""
echo "Docs: https://github.com/trevlars/PhoneHome/blob/master/docs/mothership-unraid-proxmox.md"
echo "Update app: ./deploy/proxmox-rsync.sh root@\$(hostname -I | awk '{print \$1}') ${CTID}"
