#!/bin/bash
# PhoneHome — cleartext SIP (UDP 5060) is LAN-only on the FreePBX CT.
#
# Install: /usr/local/sbin/phonehome-sip-lanonly.sh (run by
# phonehome-sip-lanonly.service at boot; deploy/proxmox-rsync.sh installs both).
#
# WHY: the eero forwards UDP 5060 to FreePBX, so internet SIP scanners reach the
# 0.0.0.0-udp transport directly (~2 pkts/s, 27k fail2ban bans). Nothing in
# PhoneHome uses UDP 5060: analog ATAs are SIP TLS 5061 (via the PVE socat proxy,
# source 192.168.2.31) and softphones are WebRTC through the hub. docs/privacy-security.md:
# cleartext SIP is never a production path. This drops it for non-RFC1918 sources
# until the eero port forward itself is removed (docs/threat-model.md).
#
# Idempotent: re-running rebuilds the chain and keeps a single INPUT jump.
set -euo pipefail

CHAIN=PHONEHOME_SIP_LAN

iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"
for net in 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  iptables -A "$CHAIN" -s "$net" -j RETURN
done
iptables -A "$CHAIN" -j DROP

if ! iptables -C INPUT -p udp --dport 5060 -j "$CHAIN" 2>/dev/null; then
  iptables -I INPUT 1 -p udp --dport 5060 -j "$CHAIN"
fi

echo "phonehome-sip-lanonly: UDP 5060 accepts RFC1918/loopback only"
