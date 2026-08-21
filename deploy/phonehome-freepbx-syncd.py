#!/usr/bin/env python3
"""Minimal PhoneHome → FreePBX SIP-secret sync (lab / Stage-1 host).

Binds to the Proxmox LAN IP. Only CT122 (PhoneHome) may POST.
Auth: Bearer token from /etc/phonehome/sync.token.

Body JSON: {"ext":"2001","secret":"..."}  — secret is never logged.
Forwards to FreePBX CT via pct exec phonehome-set-sip-secret.
"""
from __future__ import annotations

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN = open("/etc/phonehome/sync.token", encoding="utf-8").read().strip()
ALLOWED = {"10.0.5.106", "10.0.5.31", "127.0.0.1"}
FREEPBX_CT = "121"
BIND = ("10.0.5.31", 8797)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_POST(self) -> None:
        if self.path != "/sip-secret":
            self.send_response(404)
            self.end_headers()
            return
        peer = self.client_address[0]
        if peer not in ALLOWED:
            self.send_response(403)
            self.end_headers()
            return
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {TOKEN}":
            self.send_response(401)
            self.end_headers()
            return
        n = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(n)
        proc = subprocess.run(
            ["pct", "exec", FREEPBX_CT, "--", "/usr/local/sbin/phonehome-set-sip-secret"],
            input=body,
            capture_output=True,
        )
        self.send_response(200 if proc.returncode == 0 else 500)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if proc.returncode == 0:
            self.wfile.write(proc.stdout)
        else:
            err = (proc.stderr or b"").decode("utf-8", "replace")[:200]
            self.wfile.write(json.dumps({"ok": False, "err": err or f"exit {proc.returncode}"}).encode())


if __name__ == "__main__":
    HTTPServer(BIND, Handler).serve_forever()
