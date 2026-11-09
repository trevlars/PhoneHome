#!/usr/bin/env bash
# Install PhoneHome Mothership inside a Debian LXC (run as root in the container).
# Called by deploy/proxmox-ve-install.sh or manually after pct create.
set -euo pipefail

INSTALL_ROOT="${PHONEHOME_INSTALL_ROOT:-/opt/kids-landline}"
DATA_DIR="${DATA_DIR:-/var/lib/kids-landline}"
REPO="${PHONEHOME_REPO:-https://github.com/trevlars/PhoneHome.git}"
REF="${PHONEHOME_REF:-master}"
RELEASE_TAG="${PHONEHOME_RELEASE:-}"

msg() { echo "==> $*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing $1" >&2; exit 1; }
}

need_cmd curl
need_cmd tar

arch_bundle() {
  case "$(uname -m)" in
    x86_64|amd64) echo "linux-x64" ;;
    aarch64|arm64) echo "linux-arm64" ;;
    *) echo "unsupported" >&2; exit 1 ;;
  esac
}

install_from_release() {
  local tag="$1" platform="$2" base archive parent
  if [[ "$tag" == "latest" ]]; then
    tag="$(curl -fsSL https://api.github.com/repos/trevlars/PhoneHome/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  fi
  [[ -n "$tag" ]] || { echo "no GitHub release found — set PHONEHOME_REF=master for git install" >&2; return 1; }
  base="phonehome-mothership-${tag}-${platform}"
  parent="$(dirname "$INSTALL_ROOT")"
  rm -rf "$INSTALL_ROOT"
  mkdir -p "$parent"

  archive="/tmp/${base}.tar.gz"
  if curl -fsSL -o "$archive" "https://github.com/trevlars/PhoneHome/releases/download/${tag}/${base}.tar.gz"; then
    msg "Unpacking release ${tag} (${platform})"
    tar -xzf "$archive" -C "$parent"
    rm -f "$archive"
  else
    archive="/tmp/${base}.zip"
    if ! curl -fsSL -o "$archive" "https://github.com/trevlars/PhoneHome/releases/download/${tag}/${base}.zip"; then
      return 1
    fi
    need_cmd unzip
    msg "Unpacking release ${tag} (${platform}, zip)"
    unzip -q "$archive" -d "$parent"
    rm -f "$archive"
  fi

  if [[ -d "${parent}/phonehome-mothership" ]]; then
    mv "${parent}/phonehome-mothership" "$INSTALL_ROOT"
  else
    echo "release archive missing phonehome-mothership/ directory" >&2
    return 1
  fi
  return 0
}

install_from_git() {
  need_cmd git
  msg "Cloning $REPO ($REF)"
  rm -rf "$INSTALL_ROOT"
  git clone --depth 1 --branch "$REF" "$REPO" "$INSTALL_ROOT"
  cd "$INSTALL_ROOT"
  npm ci
  npm run build
  (cd bridged && npm ci --omit=dev)
}

install_node() {
  if command -v node >/dev/null 2>&1 && node -v | grep -qE '^v2[2-9]'; then
    return 0
  fi
  msg "Installing Node.js 22 (systemd units use /usr/bin/npm)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
}

msg "PhoneHome Mothership LXC setup"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
install_node

if [[ -n "$RELEASE_TAG" ]]; then
  install_from_release "$RELEASE_TAG" "$(arch_bundle)"
elif install_from_release latest "$(arch_bundle)"; then
  :
else
  msg "Release bundle unavailable — installing from git"
  install_from_git
fi

cd "$INSTALL_ROOT"

if [[ ! -f "$DATA_DIR/phonehome.env" ]]; then
  msg "Writing starter config (edit before going live)"
  umask 077
  SECRET="$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-40)"
  LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}' || hostname -I | awk '{print $1}')"
  cat >"$DATA_DIR/phonehome.env" <<EOF
PUBLIC_BASE_URL=https://phonehome.example.com:8443
SIP_PUBLIC_HOST=phonehome.example.com
PORT=8787
DATA_DIR=${DATA_DIR}
NODE_ENV=production
BRIDGE_URL=http://127.0.0.1:8790
ATA_LAN_PUSH=1
EOF
  cat >"$DATA_DIR/bridge.env" <<EOF
BRIDGE_SECRET=${SECRET}
PHONEHOME_URL=http://127.0.0.1:8787
PHONEHOME_WS=ws://127.0.0.1:8787/ws
ARI_URL=http://127.0.0.1:8088
ARI_USER=phonehome
ARI_PASS=change-me
ARI_APP=phonehome
EXT_MEDIA_HOST=${LAN_IP}
EXT_MEDIA_PORT_BASE=14000
BRIDGE_HTTP_PORT=8790
BRIDGE_HTTP_BIND=0.0.0.0
EOF
fi

msg "Installing systemd units"
cp "$INSTALL_ROOT/deploy/kids-landline.service" /etc/systemd/system/kids-landline.service
cp "$INSTALL_ROOT/deploy/phonehome-bridge.service" /etc/systemd/system/phonehome-bridge.service
mkdir -p /etc/systemd/system/kids-landline.service.d
cat >/etc/systemd/system/kids-landline.service.d/phonehome-data.conf <<EOF
[Service]
EnvironmentFile=-${DATA_DIR}/phonehome.env
EnvironmentFile=-${DATA_DIR}/bridge.env
EnvironmentFile=-${DATA_DIR}/freepbx-sync.env
Environment=BRIDGE_URL=http://127.0.0.1:8790
EOF
systemctl daemon-reload
systemctl enable kids-landline phonehome-bridge
systemctl restart kids-landline phonehome-bridge

sleep 2
curl -fsS http://127.0.0.1:8787/api/health && echo
systemctl is-active kids-landline phonehome-bridge

if [[ -f "$DATA_DIR/HOST_CODE.txt" ]]; then
  msg "Mothership setup code:"
  cat "$DATA_DIR/HOST_CODE.txt"
fi

msg "Done — edit ${DATA_DIR}/phonehome.env then: systemctl restart kids-landline phonehome-bridge"
