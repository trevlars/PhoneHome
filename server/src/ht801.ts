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
   * e.g. `mothership.example:8443/provision/<token>`
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
 *
 * Written for HT801 **v2** so both **1.0.9.3** and **1.0.11.4** REGISTER with
 * SIP TLS + SRTP. Dual-write gen1 + v2 slots where the meaning is the same
 * (`P90`/`P4200` dial plan). Do not invent remaps — several numbers changed
 * meaning: `P63` is Tel URI (not random SIP port), `P79` is DTMF payload
 * (we pin 101 for RFC2833), `P4000` is dial *tone* (not dial plan), `P4567`
 * is Prefer Primary SIP Server (not “proxy only”), `P26062` is RFC2543 Hold
 * (not Enable Call Features — that is `P191`). In-call hold primary is `#`
 * via `P850`/`P4825` RFC2833; Flash/`P191` is secondary for pulse-only sets.
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
  lines.push(p("P271", 1)); // Account Active: Yes (1.0.9.3 factory default became No)
  lines.push(p("P31", 1)); // SIP Registration: Yes (separate from Account Active)
  lines.push(p("P270", account)); // Account Name
  lines.push(p("P47", sipServer)); // Primary SIP Server (host:5061)
  lines.push(p("P35", input.sipUserId.trim())); // SIP User ID
  lines.push(p("P36", authId)); // Authenticate ID
  lines.push(p("P34", input.sipPassword)); // Authenticate Password
  lines.push(p("P3", display)); // Display Name
  lines.push(p("P40", port)); // Local SIP Port
  // HT8xx V2 defaults Use Random SIP Port = Yes (P20501; 1.0.9.3+), which
  // registers an ephemeral Contact (e.g. :53622). FreePBX then cannot re-INVITE
  // after the TLS session drops (Unavail / Allocation failed). Pin to Local SIP
  // Port. Do not write P63 — on HT8xx that is Tel URI, not this toggle.
  lines.push(p("P20501", 0)); // Use Random SIP Port: No
  // Pulse dialing must stay ON: Alex’s FXS handset is pulse (clicks, not DTMF).
  // Factory default / accidental 0 silently black-holes outbound (dialtone, no INVITE).
  // Tone phones still send DTMF while pulse is enabled. In-call hold is `#`
  // (RFC2833 → bridged); Flash remains a secondary path for pulse-only handsets.
  lines.push(p("P20521", 1)); // Enable Pulse Dialing: Yes (required for pulse handsets)
  // Preferred DTMF: RFC2833 first so in-call `#` reaches Asterisk as ChannelDtmfReceived
  // (in-audio alone is swallowed by the ExternalMedia bridge). 100=in-audio, 101=RFC2833,
  // 102=SIP INFO. Same P-values on HT801 1.0.9 / 1.0.11 / HT80x V2 templates.
  lines.push(p("P850", 101));
  lines.push(p("P851", 102));
  lines.push(p("P852", 100));
  lines.push(p("P79", 101)); // DTMF Payload Type (RFC2833)
  // Force the order above — do not let SDP renegotiate us onto in-audio-only.
  // HT8xx: P4825 0=negotiate, 1=use preferred order without negotiation.
  lines.push(p("P4825", 1));
  // Grandstream only honors "Disable # as Redial" when "Use # as Dial Key"
  // remains enabled. P72=0 falls back to the built-in idle redial behavior.
  // Keep the dependency on and explicitly disable redial with P28147=1.
  // During an established call the ATA should still emit # as DTMF.
  // Enable # as Redial Key: 0=Yes, 1=No.
  lines.push(p("P72", 1));
  lines.push(p("P28147", 1));
  lines.push(p("P52", 2)); // NAT Traversal: Keep-Alive (remote / public SIP)
  // Blank UDP keep-alive interval (seconds) while NAT Traversal = Keep-Alive.
  lines.push(p("P84", 20));
  lines.push(p("P130", 2)); // SIP Transport: TLS
  // 1.0.9 and 1.0.11: 0=sip, 1=sips. Factory can be sips; FreePBX wants sip.
  lines.push(p("P2329", 0)); // SIP URI Scheme When Using TLS: sip (not sips)
  // Preferred vocoder: PCMU (0) then PCMA (8) — G.711 for FreePBX / bridge
  lines.push(p("P57", "0,8,18,9,2,4"));
  lines.push(p("P4363", 1)); // Use First Matching Vocoder in 200OK SDP: Yes
  lines.push(p("P183", 2)); // SRTP Mode: Enabled and forced (SDES)
  lines.push(p("P2383", 0)); // SRTP key length: AES 128 & 256 (ignored if unknown)
  // Silence Suppression / VAD: OFF. Force continuous RTP so the caller always
  // hears the room instead of dead air during quiet moments, and so the
  // Asterisk WebSocket ExternalMedia path never receives comfort-noise (CNG)
  // frames — chan_websocket silently drops CNG, which would clip the far end.
  lines.push(p("P50", 0)); // VAD (FXS 1): No — always transmit audio
  const validate =
    typeof input.validateServerCert === "boolean"
      ? input.validateServerCert
      : shouldValidateSipServerCert(sipServer);
  // Global TLS + SIP-account cert checks. P8463 is Validate Server Certificates
  // (provision / TLS). P2311 / P2367 are the 1.0.9-era SIP TLS domain + chain
  // flags — dual-write so 1.0.9 actually checks the Let’s Encrypt leaf.
  lines.push(p("P8463", validate ? 1 : 0));
  lines.push(p("P2311", validate ? 1 : 0)); // Authenticate server certificate domain
  lines.push(p("P2367", validate ? 1 : 0)); // Authenticate server certificate chain
  // Factory clocks are often 2010. SIP TLS with cert check then fails while
  // HTTPS config pull still works (provision often skips cert checks). Pin NTP
  // and do not let DHCP Option 42 replace it with a missing/broken server.
  lines.push(p("P30", "pool.ntp.org"));
  lines.push(p("P144", 0)); // Allow DHCP Option 42 to override NTP: No
  lines.push(p("P81", 0)); // Unregister On Reboot: No
  // Do not allow outbound when unregistered — clearer failure than a black hole.
  lines.push(p("P109", 0)); // Outgoing Call without Registration: No
  // Register Expiration, in minutes. Grandstream defaults to 60, which means a
  // FreePBX/Asterisk restart drops the contact and the ATA does not notice for
  // up to an hour — the line looks dead until someone power-cycles it. Keep this
  // at/above the AOR's minimum_expiration (60s) and well under maximum_expiration.
  // Remote ATAs phone home through a TCP TLS proxy; dead Contacts must refresh fast.
  // 1.0.9.3 honors P32 / P138 / P2330 (minutes / seconds / seconds).
  lines.push(p("P32", 1));
  // Re-REGISTER this many seconds before expiration (keeps Contact fresh).
  lines.push(p("P2330", 15));
  // Faster retry when REGISTER fails (seconds).
  lines.push(p("P138", 10));
  // SIP OPTIONS Keep-Alive: when the TLS path via the SIP proxy dies after a
  // call, FreePBX marks the Contact Unavail and Alex→Sam gets "cannot be
  // completed as dialed" until re-REGISTER. OPTIONS detects the dead path and
  // forces re-registration without a power cycle (HT80x Profile 1: 1=OPTIONS).
  // These three exist on 1.0.9-era HT8xx templates (not 1.0.11-only).
  lines.push(p("P2397", 1)); // Enable SIP OPTIONS/NOTIFY Keep Alive: OPTIONS
  lines.push(p("P2398", 15)); // Interval (seconds) — detect dead path quickly
  lines.push(p("P2399", 3)); // Max lost before re-REGISTER
  lines.push(p("P4567", 0)); // Prefer Primary SIP Server: No (no failover host)
  lines.push(p("P243", 0)); // Allow Incoming SIP from Proxy Only: No
  // E911 / emergency dialing (Advanced → E911/HELD). Numbers must never be empty
  // (empty P8597 can crash some HT8xx firmware). Real PSAP still needs a SIP trunk;
  // PhoneHome maps 911 → household parent until Stage 3 PSTN.
  lines.push(p("P8565", 1)); // Enable E911: Yes
  lines.push(p("P8597", "911;933")); // Emergency numbers (933 = test / many VoIP providers)
  lines.push(p("P8599", 1)); // Priority Header: emergency
  // Dial plan: speed-dial 0–9 + emergency + *98 / bare * Messages (*x+ keeps *0–*9).
  // Bare `*` alone was missing — HT801 never INVITEd FreePBX for softphone-parity Messages.
  // HT801 (gen1) uses P90; HT801V2 Port Settings dial plan is P4200 — both must match or
  // V2 keeps the factory `{ x+ | … }` plan (waits for digit timeout, no instant 0–9).
  // Do not write the plan to P4000 — that is the dial-*tone* cadence string.
  const dialPlan = "{ [0-9] | 911 | 933 | *98 | 98 | * | *x+ | *xx*x+ }";
  lines.push(p("P90", dialPlan));
  lines.push(p("P4200", dialPlan));
  // After remote BYE (softphone hangup), drop loop current so the next off-hook
  // gets a clean dialtone + DTMF detect — without this, HT801V2 often keeps
  // dialtone but ignores keypad until power-cycle.
  lines.push(p("P892", 1)); // Loop Current Disconnect: Yes
  // Call Features + Hook Flash: OFF. Enabling these (added 2026-09-26) is what
  // broke Alex's line after "weeks of working." Her handset is PULSE, and a
  // pulse phone's loop-current transients (worn hookswitch, carbon mic) trip a
  // hook-flash mid-call. On the HT8xx a flash with Call Features on = local
  // hold / second-dialtone: the far end goes to dead air with NO SIP re-INVITE
  // (so nothing shows in Asterisk logs). Live evidence matched exactly —
  // clean LAN (0% loss), no SRTP errors, yet the ATA stops sending RTP partway
  // through some calls while others stay two-way. Reliable two-way audio
  // outranks flash-hold on a kids' phone; in-call `#` (P850 RFC2833) is still
  // the hold path for tone handsets. Grandstream P191: 0=No, 1=Yes, 2=All.
  lines.push(p("P191", 0)); // Enable Call Features: No (no flash-triggered hold)
  lines.push(p("P4424", 0)); // Enable Hook Flash: No (pulse handset false triggers)
  // RFC2543 Hold (FXS 1): MUST stay No. Yes sends c=0.0.0.0 and breaks SRTP
  // hold/resume (P183=2). RFC3261 hold (a=sendonly) is the Grandstream path
  // that used to work. A prior provisioner bug set this to 1 (misread as
  // Enable Call Features). 1.0.9 ignores the key if unknown (factory is No).
  lines.push(p("P26062", 0));
  // 1.0.11-era FXS tone-before-disconnect; 1.0.9 ignores unknown P-values.
  lines.push(p("P21925", 1));

  if (input.configServerPath) {
    const via = input.upgradeVia ?? 2;
    lines.push(p("P212", via)); // Firmware Upgrade / Config Via (HTTPS)
    lines.push(p("P237", input.configServerPath.replace(/^https?:\/\//i, "").replace(/\/$/, "")));
    // Keep the PhoneHome config URL authoritative and let the ATA refresh it
    // without another manual upload. P193 is only the interval; HT8xx also
    // requires P22296=1 or periodic checks remain disabled.
    lines.push(p("P145", 0)); // DHCP must not replace Config Server Path
    lines.push(p("P1414", 1)); // Auto Provision: Yes
    lines.push(p("P22296", 1)); // Automatic Upgrade: periodic
    lines.push(p("P4428", 0)); // Authenticate SIP check-sync NOTIFY
    // Leave Firmware Server Path empty on purpose — PhoneHome is config-only.
    // HT801 Status → Provision then shows "Firmware server is not configured"
    // (benign; does not block Config Server Path or SIP). Do not point P192 at
    // fm.grandstream.com unless we intentionally want GS firmware OTA.
    lines.push(p("P192", ""));
    lines.push(p("P238", 0));
    // Firmware check mode is independent from config refresh; P238=0 keeps the
    // normal boot-time check while the empty firmware path prevents firmware OTA.
    // Polling is the fallback; deployments also send authenticated check-sync.
    lines.push(p("P193", 30));
  }

  lines.push(`  </config>`);
  lines.push(`</gs_provision>`);
  lines.push(``);
  return lines.join("\n");
}
