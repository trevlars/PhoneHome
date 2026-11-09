#!/usr/bin/env bash
# Wrapper for Proxmox VE Helper Scripts (community-scripts/ProxmoxVE).
# Submit upstream as ct/phonehome.sh — sources build.func then runs in-container setup.
#
# Until merged upstream, use the standalone installer on the PVE host:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/trevlars/PhoneHome/master/deploy/proxmox-ve-install.sh)"
_CS_DEFAULT_URL="https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")

APP="PhoneHome"
var_tags="${var_tags:-communication}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-12}"
var_arm64="${var_arm64:-yes}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -d /opt/kids-landline ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi
  msg_info "Updating PhoneHome Mothership"
  curl -fsSL https://raw.githubusercontent.com/trevlars/PhoneHome/master/deploy/proxmox-lxc-setup.sh \
    | PHONEHOME_RELEASE=latest bash
  msg_ok "Updated PhoneHome"
  exit
}

start
build_container
description

msg_info "Installing PhoneHome Mothership"
curl -fsSL https://raw.githubusercontent.com/trevlars/PhoneHome/master/deploy/proxmox-lxc-setup.sh \
  | PHONEHOME_RELEASE=latest bash

msg_ok "Completed successfully!\n"
IP="$(hostname -I | awk '{print $1}')"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}LAN UI:${CL} ${TAB}${GATEWAY}${BGN}http://${IP}:8787${CL}"
echo -e "${INFO}${YW}Setup code:${CL} ${TAB}${GATEWAY}${BGN}cat /var/lib/kids-landline/HOST_CODE.txt${CL}"
