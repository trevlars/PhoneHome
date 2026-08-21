#!/usr/bin/env python3
"""Update FreePBX sip.secret for one extension and fwconsole reload.

Reads one JSON object from stdin: {"ext":"2001","secret":"..."}.
Never prints the secret — only a sha256 prefix on success.
Install on FreePBX CT: /usr/local/sbin/phonehome-set-sip-secret
"""
import hashlib
import json
import subprocess
import sys


def main() -> None:
    data = json.load(sys.stdin)
    ext = str(data.get("ext") or "").strip()
    secret = str(data.get("secret") or "")
    if not ext.isdigit() or not (2 <= len(ext) <= 8):
        print("bad ext", file=sys.stderr)
        sys.exit(2)
    if len(secret) < 8:
        print("bad secret", file=sys.stderr)
        sys.exit(2)
    esc = secret.replace("\\", "\\\\").replace("'", "''")
    subprocess.check_call(
        [
            "mysql",
            "asterisk",
            "-e",
            "UPDATE sip SET data='%s' WHERE id='%s' AND keyword='secret'" % (esc, ext),
        ]
    )
    out = subprocess.check_output(
        [
            "mysql",
            "-N",
            "asterisk",
            "-e",
            "SELECT LENGTH(data) FROM sip WHERE id='%s' AND keyword='secret'" % ext,
        ],
        text=True,
    ).strip()
    if not out:
        print("no sip row for ext", file=sys.stderr)
        sys.exit(3)
    subprocess.check_call(
        ["fwconsole", "reload"], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT
    )
    print(
        json.dumps(
            {
                "ok": True,
                "ext": ext,
                "secret_sha256": hashlib.sha256(secret.encode()).hexdigest()[:16],
                "secret_len": int(out),
            }
        )
    )


if __name__ == "__main__":
    main()
