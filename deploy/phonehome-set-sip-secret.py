#!/usr/bin/env python3
"""Ensure a FreePBX PJSIP extension exists and its SIP secret matches PhoneHome.

Reads one JSON object from stdin:
  {
    "ext": "2002",
    "secret": "...",
    "display_name": "Sam",          # optional
    "mode": "remote" | "lan" | "home",  # optional; default remote. home≡lan
    "media_address": "1.2.3.4",         # optional; hub-resolved public RTP IP
    "sip_public_host": "sip.example.com"  # optional; hub SIP_PUBLIC_HOST
  }

- Missing extension → create (clone sip keywords from template 2001 when present,
  else insert a minimal PJSIP set) + users/devices rows.
- Always updates secret.
- Applies TLS + SRTP overrides and writes [ext](+) into
  /etc/asterisk/pjsip.endpoint_custom_post.conf (idempotent).
- Runs `fwconsole reload` only when the extension's state differs from the
  last applied state (PHONEHOME_SIP_APPLIED_DIR), never for a no-op re-sync.
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
# Per-extension hash of the state the last successful `fwconsole reload` applied.
APPLIED_DIR = Path(
    os.environ.get("PHONEHOME_SIP_APPLIED_DIR", "/var/lib/phonehome/sip-applied")
)


def _dns_a(host: str) -> str | None:
    host = host.strip().split(":")[0].strip()
    if not host or host.replace(".", "").isdigit():
        return host or None
    try:
        import socket

        return socket.getaddrinfo(host, None, socket.AF_INET)[0][4][0]
    except OSError:
        return None


def _media_host_from_transport_conf() -> str | None:
    """Fall back to external_media_address already on the TLS transport."""
    for path in (
        Path("/etc/asterisk/pjsip.transports_custom.conf"),
        Path("/etc/asterisk/pjsip.transports.conf"),
    ):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            s = line.strip()
            if s.startswith("external_media_address="):
                val = s.split("=", 1)[1].strip()
                if val:
                    return val
    return None


def _public_a_record(host: str) -> str | None:
    """A record from a resolver that does not apply the LAN AdGuard rewrite."""
    import random
    import socket
    import struct

    host = host.strip().split(":")[0].strip().rstrip(".")
    if not host or _is_private_ipv4(host):
        return None
    labels = host.split(".")
    if any(not part or len(part) > 63 for part in labels):
        return None
    qname = b"".join(bytes([len(part)]) + part.encode("ascii") for part in labels) + b"\x00"
    tid = random.randint(0, 0xFFFF)
    packet = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0) + qname + struct.pack(">HH", 1, 1)

    def skip_name(data: bytes, offset: int) -> int:
        while offset < len(data):
            n = data[offset]
            if n == 0:
                return offset + 1
            if n & 0xC0 == 0xC0:
                return offset + 2
            offset += 1 + n
        return offset

    for server in ("1.1.1.1", "8.8.8.8"):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.settimeout(2)
            sock.sendto(packet, (server, 53))
            data, _ = sock.recvfrom(512)
        except OSError:
            continue
        finally:
            sock.close()
        if len(data) < 12 or struct.unpack(">H", data[0:2])[0] != tid:
            continue
        ancount = struct.unpack(">H", data[6:8])[0]
        offset = skip_name(data, 12) + 4
        for _ in range(ancount):
            offset = skip_name(data, offset)
            if offset + 10 > len(data):
                break
            typ, _cls, _ttl, rdlen = struct.unpack(">HHIH", data[offset : offset + 10])
            offset += 10
            if typ == 1 and rdlen == 4 and offset + 4 <= len(data):
                ip = socket.inet_ntoa(data[offset : offset + 4])
                if not _is_private_ipv4(ip):
                    return ip
            offset += rdlen
    return None


def _accept_public_ipv4(ip: str | None) -> str | None:
    if not ip or _is_private_ipv4(ip):
        return None
    parts = ip.strip().split(".")
    if len(parts) != 4:
        return None
    try:
        if any(int(p) > 255 for p in parts):
            return None
    except ValueError:
        return None
    return ip.strip()


def resolve_public_media_ip() -> str | None:
    """Public IPv4 Asterisk must put in SDP for remote ATAs (eero RTP forwards).

    Prefer env set from the hub sync JSON (media_address / sip_public_host) so
    lab pct-exec does not need freepbx-syncd.env. A private answer is the LAN
    AdGuard rewrite of the public SIP name (192.168.2.31) and must not be written
    — cousin ATAs then ring with no audio. Fall through to a public resolver.
    """
    forced = (
        os.environ.get("PHONEHOME_PUBLIC_MEDIA_IP", "").strip()
        or os.environ.get("PHONEHOME_SIP_PUBLIC_IP", "").strip()
    )
    if forced:
        ip = forced if forced.replace(".", "").isdigit() else _dns_a(forced)
        accepted = _accept_public_ipv4(ip)
        if accepted:
            return accepted
    host = (
        os.environ.get("PHONEHOME_SIP_PUBLIC_HOST", "").strip()
        or os.environ.get("SIP_PUBLIC_HOST", "").strip()
        or _media_host_from_transport_conf()
        or ""
    )
    host = host.strip().split(":")[0].strip()
    if not host or _is_private_ipv4(host):
        return None
    if host.replace(".", "").isdigit():
        return _accept_public_ipv4(host)
    accepted = _accept_public_ipv4(_dns_a(host))
    if accepted:
        return accepted
    return _accept_public_ipv4(_public_a_record(host))


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
    if a == 10:
        return True
    if a == 192 and b == 168:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    return False


def resolve_lan_media_ip() -> str | None:
    """FreePBX LAN IPv4 for mothership ATA SDP (c= line).

    Home ATAs register via the PVE SIP TLS proxy, so Contact is 192.168.2.31 —
    outside transport local_net=192.168.1.0/24. With no media_address Asterisk
    then advertises transport external_media_address (public WAN). The home
    HT801 hairpins uplink RTP and the far side hears silence (Quinn↔Alex,
    softphone↔Alex). Pin media_address to this host's LAN IP instead.
    """
    forced = os.environ.get("PHONEHOME_LAN_MEDIA_IP", "").strip()
    if forced:
        return forced if forced.replace(".", "").isdigit() else _dns_a(forced)
    try:
        out = subprocess.check_output(
            [
                "bash",
                "-lc",
                "ip -4 -o route get 1.1.1.1 2>/dev/null "
                "| awk '{for(i=1;i<=NF;i++) if($i==\"src\"){print $(i+1); exit}}'",
            ],
            text=True,
            timeout=5,
        ).strip()
        if out and _is_private_ipv4(out):
            return out
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def apply_media_hints_from_request(data: dict) -> None:
    """Hub sends media_address + sip_public_host — apply before resolve_*."""
    media = str(
        data.get("media_address") or data.get("public_media_ip") or ""
    ).strip()
    host = str(data.get("sip_public_host") or data.get("SIP_PUBLIC_HOST") or "").strip()
    lan = str(data.get("lan_media_address") or data.get("lan_media_ip") or "").strip()
    # A private address here is split-horizon DNS of the public SIP name
    # (AdGuard → mothership LAN). Do not store it as the remote RTP address.
    if media and not _is_private_ipv4(media):
        os.environ["PHONEHOME_PUBLIC_MEDIA_IP"] = media
    if host:
        os.environ["PHONEHOME_SIP_PUBLIC_HOST"] = host
        os.environ["SIP_PUBLIC_HOST"] = host
    if lan:
        os.environ["PHONEHOME_LAN_MEDIA_IP"] = lan


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
    """TLS + SRTP for all ATAs.

    rewrite_contact is ALWAYS yes. Mothership home ATAs register via the public
    SIP host → PVE TLS proxy; without rewrite_contact, Contact becomes the ATA
    LAN IP and qualify opens a new TLS socket that fails → Unavail / app offline.
    Cousin remotes need rewrite_contact for the same proxy path.

    media_address is the only lan vs remote difference: remotes need the public
    WAN IP in SDP; home ATAs need the FreePBX LAN IP (Contact is the PVE proxy
    outside local_net, so omitting media_address advertises the public WAN and
    breaks home uplink — Quinn can't hear Alex, softphone hears silence).
    """
    remote = mode != "lan"
    # Never pin sip.transport — FreePBX would emit transport=0.0.0.0-tls on the
    # endpoint and break TLS connection reuse through the PVE SIP proxy (Unavail).
    mysql_exec(f"DELETE FROM sip WHERE id='{esc_sql(ext)}' AND keyword='transport'")
    upsert_sip_keyword(ext, "media_encryption", "sdes")
    upsert_sip_keyword(ext, "direct_media", "no")
    upsert_sip_keyword(ext, "force_rport", "yes")
    upsert_sip_keyword(ext, "rtp_symmetric", "yes")
    # Home LAN media_address: bind RTP to that IP so c= and socket match.
    upsert_sip_keyword(
        ext, "bind_rtp_to_media_address", "yes" if not remote else "no"
    )
    upsert_sip_keyword(ext, "rewrite_contact", "yes")
    upsert_sip_keyword(ext, "qualify", "yes")
    # 60s qualify + longer timeout (TLS proxy). 30s/3s flapped Unavail.
    upsert_sip_keyword(ext, "qualifyfreq", "60")
    # One Contact only — Avail+Unavail twins made Dial hit the dead one.
    upsert_sip_keyword(ext, "max_contacts", "1")
    upsert_sip_keyword(ext, "remove_existing", "yes")
    # Drop dead Contacts after TLS proxy reconnect.
    upsert_sip_keyword(ext, "remove_unavailable", "yes")
    # Keep NAT RTP bindings alive (proxy path for home + cousins).
    upsert_sip_keyword(ext, "rtp_keepalive", "15")
    # Contact is always the PVE proxy after rewrite_contact — pin SDP c= explicitly.
    if remote:
        pub = resolve_public_media_ip()
        if not pub:
            print(
                "remote mode needs public media IP "
                "(set PHONEHOME_PUBLIC_MEDIA_IP or SIP_PUBLIC_HOST); "
                "refusing to clear media_address (would cause ring/no-audio)",
                file=sys.stderr,
            )
            sys.exit(4)
        upsert_sip_keyword(ext, "media_address", pub)
    else:
        lan = resolve_lan_media_ip()
        if not lan:
            print(
                "home/lan mode needs FreePBX LAN media IP "
                "(PHONEHOME_LAN_MEDIA_IP or host default-route src); "
                "refusing empty media_address (public WAN hairpin → one-way audio)",
                file=sys.stderr,
            )
            sys.exit(4)
        upsert_sip_keyword(ext, "media_address", lan)
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
    media_line = f"media_address={media_ip}\n" if media_ip else ""
    # outbound_auth: HT801 challenges unsolicited NOTIFY (check-sync/reboot) with 401.
    # Without this, Asterisk logs noendpoint / "no auth ids" and provision never pulls.
    #
    # Do NOT pin transport=0.0.0.0-tls on the endpoint. An explicit transport forces
    # new TLS sockets for qualify/INVITE instead of reusing the ATA→proxy→FreePBX
    # registration connection — Contacts stick Unavail (nan RTT) and analogs go dark.
    #
    # rewrite_contact=yes always (home + remote): Contact stays on the PVE SIP TLS
    # proxy so qualify/INVITE reuse the registration socket.
    label = "remote" if remote else "home"
    bind_line = "" if remote else "bind_rtp_to_media_address=yes\n"
    return (
        f"; PhoneHome ATA {ext} ({label})\n"
        f"[{ext}](+)\n"
        f"media_encryption=sdes\n"
        f"media_encryption_optimistic=no\n"
        f"rewrite_contact=yes\n"
        f"{media_line}"
        f"{bind_line}"
        f"direct_media=no\n"
        f"force_rport=yes\n"
        f"rtp_symmetric=yes\n"
        f"rtp_keepalive=15\n"
        f"outbound_auth={ext}-auth\n"
    )


def _normalize_mode(mode: str) -> str:
    """Map aliases to lan|remote. 'home' == mothership ATA (LAN media_address)."""
    m = (mode or "").strip().lower()
    if m in ("lan", "home"):
        return "lan"
    return "remote"


def audit_remote_media(text: str) -> tuple[list[str], list[str]]:
    """Classify (remote) endpoint blocks for the doctor.

    Home/lan blocks may use a private media_address. A remote block must be a
    public IPv4. A LAN address there is split-horizon DNS of the SIP hostname:
    the cousin phone rings and has no audio. Returns (ok, bad) as 'ext=value'.
    """
    import ipaddress
    import re

    def public_ip(value: str | None) -> bool:
        try:
            addr = ipaddress.ip_address(str(value or "").strip())
        except ValueError:
            return False
        return not (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_unspecified
            or addr.is_reserved
        )

    ok: list[str] = []
    bad: list[str] = []
    cur: str | None = None
    cur_mode: str | None = None
    pending: str | None = None
    media: str | None = None

    def flush() -> None:
        nonlocal cur, cur_mode, media
        if cur and cur_mode == "remote":
            if public_ip(media):
                ok.append(f"{cur}={media}")
            else:
                bad.append(f"{cur}={media or '(missing)'}")
        cur = None
        cur_mode = None
        media = None

    for raw in text.splitlines():
        line = raw.strip()
        label = re.match(r"; PhoneHome ATA (\d+) \((home|lan|remote)\)\s*$", line)
        if label:
            flush()
            pending = "lan" if label.group(2) in ("home", "lan") else "remote"
            continue
        if line.startswith("[") and line.endswith("](+)"):
            flush()
            body = line[1 : -len("](+)")]
            cur = body if body.isdigit() else None
            cur_mode = pending
            pending = None
            media = None
            continue
        if cur and line.startswith("media_address="):
            media = line.split("=", 1)[1].strip()
    flush()
    return ok, bad


def _parse_managed_modes(text: str) -> dict[str, str]:
    """Recover ext → lan|remote from managed custom_post.

    Canonical signal is the comment label:
      ; PhoneHome ATA 2001 (home)   → lan
      ; PhoneHome ATA 2003 (remote) → remote

    Do NOT infer from rewrite_contact — it is always yes (proxy path). Inferring
    remote from rewrite_contact=yes re-tagged every home ATA as remote on the
    next cousin sync and re-injected public media_address (softphone broke).

    Fallbacks for older files without labels:
      - media_address=<public> → remote
      - media_address=<private RFC1918> → lan (home LAN pin)
      - rewrite_contact=no → lan (legacy lab)
      - otherwise (rewrite=yes, no media) → lan — mothership home shape;
        never infer remote from rewrite alone (that was the softphone regression)
    """
    import re

    modes: dict[str, str] = {}
    cur: str | None = None
    media_ip: str | None = None

    def flush() -> None:
        nonlocal cur, media_ip
        if cur and cur not in modes:
            if media_ip and not _is_private_ipv4(media_ip):
                modes[cur] = "remote"
            else:
                modes[cur] = "lan"
        cur = None
        media_ip = None

    for raw in text.splitlines():
        line = raw.strip()
        # Endpoint labels only — skip "; PhoneHome ATA NNNN AOR (…)"
        label = re.match(r"; PhoneHome ATA (\d+) \((home|lan|remote)\)\s*$", line)
        if label:
            flush()
            ext, kind = label.group(1), label.group(2)
            modes[ext] = "lan" if kind in ("home", "lan") else "remote"
            continue
        if line.startswith("[") and line.endswith("](+)"):
            flush()
            body = line[1 : -len("](+)")]
            # Skip AOR overlays: [2001](+type=aor)
            if "type=" in body:
                cur = None
                continue
            cur = body if body.isdigit() else None
            continue
        if cur is None:
            continue
        if line.startswith("media_address="):
            val = line.split("=", 1)[1].strip()
            if val:
                media_ip = val
    flush()
    return modes


def ensure_custom_post(ext: str, mode: str) -> None:
    """Rewrite the whole managed file (header + one block per ATA). Idempotent."""
    CUSTOM_POST.parent.mkdir(parents=True, exist_ok=True)
    text = CUSTOM_POST.read_text(encoding="utf-8") if CUSTOM_POST.exists() else ""
    modes = _parse_managed_modes(text)
    modes[ext] = _normalize_mode(mode)
    pub = resolve_public_media_ip()
    lan = resolve_lan_media_ip()
    if any(m != "lan" for m in modes.values()) and not pub:
        print(
            "remote ATA(s) need public media IP "
            "(PHONEHOME_PUBLIC_MEDIA_IP / SIP_PUBLIC_HOST / transport external_media_address)",
            file=sys.stderr,
        )
        sys.exit(4)
    if any(m == "lan" for m in modes.values()) and not lan:
        print(
            "home ATA(s) need FreePBX LAN media IP "
            "(PHONEHOME_LAN_MEDIA_IP or host default-route src)",
            file=sys.stderr,
        )
        sys.exit(4)

    header = (
        "; PhoneHome — TLS + SRTP (SDES) for FXS extension(s)\n"
        "; Managed by phonehome-set-sip-secret — do not hand-edit ATA blocks.\n"
        "; home/lan: rewrite_contact=yes + media_address=FreePBX LAN IP.\n"
        "; remote: rewrite_contact=yes + media_address=public IP (cousin houses).\n"
        "; rewrite_contact is always yes so Contact stays on the SIP TLS proxy.\n"
    )
    parts = [header]
    for e in sorted(modes, key=lambda x: (len(x), x)):
        parts.append("")
        m = modes[e]
        parts.append(_ata_block(e, m, pub if m != "lan" else lan).rstrip())
    CUSTOM_POST.write_text("\n".join(parts) + "\n", encoding="utf-8")


def _aor_block(ext: str, mode: str) -> str:
    # Home and remote both register through the TLS proxy on typical motherships —
    # use long qualify + remove_unavailable so Contacts do not stick Unavail.
    label = "remote" if mode != "lan" else "home"
    return (
        f"; PhoneHome ATA {ext} AOR ({label})\n"
        f"[{ext}](+type=aor)\n"
        f"max_contacts=1\n"
        f"remove_existing=yes\n"
        f"remove_unavailable=yes\n"
        f"qualify_frequency=60\n"
        f"qualify_timeout=8.0\n"
    )


def ensure_aor_custom_post(ext: str, mode: str) -> None:
    """Managed AOR overlays — FreePBX sip table does not always emit these."""
    AOR_CUSTOM_POST.parent.mkdir(parents=True, exist_ok=True)
    text = AOR_CUSTOM_POST.read_text(encoding="utf-8") if AOR_CUSTOM_POST.exists() else ""
    modes: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("; PhoneHome ATA ") and " AOR (" in line:
            # ; PhoneHome ATA 2002 AOR (remote) | (home) | (lan)
            try:
                mid = line.split("ATA ", 1)[1]
                e = mid.split(" ", 1)[0]
                if "(remote)" in line:
                    m = "remote"
                else:
                    m = "lan"  # (home) or (lan)
                if e.isdigit():
                    modes[e] = m
            except IndexError:
                pass
    modes[ext] = _normalize_mode(mode)

    header = (
        "; PhoneHome — managed AOR overlays (phonehome-set-sip-secret)\n"
        "; max_contacts=1 avoids Avail+Unavail twins breaking Dial to remotes.\n"
    )
    parts = [header]
    for e in sorted(modes, key=lambda x: (len(x), x)):
        parts.append("")
        parts.append(_aor_block(e, modes[e]).rstrip())
    AOR_CUSTOM_POST.write_text("\n".join(parts) + "\n", encoding="utf-8")


def managed_state(ext: str) -> str:
    """Hash of everything this helper writes for one extension."""
    e = esc_sql(ext)
    parts = [
        mysql(f"SELECT keyword, data FROM sip WHERE id='{e}' ORDER BY keyword"),
        mysql(f"SELECT name FROM users WHERE extension='{e}'"),
        mysql(f"SELECT description FROM devices WHERE id='{e}'"),
    ]
    for path in (CUSTOM_POST, AOR_CUSTOM_POST):
        parts.append(path.read_text(encoding="utf-8") if path.exists() else "")
    return hashlib.sha256("\0".join(parts).encode()).hexdigest()


def needs_reload(created: bool, before: str, state: str, applied: str | None) -> bool:
    if created:
        return True
    if applied is None:
        # First run with markers: an unchanged re-sync means the live config
        # already reflects the state an earlier reload applied.
        return state != before
    return applied != state


def main() -> None:
    data = json.load(sys.stdin)
    apply_media_hints_from_request(data)
    ext = str(data.get("ext") or "").strip()
    secret = str(data.get("secret") or "")
    display_name = str(data.get("display_name") or "").strip()[:64] or None
    mode_raw = str(data.get("mode") or "").strip().lower()
    if mode_raw and mode_raw not in ("remote", "lan", "home"):
        print("mode must be remote, lan, or home", file=sys.stderr)
        sys.exit(2)
    if not ext.isdigit() or not (2 <= len(ext) <= 8):
        print("bad ext", file=sys.stderr)
        sys.exit(2)
    if len(secret) < 8:
        print("bad secret", file=sys.stderr)
        sys.exit(2)

    before = managed_state(ext)
    created = ensure_sip_rows(ext, display_name or f"PhoneHome ATA {ext}", secret)
    # Default remote: cousin/public path. Pass mode=lan|home for mothership ATAs
    # (rewrite_contact=yes + FreePBX LAN media_address). Never special-case ext 2001.
    if mode_raw in ("remote", "lan", "home"):
        mode = _normalize_mode(mode_raw)
    else:
        mode = "remote"

    secret_len = set_secret(ext, secret)
    apply_mode_settings(ext, mode, display_name)
    ensure_custom_post(ext, mode)
    ensure_aor_custom_post(ext, mode)

    # PhoneHome re-syncs every line on each server start. A full reload per line
    # crashed Asterisk during Oct 4 deploys and dropped every family's calls, so
    # reload only when this extension's state differs from what was last applied.
    state = managed_state(ext)
    marker = APPLIED_DIR / ext
    applied = marker.read_text(encoding="utf-8").strip() if marker.exists() else None
    reloaded = needs_reload(created, before, state, applied)
    if reloaded:
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
    APPLIED_DIR.mkdir(parents=True, exist_ok=True)
    marker.write_text(state + "\n", encoding="utf-8")
    os.chmod(marker, 0o600)
    media_ip = resolve_public_media_ip() if mode != "lan" else None
    print(
        json.dumps(
            {
                "ok": True,
                "ext": ext,
                "created": created,
                "reloaded": reloaded,
                "mode": mode,
                "media_address": media_ip,
                "secret_sha256": hashlib.sha256(secret.encode()).hexdigest()[:16],
                "secret_len": secret_len,
            }
        )
    )


if __name__ == "__main__":
    main()
