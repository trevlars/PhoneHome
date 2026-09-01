#!/usr/bin/env python3
"""Ensure a FreePBX PJSIP extension exists and its SIP secret matches PhoneHome.

Reads one JSON object from stdin:
  {
    "ext": "2002",
    "secret": "...",
    "display_name": "Beckett",          # optional
    "mode": "remote" | "lan"            # optional; default remote for new exts
  }

- Missing extension → create (clone sip keywords from template 2001 when present,
  else insert a minimal PJSIP set) + users/devices rows.
- Always updates secret.
- Applies TLS + SRTP overrides and writes [ext](+) into
  /etc/asterisk/pjsip.endpoint_custom_post.conf (idempotent).
- Never prints the secret — only a sha256 prefix on success.

Install on FreePBX CT: /usr/local/sbin/phonehome-set-sip-secret
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

CUSTOM_POST = Path(
    os.environ.get(
        "PHONEHOME_PJSIP_CUSTOM_POST",
        "/etc/asterisk/pjsip.endpoint_custom_post.conf",
    )
)
AOR_CUSTOM_POST = Path(
    os.environ.get(
        "PHONEHOME_PJSIP_AOR_CUSTOM_POST",
        "/etc/asterisk/pjsip.aor_custom_post.conf",
    )
)
TEMPLATE_EXT = os.environ.get("PHONEHOME_SIP_TEMPLATE_EXT", "2001").strip() or "2001"
# Public IP Asterisk must put in SDP for remote ATAs (eero UDP 10000–10200 → FreePBX).
PUBLIC_MEDIA_IP = (
    os.environ.get("PHONEHOME_PUBLIC_MEDIA_IP", "").strip()
    or os.environ.get("PHONEHOME_SIP_PUBLIC_IP", "").strip()
)


def resolve_public_media_ip() -> str | None:
    if PUBLIC_MEDIA_IP:
        return PUBLIC_MEDIA_IP
    host = (
        os.environ.get("PHONEHOME_SIP_PUBLIC_HOST", "").strip()
        or os.environ.get("SIP_PUBLIC_HOST", "").strip()
    )
    if not host:
        return None
    try:
        import socket

        return socket.getaddrinfo(host, None, socket.AF_INET)[0][4][0]
    except OSError:
        return None


def mysql(*args: str) -> str:
    return subprocess.check_output(["mysql", "-N", "asterisk", "-e", *args], text=True).strip()


def mysql_exec(sql: str) -> None:
    subprocess.check_call(["mysql", "asterisk", "-e", sql])


def esc_sql(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "''")


def ensure_sip_rows(ext: str, display_name: str, secret: str) -> bool:
    """Return True if extension was newly created."""
    count = mysql(f"SELECT COUNT(*) FROM sip WHERE id='{esc_sql(ext)}'")
    if count and count != "0":
        return False

    tmpl_count = mysql(f"SELECT COUNT(*) FROM sip WHERE id='{esc_sql(TEMPLATE_EXT)}'")
    name = display_name or f"PhoneHome ATA {ext}"
    if tmpl_count and tmpl_count != "0":
        mysql_exec(
            f"""
INSERT INTO sip (id, keyword, data, flags)
SELECT '{esc_sql(ext)}', keyword,
  CASE
    WHEN keyword='account' THEN '{esc_sql(ext)}'
    WHEN keyword='dial' THEN 'PJSIP/{esc_sql(ext)}'
    WHEN keyword='mailbox' THEN '{esc_sql(ext)}@device'
    WHEN keyword='callerid' THEN '{esc_sql(name)} <{esc_sql(ext)}>'
    WHEN keyword='secret' THEN ''
    ELSE data
  END,
  flags
FROM sip WHERE id='{esc_sql(TEMPLATE_EXT)}';
"""
        )
    else:
        # Minimal PJSIP rows if no template (fresh FreePBX).
        rows = {
            "account": ext,
            "secret": "",
            "callerid": f"{name} <{ext}>",
            "context": "from-internal",
            "dial": f"PJSIP/{ext}",
            "mailbox": f"{ext}@device",
            "sipdriver": "chan_pjsip",
            "transport": "0.0.0.0-tls",
            "qualify": "yes",
            "qualifyfreq": "60",
            "force_rport": "yes",
            "rtp_symmetric": "yes",
            "direct_media": "no",
            "rewrite_contact": "yes",
            "media_encryption": "sdes",
            "max_contacts": "2",
            "remove_existing": "yes",
            "dtmfmode": "rfc4733",
            "sendrpid": "pai",
            "trustrpid": "yes",
        }
        for kw, data in rows.items():
            mysql_exec(
                f"INSERT INTO sip (id, keyword, data, flags) VALUES "
                f"('{esc_sql(ext)}','{esc_sql(kw)}','{esc_sql(data)}',0)"
            )

    u = mysql(f"SELECT COUNT(*) FROM users WHERE extension='{esc_sql(ext)}'")
    if u == "0":
        mysql_exec(
            f"""
INSERT INTO users (extension, password, name, voicemail, ringtimer, noanswer, recording, outboundcid, sipname, mohclass)
VALUES ('{esc_sql(ext)}','','{esc_sql(name)}','novm','0','','','','','default');
"""
        )
    d = mysql(f"SELECT COUNT(*) FROM devices WHERE id='{esc_sql(ext)}'")
    if d == "0":
        mysql_exec(
            f"""
INSERT INTO devices (id, tech, dial, devicetype, user, description, emergency_cid, hint_override)
VALUES ('{esc_sql(ext)}','pjsip','PJSIP/{esc_sql(ext)}','fixed','{esc_sql(ext)}','{esc_sql(name)}','',NULL);
"""
        )
    return True


def set_secret(ext: str, secret: str) -> int:
    esc = esc_sql(secret)
    mysql_exec(
        f"UPDATE sip SET data='{esc}' WHERE id='{esc_sql(ext)}' AND keyword='secret'"
    )
    out = mysql(f"SELECT LENGTH(data) FROM sip WHERE id='{esc_sql(ext)}' AND keyword='secret'")
    if not out:
        print("no sip row for ext", file=sys.stderr)
        sys.exit(3)
    return int(out)


def upsert_sip_keyword(ext: str, keyword: str, data: str) -> None:
    exists = mysql(
        f"SELECT COUNT(*) FROM sip WHERE id='{esc_sql(ext)}' AND keyword='{esc_sql(keyword)}'"
    )
    if exists == "0":
        mysql_exec(
            f"INSERT INTO sip (id, keyword, data, flags) VALUES "
            f"('{esc_sql(ext)}','{esc_sql(keyword)}','{esc_sql(data)}',0)"
        )
    else:
        mysql_exec(
            f"UPDATE sip SET data='{esc_sql(data)}' WHERE id='{esc_sql(ext)}' "
            f"AND keyword='{esc_sql(keyword)}'"
        )


def apply_mode_settings(ext: str, mode: str, display_name: str | None) -> None:
    """TLS + SRTP for all ATAs; rewrite_contact yes for remote, no for lab LAN."""
    remote = mode != "lan"
    upsert_sip_keyword(ext, "transport", "0.0.0.0-tls")
    upsert_sip_keyword(ext, "media_encryption", "sdes")
    upsert_sip_keyword(ext, "direct_media", "no")
    upsert_sip_keyword(ext, "force_rport", "yes")
    upsert_sip_keyword(ext, "rtp_symmetric", "yes")
    upsert_sip_keyword(ext, "rewrite_contact", "yes" if remote else "no")
    upsert_sip_keyword(ext, "qualify", "yes")
    # Remotes: 60s qualify + longer timeout (TLS proxy). 30s/3s flapped Unavail.
    upsert_sip_keyword(ext, "qualifyfreq", "60")
    # One Contact only — Avail+Unavail twins made Dial hit the dead one.
    upsert_sip_keyword(ext, "max_contacts", "1")
    upsert_sip_keyword(ext, "remove_existing", "yes")
    # Drop dead Contacts after TLS proxy reconnect (remote ATAs).
    upsert_sip_keyword(ext, "remove_unavailable", "yes" if remote else "no")
    # Keep NAT RTP bindings alive on remotes (0 = off for LAN).
    upsert_sip_keyword(ext, "rtp_keepalive", "15" if remote else "0")
    # Remote Contact is the PVE proxy (local IP) after rewrite_contact — force public SDP.
    pub = resolve_public_media_ip() if remote else None
    if remote and pub:
        upsert_sip_keyword(ext, "media_address", pub)
    else:
        # Clear stale public media_address if this ext moved back to lan.
        mysql_exec(
            f"DELETE FROM sip WHERE id='{esc_sql(ext)}' AND keyword='media_address'"
        )
    if display_name:
        upsert_sip_keyword(ext, "callerid", f"{display_name} <{ext}>")
        # Best-effort keep FreePBX UI name in sync
        mysql_exec(
            f"UPDATE users SET name='{esc_sql(display_name)}' WHERE extension='{esc_sql(ext)}'"
        )
        mysql_exec(
            f"UPDATE devices SET description='{esc_sql(display_name)}' WHERE id='{esc_sql(ext)}'"
        )


def _ata_block(ext: str, mode: str, media_ip: str | None = None) -> str:
    remote = mode != "lan"
    rewrite = "yes" if remote else "no"
    media_line = f"media_address={media_ip}\n" if remote and media_ip else ""
    keepalive = "15" if remote else "0"
    # outbound_auth: HT801 challenges unsolicited NOTIFY (check-sync/reboot) with 401.
    # Without this, Asterisk logs noendpoint / "no auth ids" and provision never pulls.
    return (
        f"; PhoneHome ATA {ext} ({'remote' if remote else 'lan'})\n"
        f"[{ext}](+)\n"
        f"transport=0.0.0.0-tls\n"
        f"media_encryption=sdes\n"
        f"media_encryption_optimistic=no\n"
        f"rewrite_contact={rewrite}\n"
        f"{media_line}"
        f"direct_media=no\n"
        f"force_rport=yes\n"
        f"rtp_symmetric=yes\n"
        f"rtp_keepalive={keepalive}\n"
        f"outbound_auth={ext}-auth\n"
    )


def _parse_managed_modes(text: str) -> dict[str, str]:
    """Recover ext → lan|remote from existing [NNNN](+) rewrite_contact lines."""
    modes: dict[str, str] = {}
    cur: str | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("[") and line.endswith("](+)"):
            body = line[1 : -len("](+)")]
            cur = body if body.isdigit() else None
            continue
        if cur and line.startswith("rewrite_contact="):
            val = line.split("=", 1)[1].strip().lower()
            modes[cur] = "lan" if val == "no" else "remote"
            cur = None
    return modes


def ensure_custom_post(ext: str, mode: str) -> None:
    """Rewrite the whole managed file (header + one block per ATA). Idempotent."""
    CUSTOM_POST.parent.mkdir(parents=True, exist_ok=True)
    text = CUSTOM_POST.read_text(encoding="utf-8") if CUSTOM_POST.exists() else ""
    modes = _parse_managed_modes(text)
    modes[ext] = mode
    pub = resolve_public_media_ip()

    header = (
        "; PhoneHome — TLS + SRTP (SDES) for FXS extension(s)\n"
        "; Managed by phonehome-set-sip-secret — do not hand-edit ATA blocks.\n"
        "; lan: rewrite_contact=no (lab / same-LAN Contact). "
        "remote: rewrite_contact=yes + media_address=public IP "
        "(Contact is PVE proxy; without media_address SDP stays private → no audio).\n"
    )
    parts = [header]
    for e in sorted(modes, key=lambda x: (len(x), x)):
        parts.append("")
        m = modes[e]
        parts.append(_ata_block(e, m, pub if m != "lan" else None).rstrip())
    CUSTOM_POST.write_text("\n".join(parts) + "\n", encoding="utf-8")


def _aor_block(ext: str, mode: str) -> str:
    remote = mode != "lan"
    # (+type=aor) is required on Asterisk 22 — bare (+) did not apply remove_unavailable.
    return (
        f"; PhoneHome ATA {ext} AOR ({'remote' if remote else 'lan'})\n"
        f"[{ext}](+type=aor)\n"
        f"max_contacts=1\n"
        f"remove_existing=yes\n"
        f"remove_unavailable={'yes' if remote else 'no'}\n"
        f"qualify_frequency=60\n"
        f"qualify_timeout={'8.0' if remote else '3.0'}\n"
    )


def ensure_aor_custom_post(ext: str, mode: str) -> None:
    """Managed AOR overlays — FreePBX sip table does not always emit these."""
    AOR_CUSTOM_POST.parent.mkdir(parents=True, exist_ok=True)
    text = AOR_CUSTOM_POST.read_text(encoding="utf-8") if AOR_CUSTOM_POST.exists() else ""
    modes: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("; PhoneHome ATA ") and " AOR (" in line:
            # ; PhoneHome ATA 2002 AOR (remote)
            try:
                mid = line.split("ATA ", 1)[1]
                e = mid.split(" ", 1)[0]
                m = "remote" if "(remote)" in line else "lan"
                if e.isdigit():
                    modes[e] = m
            except IndexError:
                pass
    modes[ext] = mode

    header = (
        "; PhoneHome — managed AOR overlays (phonehome-set-sip-secret)\n"
        "; max_contacts=1 avoids Avail+Unavail twins breaking Dial to remotes.\n"
    )
    parts = [header]
    for e in sorted(modes, key=lambda x: (len(x), x)):
        parts.append("")
        parts.append(_aor_block(e, modes[e]).rstrip())
    AOR_CUSTOM_POST.write_text("\n".join(parts) + "\n", encoding="utf-8")


def main() -> None:
    data = json.load(sys.stdin)
    ext = str(data.get("ext") or "").strip()
    secret = str(data.get("secret") or "")
    display_name = str(data.get("display_name") or "").strip()[:64] or None
    mode_raw = str(data.get("mode") or "").strip().lower()
    if mode_raw and mode_raw not in ("remote", "lan"):
        print("mode must be remote or lan", file=sys.stderr)
        sys.exit(2)
    if not ext.isdigit() or not (2 <= len(ext) <= 8):
        print("bad ext", file=sys.stderr)
        sys.exit(2)
    if len(secret) < 8:
        print("bad secret", file=sys.stderr)
        sys.exit(2)

    created = ensure_sip_rows(ext, display_name or f"PhoneHome ATA {ext}", secret)
    # Default: lab template stays lan; everything else is remote (other households).
    if mode_raw in ("remote", "lan"):
        mode = mode_raw
    elif ext == TEMPLATE_EXT:
        mode = "lan"
    else:
        mode = "remote"

    secret_len = set_secret(ext, secret)
    apply_mode_settings(ext, mode, display_name)
    ensure_custom_post(ext, mode)
    ensure_aor_custom_post(ext, mode)
    subprocess.check_call(
        ["fwconsole", "reload"], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT
    )
    # FreePBX GUI / apply often rewrites rtp_additional to 10000–20000; keep eero-sized.
    try:
        rtp_add = Path("/etc/asterisk/rtp_additional.conf")
        if rtp_add.exists():
            txt = rtp_add.read_text(encoding="utf-8")
            txt2 = txt.replace("rtpend=20000", "rtpend=10200").replace(
                "strictrtp=yes", "strictrtp=no"
            )
            if txt2 != txt:
                rtp_add.write_text(txt2, encoding="utf-8")
                subprocess.call(
                    ["asterisk", "-rx", "module reload res_rtp_asterisk.so"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
    except OSError:
        pass
    print(
        json.dumps(
            {
                "ok": True,
                "ext": ext,
                "created": created,
                "mode": mode,
                "secret_sha256": hashlib.sha256(secret.encode()).hexdigest()[:16],
                "secret_len": secret_len,
            }
        )
    )


if __name__ == "__main__":
    main()
