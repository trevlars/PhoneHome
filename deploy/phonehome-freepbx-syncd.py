#!/usr/bin/env python3
"""PhoneHome → FreePBX SIP-secret sync HTTP service.

Runs on the FreePBX host (recommended) or a lab Proxmox host that can reach
FreePBX. PhoneHome POSTs extension + secret; this forwards to phonehome-set-sip-secret.

Auth: Bearer token from FREEPBX_SYNC_TOKEN or FREEPBX_SYNC_TOKEN_FILE.

Environment:
  FREEPBX_SYNC_BIND_HOST   default 0.0.0.0
  FREEPBX_SYNC_BIND_PORT   default 8797
  FREEPBX_SYNC_TOKEN_FILE  default /etc/phonehome/sync.token
  FREEPBX_SYNC_ALLOWED     comma-separated client IPs (PhoneHome host), default 127.0.0.1
  PHONEHOME_SET_SIP_SECRET default /usr/local/sbin/phonehome-set-sip-secret
  FREEPBX_CT               optional Proxmox CT id — lab mode uses pct exec
  SIP_PUBLIC_HOST / PHONEHOME_SIP_PUBLIC_HOST / PHONEHOME_PUBLIC_MEDIA_IP
                           forwarded into FreePBX so remote ATAs get media_address
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

BIND_HOST = os.environ.get("FREEPBX_SYNC_BIND_HOST", "0.0.0.0")
BIND_PORT = int(os.environ.get("FREEPBX_SYNC_BIND_PORT", "8797"))
TOKEN_FILE = os.environ.get("FREEPBX_SYNC_TOKEN_FILE", "/etc/phonehome/sync.token")
SET_SIP_SCRIPT = os.environ.get(
    "PHONEHOME_SET_SIP_SECRET", "/usr/local/sbin/phonehome-set-sip-secret"
)
FREEPBX_CT = os.environ.get("FREEPBX_CT", "").strip()
ALLOWED = {
    ip.strip()
    for ip in os.environ.get("FREEPBX_SYNC_ALLOWED", "127.0.0.1").split(",")
    if ip.strip()
}


def _is_private_ipv4(ip: str) -> bool:
    parts = ip.strip().split(".")
    if len(parts) != 4:
        return False
    try:
        a, b = int(parts[0]), int(parts[1])
        int(parts[2])
        int(parts[3])
    except ValueError:
        return False
    if a in (10, 127):
        return True
    if a == 192 and b == 168:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    return False

# Env keys phonehome-set-sip-secret uses for SDP media_address on remote ATAs.
_MEDIA_ENV_KEYS = (
    "PHONEHOME_PUBLIC_MEDIA_IP",
    "PHONEHOME_SIP_PUBLIC_IP",
    "PHONEHOME_SIP_PUBLIC_HOST",
    "SIP_PUBLIC_HOST",
)


def media_env_pairs() -> list[str]:
    """KEY=value pairs to inject when pct-exec'ing into FreePBX."""
    out: list[str] = []
    for key in _MEDIA_ENV_KEYS:
        val = os.environ.get(key, "").strip()
        if val:
            out.append(f"{key}={val}")
    return out


def load_token() -> str:
    if os.environ.get("FREEPBX_SYNC_TOKEN", "").strip():
        return os.environ["FREEPBX_SYNC_TOKEN"].strip()
    with open(TOKEN_FILE, encoding="utf-8") as f:
        return f.read().strip()


def run_set_sip_secret(body: bytes) -> subprocess.CompletedProcess[bytes]:
    media = media_env_pairs()
    # Hub JSON is authoritative — inject media_address / sip_public_host into env
    # so pct exec cannot drop them even when freepbx-syncd.env is incomplete.
    try:
        data = json.loads(body.decode("utf-8") or "{}")
        if isinstance(data, dict):
            m = str(data.get("media_address") or data.get("public_media_ip") or "").strip()
            h = str(data.get("sip_public_host") or "").strip()
            # Do not let a hub hairpin (10.x / 192.168.x) replace a public RTP address.
            if m and _is_private_ipv4(m):
                m = ""
            if m:
                media = [p for p in media if not p.startswith("PHONEHOME_PUBLIC_MEDIA_IP=")]
                media.append(f"PHONEHOME_PUBLIC_MEDIA_IP={m}")
            if h:
                media = [
                    p
                    for p in media
                    if not p.startswith("PHONEHOME_SIP_PUBLIC_HOST=")
                    and not p.startswith("SIP_PUBLIC_HOST=")
                ]
                media.append(f"PHONEHOME_SIP_PUBLIC_HOST={h}")
                media.append(f"SIP_PUBLIC_HOST={h}")
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
        pass
    if FREEPBX_CT:
        cmd = ["pct", "exec", FREEPBX_CT, "--", "env", *media, SET_SIP_SCRIPT]
        return subprocess.run(cmd, input=body, capture_output=True)
    env = os.environ.copy()
    for pair in media:
        k, _, v = pair.partition("=")
        env[k] = v
    return subprocess.run([SET_SIP_SCRIPT], input=body, capture_output=True, env=env)


def run_sip_notify(ext: str, event: str) -> subprocess.CompletedProcess[bytes]:
    """Send authenticated SIP NOTIFY (check-sync / reboot) to one PJSIP endpoint."""
    # sip_notify_custom.conf: phonehome-reboot / phonehome-check-sync
    notify = "phonehome-reboot" if event == "reboot" else "phonehome-check-sync"
    rx = f"pjsip send notify {notify} endpoint {ext}"
    if FREEPBX_CT:
        cmd = ["pct", "exec", FREEPBX_CT, "--", "asterisk", "-rx", rx]
    else:
        cmd = ["asterisk", "-rx", rx]
    return subprocess.run(cmd, capture_output=True)


def _authorized(handler: BaseHTTPRequestHandler) -> bool:
    peer = handler.client_address[0]
    if ALLOWED and peer not in ALLOWED:
        handler.send_response(403)
        handler.end_headers()
        return False
    auth = handler.headers.get("Authorization", "")
    if auth != f"Bearer {load_token()}":
        handler.send_response(401)
        handler.end_headers()
        return False
    return True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path not in ("/sip-secret", "/sip-notify"):
            self.send_response(404)
            self.end_headers()
            return
        if not _authorized(self):
            return
        n = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(n)

        if path == "/sip-notify":
            try:
                data = json.loads(body.decode("utf-8") or "{}")
            except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
                data = {}
            ext = "".join(c for c in str((data or {}).get("ext") or "") if c.isdigit())
            event = str((data or {}).get("event") or "reboot").strip().lower()
            if event not in ("reboot", "check-sync"):
                event = "reboot"
            if not (2 <= len(ext) <= 8):
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":false,"err":"invalid extension"}')
                return
            proc = run_sip_notify(ext, event)
            out = (proc.stdout or b"").decode("utf-8", "replace").strip()
            err = (proc.stderr or b"").decode("utf-8", "replace").strip()
            # Asterisk prints "Sending NOTIFY…" on success; non-zero is rare.
            ok = proc.returncode == 0 and "failed" not in out.lower()
            self.send_response(200 if ok else 500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "ok": ok,
                        "ext": ext,
                        "event": event,
                        "detail": (out or err)[:200],
                        **({} if ok else {"err": err or out or f"exit {proc.returncode}"}),
                    }
                ).encode()
            )
            return

        proc = run_set_sip_secret(body)
        self.send_response(200 if proc.returncode == 0 else 500)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if proc.returncode == 0:
            self.wfile.write(proc.stdout or b'{"ok":true}')
        else:
            err = (proc.stderr or b"").decode("utf-8", "replace")[:200]
            self.wfile.write(
                json.dumps({"ok": False, "err": err or f"exit {proc.returncode}"}).encode()
            )


if __name__ == "__main__":
    HTTPServer((BIND_HOST, BIND_PORT), Handler).serve_forever()
