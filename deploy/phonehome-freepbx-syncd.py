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


def load_token() -> str:
    if os.environ.get("FREEPBX_SYNC_TOKEN", "").strip():
        return os.environ["FREEPBX_SYNC_TOKEN"].strip()
    with open(TOKEN_FILE, encoding="utf-8") as f:
        return f.read().strip()


def run_set_sip_secret(body: bytes) -> subprocess.CompletedProcess[bytes]:
    if FREEPBX_CT:
        return subprocess.run(
            ["pct", "exec", FREEPBX_CT, "--", SET_SIP_SCRIPT],
            input=body,
            capture_output=True,
        )
    return subprocess.run([SET_SIP_SCRIPT], input=body, capture_output=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_POST(self) -> None:
        if self.path != "/sip-secret":
            self.send_response(404)
            self.end_headers()
            return
        peer = self.client_address[0]
        if ALLOWED and peer not in ALLOWED:
            self.send_response(403)
            self.end_headers()
            return
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {load_token()}":
            self.send_response(401)
            self.end_headers()
            return
        n = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(n)
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
