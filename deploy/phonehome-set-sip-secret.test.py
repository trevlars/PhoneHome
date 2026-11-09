#!/usr/bin/env python3
"""Unit tests for phonehome-set-sip-secret parse/normalize (no FreePBX required)."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "phonehome_set_sip_secret", ROOT / "phonehome-set-sip-secret.py"
)
assert SPEC and SPEC.loader
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class ParseManagedModesTest(unittest.TestCase):
    def test_labels_win_over_rewrite_yes(self) -> None:
        text = """
; PhoneHome ATA 2001 (home)
[2001](+)
rewrite_contact=yes
direct_media=no

; PhoneHome ATA 2003 (remote)
[2003](+)
rewrite_contact=yes
media_address=50.36.49.13
"""
        self.assertEqual(
            MOD._parse_managed_modes(text),
            {"2001": "lan", "2003": "remote"},
        )

    def test_home_alias_label(self) -> None:
        text = "; PhoneHome ATA 2001 (lan)\n[2001](+)\nrewrite_contact=yes\n"
        self.assertEqual(MOD._parse_managed_modes(text), {"2001": "lan"})

    def test_rewrite_yes_without_media_is_home_not_remote(self) -> None:
        """Regression: old parser treated rewrite=yes as remote → softphone break."""
        text = """
[2001](+)
rewrite_contact=yes
direct_media=no

[2003](+)
rewrite_contact=yes
media_address=1.2.3.4
"""
        self.assertEqual(
            MOD._parse_managed_modes(text),
            {"2001": "lan", "2003": "remote"},
        )

    def test_legacy_rewrite_no_is_lan(self) -> None:
        text = "[2001](+)\nrewrite_contact=no\n"
        self.assertEqual(MOD._parse_managed_modes(text), {"2001": "lan"})

    def test_aor_comments_do_not_override_endpoint(self) -> None:
        text = """
; PhoneHome ATA 2001 (home)
[2001](+)
rewrite_contact=yes

; PhoneHome ATA 2001 AOR (home)
[2001](+type=aor)
remove_unavailable=yes
"""
        self.assertEqual(MOD._parse_managed_modes(text), {"2001": "lan"})

    def test_normalize_home_alias(self) -> None:
        self.assertEqual(MOD._normalize_mode("home"), "lan")
        self.assertEqual(MOD._normalize_mode("lan"), "lan")
        self.assertEqual(MOD._normalize_mode("remote"), "remote")

    def test_ata_block_home_uses_lan_media_address(self) -> None:
        block = MOD._ata_block("2001", "lan", "192.168.2.105")
        self.assertIn("; PhoneHome ATA 2001 (home)", block)
        self.assertIn("rewrite_contact=yes", block)
        self.assertIn("media_address=192.168.2.105", block)
        self.assertIn("bind_rtp_to_media_address=yes", block)

    def test_ata_block_remote_includes_media(self) -> None:
        block = MOD._ata_block("2003", "remote", "50.36.49.13")
        self.assertIn("; PhoneHome ATA 2003 (remote)", block)
        self.assertIn("media_address=50.36.49.13", block)
        self.assertIn("rewrite_contact=yes", block)

    def test_private_media_address_without_label_is_home(self) -> None:
        """Home now pins LAN media_address — must not re-tag as remote."""
        text = """
[2001](+)
rewrite_contact=yes
media_address=192.168.2.105

[2003](+)
rewrite_contact=yes
media_address=50.36.49.13
"""
        self.assertEqual(
            MOD._parse_managed_modes(text),
            {"2001": "lan", "2003": "remote"},
        )

    def test_is_private_ipv4(self) -> None:
        self.assertTrue(MOD._is_private_ipv4("192.168.2.105"))
        self.assertTrue(MOD._is_private_ipv4("192.168.1.1"))
        self.assertFalse(MOD._is_private_ipv4("50.36.49.13"))

    def test_audit_remote_media_rejects_lan_hairpin(self) -> None:
        text = """
; PhoneHome ATA 2001 (home)
[2001](+)
media_address=192.168.2.105

; PhoneHome ATA 2002 (remote)
[2002](+)
media_address=192.168.2.31

; PhoneHome ATA 2003 (remote)
[2003](+)
media_address=50.36.49.13

; PhoneHome ATA 2004 (remote)
[2004](+)
rewrite_contact=yes
"""
        ok, bad = MOD.audit_remote_media(text)
        self.assertEqual(ok, ["2003=50.36.49.13"])
        self.assertEqual(bad, ["2002=192.168.2.31", "2004=(missing)"])

    def test_apply_media_hints_drops_private_ip(self) -> None:
        import os

        prev_ip = os.environ.get("PHONEHOME_PUBLIC_MEDIA_IP")
        prev_host = os.environ.get("SIP_PUBLIC_HOST")
        os.environ.pop("PHONEHOME_PUBLIC_MEDIA_IP", None)
        try:
            MOD.apply_media_hints_from_request(
                {"media_address": "192.168.2.31", "sip_public_host": "sip.example.com"}
            )
            self.assertNotIn("PHONEHOME_PUBLIC_MEDIA_IP", os.environ)
            self.assertEqual(os.environ.get("SIP_PUBLIC_HOST"), "sip.example.com")
        finally:
            if prev_ip is None:
                os.environ.pop("PHONEHOME_PUBLIC_MEDIA_IP", None)
            else:
                os.environ["PHONEHOME_PUBLIC_MEDIA_IP"] = prev_ip
            if prev_host is None:
                os.environ.pop("SIP_PUBLIC_HOST", None)
            else:
                os.environ["SIP_PUBLIC_HOST"] = prev_host

    def test_private_forced_media_ip_uses_public_resolver(self) -> None:
        """Hub hairpin DNS posts 192.168.2.31; remote SDP must stay the public A."""
        import os

        prev_ip = os.environ.get("PHONEHOME_PUBLIC_MEDIA_IP")
        prev_host = os.environ.get("PHONEHOME_SIP_PUBLIC_HOST")
        prev_sip = os.environ.get("SIP_PUBLIC_HOST")
        os.environ["PHONEHOME_PUBLIC_MEDIA_IP"] = "192.168.2.31"
        os.environ["PHONEHOME_SIP_PUBLIC_HOST"] = "mothership.example"
        os.environ.pop("SIP_PUBLIC_HOST", None)
        orig_dns = MOD._dns_a
        orig_pub = MOD._public_a_record
        calls = {"pub": 0}

        def fake_dns(_host: str) -> str:
            return "192.168.2.31"

        def fake_pub(_host: str) -> str:
            calls["pub"] += 1
            return "50.36.49.13"

        MOD._dns_a = fake_dns
        MOD._public_a_record = fake_pub
        try:
            self.assertEqual(MOD.resolve_public_media_ip(), "50.36.49.13")
            self.assertEqual(calls["pub"], 1)
        finally:
            MOD._dns_a = orig_dns
            MOD._public_a_record = orig_pub
            if prev_ip is None:
                os.environ.pop("PHONEHOME_PUBLIC_MEDIA_IP", None)
            else:
                os.environ["PHONEHOME_PUBLIC_MEDIA_IP"] = prev_ip
            if prev_host is None:
                os.environ.pop("PHONEHOME_SIP_PUBLIC_HOST", None)
            else:
                os.environ["PHONEHOME_SIP_PUBLIC_HOST"] = prev_host
            if prev_sip is None:
                os.environ.pop("SIP_PUBLIC_HOST", None)
            else:
                os.environ["SIP_PUBLIC_HOST"] = prev_sip

    def test_aor_home_is_proxy_safe(self) -> None:
        block = MOD._aor_block("2001", "lan")
        self.assertIn("remove_unavailable=yes", block)
        self.assertIn("qualify_timeout=8.0", block)
        self.assertIn("AOR (home)", block)


class NeedsReloadTest(unittest.TestCase):
    """Server start re-syncs every line; a no-op re-sync must not reload FreePBX."""

    def test_new_extension_reloads(self) -> None:
        self.assertTrue(MOD.needs_reload(True, "a", "a", "a"))

    def test_unchanged_resync_does_not_reload(self) -> None:
        self.assertFalse(MOD.needs_reload(False, "a", "a", "a"))

    def test_first_run_without_marker_trusts_unchanged_state(self) -> None:
        self.assertFalse(MOD.needs_reload(False, "a", "a", None))

    def test_first_run_without_marker_reloads_a_change(self) -> None:
        self.assertTrue(MOD.needs_reload(False, "a", "b", None))

    def test_changed_state_reloads(self) -> None:
        self.assertTrue(MOD.needs_reload(False, "a", "b", "a"))

    def test_unfinished_earlier_reload_is_retried(self) -> None:
        self.assertTrue(MOD.needs_reload(False, "b", "b", "a"))


if __name__ == "__main__":
    unittest.main()
