/**
 * Grandstream HT801 XML config generator (P-value schema).
 * Field map from HT8xx admin UI / SIP Device Provisioning Guide.
 *
 * Privacy pillar (`docs/privacy-security.md`): public analog paths MUST use
 * SIP TLS + SRTP. Do not add a cleartext UDP SIP / plain RTP provision mode
 * for production parents.
 */

export type Ht801ConfigInput = {
  /** Optional; when set, device rejects config if MAC mismatches */
  mac?: string | null;
  sipServer: string;
  sipUserId: string;
  sipAuthId?: string;
  sipPassword: string;
  displayName?: string;
  accountName?: string;
  /** Local SIP port (default 5060) */
  localSipPort?: number;
  /**
   * Optional Config Server Path the ATA should keep using (no scheme),
   * e.g. `y5876647.eero.online:8443/provision/<token>`
   */
  configServerPath?: string | null;
  /** 0=TFTP 1=HTTP 2=HTTPS — set when configServerPath is present */
  upgradeVia?: 0 | 1 | 2;
  /**
   * Web UI admin password (Grandstream P2). Set when push-provisioning so the
   * box password matches what the parent chose (letters/digits only).
   */
  adminPassword?: string | null;
  /**
   * Override P8463 (Validate Server Certificates). When omitted, enabled for
   * DNS hostnames (public CA / Let's Encrypt) and disabled for raw IPs.
   */
  validateServerCert?: boolean;
};

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function p(tag: string, value: string | number): string {
  return `  <${tag}>${escapeXml(String(value))}</${tag}>`;
}

/** SIP TLS listen port on FreePBX (see bridged/freepbx/pjsip.transports_custom.conf). */
export const HT801_SIP_TLS_PORT = 5061;

/**
 * Ensure the SIP server host includes a port. TLS defaults to 5061 when omitted.
 * Leaves IPv6 literals and already-ported hosts alone.
 */
export function formatSipServerForTls(host: string, tlsPort = HT801_SIP_TLS_PORT): string {
  const h = host.trim();
  if (!h) return h;
  if (h.startsWith("[")) return h; // [ipv6] or [ipv6]:port
  if (/:\d+$/.test(h)) return h;
  return `${h}:${tlsPort}`;
}

/** Host part of `host`, `host:port`, or `[ipv6]:port` (no brackets stripped for IPv6 check). */
export function sipServerHostname(sipServer: string): string {
  const h = sipServer.trim();
  if (!h) return h;
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end >= 0 ? h.slice(1, end) : h;
  }
  // hostname or IPv4, optional :port
  return h.replace(/:\d+$/, "");
}

/**
 * Whether HT801 should validate the FreePBX TLS cert (P8463).
 * DNS names expect a public CA (Let's Encrypt) matching the SAN.
 * Raw IPs stay off — LE does not issue IP certs; lab LAN IP is known debt.
 * Override with SIP_TLS_VALIDATE_CERT=0|1|true|false.
 */
export function shouldValidateSipServerCert(sipServer: string): boolean {
  const env = (process.env.SIP_TLS_VALIDATE_CERT || "").trim().toLowerCase();
  if (env === "0" || env === "false" || env === "no" || env === "off") return false;
  if (env === "1" || env === "true" || env === "yes" || env === "on") return true;

  const host = sipServerHostname(sipServer);
  if (!host) return false;
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  // IPv6
  if (host.includes(":")) return false;
  return true;
}

/** Normalize MAC to 12 lowercase hex digits, or null. */
export function normalizeMac(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hex = String(raw).replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length !== 12) return null;
  return hex;
}

export type AtaModelName = "ht801" | "g100s";

export function normalizeAtaModel(raw: string | null | undefined): AtaModelName {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "g100s" || v === "fanvil" || v === "fanvil-g100s") return "g100s";
  return "ht801";
}

/** Config Server Path value parents paste into HT801 (no scheme). */
export function formatConfigServerPath(baseUrl: string, provisionToken: string): string {
  const raw = baseUrl.trim().replace(/\/$/, "");
  let hostPath: string;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const pathBase = u.pathname.replace(/\/$/, "");
    hostPath = `${u.host}${pathBase}/provision/${provisionToken}`;
  } catch {
    hostPath = `${raw.replace(/^https?:\/\//i, "")}/provision/${provisionToken}`;
  }
  return hostPath.replace(/([^:]\/)\/+/g, "$1");
}

/**
 * Build Grandstream `gs_provision` XML accepted by HT801
 * (Maintenance → Upload Configuration, or HTTP provisioning cfg{mac}.xml).
 */
export function buildHt801ConfigXml(input: Ht801ConfigInput): string {
  const mac = normalizeMac(input.mac || null);
  const authId = (input.sipAuthId || input.sipUserId).trim();
  const display = (input.displayName || input.accountName || "Analog Phone").trim() || "Analog Phone";
  const account = (input.accountName || display).trim() || "PhoneHome";
  // Local bind; remote TLS port is on the SIP server host (:5061).
  const port = input.localSipPort && input.localSipPort > 0 ? input.localSipPort : 5060;
  const sipServer = formatSipServerForTls(input.sipServer);

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gs_provision version="1">`,
  ];
  if (mac) lines.push(`  <mac>${mac}</mac>`);
  lines.push(`  <config version="1">`);
  // Web admin password (optional — used by one-tap LAN push)
  if (input.adminPassword) {
    lines.push(p("P2", input.adminPassword));
  }
  // Account 1 — SIP over TLS + SRTP (matches FreePBX 0.0.0.0-tls + media_encryption=sdes)
  lines.push(p("P271", 1)); // Account Active: Yes
  lines.push(p("P270", account)); // Account Name
  lines.push(p("P47", sipServer)); // Primary SIP Server (host:5061)
  lines.push(p("P35", input.sipUserId.trim())); // SIP User ID
  lines.push(p("P36", authId)); // Authenticate ID
  lines.push(p("P34", input.sipPassword)); // Authenticate Password
  lines.push(p("P3", display)); // Display Name
  lines.push(p("P40", port)); // Local SIP Port
  // HT8xx V2 defaults Use Random SIP Port = Yes (P20501), which registers a
  // ephemeral Contact (e.g. :53622). FreePBX then cannot re-INVITE after the
  // TLS session drops (Unavail / Allocation failed). Pin to Local SIP Port.
  lines.push(p("P20501", 0)); // Use Random SIP Port: No
  lines.push(p("P52", 2)); // NAT Traversal: Keep-Alive (remote / public SIP)
  lines.push(p("P130", 2)); // SIP Transport: TLS
  lines.push(p("P2329", 0)); // SIP URI Scheme When Using TLS: sip (not sips)
  // Preferred vocoder: PCMU (0) then PCMA (8) — G.711 for FreePBX / bridge
  lines.push(p("P57", "0,8,18,9,2,4"));
  lines.push(p("P4363", 1)); // Use First Matching Vocoder in 200OK SDP: Yes
  lines.push(p("P183", 2)); // SRTP Mode: Enabled and forced (SDES)
  lines.push(p("P2383", 0)); // SRTP key length: AES 128 & 256
  const validate =
    typeof input.validateServerCert === "boolean"
      ? input.validateServerCert
      : shouldValidateSipServerCert(sipServer);
  // P8463: Validate Server Certificates (1=Yes). On for public-CA FQDNs; off for LAN IPs.
  lines.push(p("P8463", validate ? 1 : 0));
  lines.push(p("P81", 0)); // Unregister On Reboot: No
  // Register Expiration, in minutes. Grandstream defaults to 60, which means a
  // FreePBX/Asterisk restart drops the contact and the ATA does not notice for
  // up to an hour — the line looks dead until someone power-cycles it. Keep this
  // above the AOR's minimum_expiration (60s) and well under maximum_expiration.
  lines.push(p("P32", 3));
  lines.push(p("P4567", 0)); // Allow Incoming SIP from Proxy Only — No (lab)
  // E911 / emergency dialing (Advanced → E911/HELD). Numbers must never be empty
  // (empty P8597 can crash some HT8xx firmware). Real PSAP still needs a SIP trunk;
  // PhoneHome maps 911 → household parent until Stage 3 PSTN.
  lines.push(p("P8565", 1)); // Enable E911: Yes
  lines.push(p("P8597", "911;933")); // Emergency numbers (933 = test / many VoIP providers)
  lines.push(p("P8599", 1)); // Priority Header: emergency
  // Dial plan: speed-dial 0–9 + emergency + *98 / bare * Messages (*x+ keeps *0–*9).
  // Bare `*` alone was missing — HT801 never INVITEd FreePBX for softphone-parity Messages.
  lines.push(p("P90", "{ [0-9] | 911 | 933 | *98 | * | *x+ | *xx*x+ }"));

  if (input.configServerPath) {
    const via = input.upgradeVia ?? 2;
    lines.push(p("P212", via)); // Firmware Upgrade / Config Via (HTTPS)
    lines.push(p("P237", input.configServerPath.replace(/^https?:\/\//i, "").replace(/\/$/, "")));
    // Leave Firmware Server Path empty on purpose — PhoneHome is config-only.
    // HT801 Status → Provision then shows "Firmware server is not configured"
    // (benign; does not block Config Server Path or SIP). Do not point P192 at
    // fm.grandstream.com unless we intentionally want GS firmware OTA.
    lines.push(p("P192", ""));
    lines.push(p("P238", 0));
    lines.push(p("P194", 1)); // Always Check for New Firmware / config
    lines.push(p("P193", 10080)); // check weekly (minutes)
  }

  lines.push(`  </config>`);
  lines.push(`</gs_provision>`);
  lines.push(``);
  return lines.join("\n");
}
