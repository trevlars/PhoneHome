/**
 * Fanvil G100S (and similar G-series ATA) config generator.
 * Format: `<<VOIP CONFIG FILE>>` text that Import config / Auto Provision accepts.
 * @see Fanvil Auto Provision Directions — 64-char header, module blocks, <<END OF FILE>>
 */

export type G100sConfigInput = {
  sipServer: string;
  sipUserId: string;
  sipAuthId?: string;
  sipPassword: string;
  displayName?: string;
  localSipPort?: number;
  /** Full URL the ATA should keep polling, e.g. https://host:8443/provision/<token> */
  provisionUrl?: string | null;
};

/** Fanvil requires a 64-character header line. */
export function fanvilConfigHeader(version = "2.0002"): string {
  const raw = `<<VOIP CONFIG FILE>>Version:${version}`;
  if (raw.length === 64) return raw;
  if (raw.length > 64) return raw.slice(0, 64);
  return raw + " ".repeat(64 - raw.length);
}

function line(key: string, value: string | number): string {
  return `${key}    :${value}`;
}

/**
 * Build a Fanvil `.txt` / `.cfg` the G100S can import
 * (System → Backup/Flash Firmware → Import config).
 */
export function buildG100sConfigTxt(input: G100sConfigInput): string {
  const authId = (input.sipAuthId || input.sipUserId).trim();
  const user = input.sipUserId.trim();
  const server = input.sipServer.trim();
  const display = (input.displayName || "Analog Phone").trim() || "Analog Phone";
  const port = input.localSipPort && input.localSipPort > 0 ? input.localSipPort : 5060;

  const rows: string[] = [
    fanvilConfigHeader(),
    ``,
    `<SIP CONFIG MODULE>`,
    line("SIP1 Enable Reg", 1),
    line("SIP1 Phone Number", user),
    line("SIP1 Display Name", display),
    line("SIP1 Sip Name", user),
    line("SIP1 Register Addr", server),
    line("SIP1 Register Port", 5060),
    line("SIP1 Register User", authId),
    line("SIP1 Register Pswd", input.sipPassword),
    line("SIP1 Register TTL", 3600),
    line("SIP1 Proxy Addr", server),
    line("SIP1 Proxy Port", 5060),
    line("SIP1 Local Domain", server),
    line("SIP1 Sip Port", port),
    line("SIP1 Transport Protocol", 0), // UDP
    line("SIP1 Enable", 1),
    ``,
  ];

  if (input.provisionUrl) {
    const url = input.provisionUrl.replace(/\/$/, "");
    rows.push(`<AUTOUPDATE CONFIG MODULE>`);
    rows.push(line("Download Server", url));
    rows.push(line("Auto Upgrade Server Address", url));
    rows.push(line("Auto Upgrade Protocol", url.startsWith("https:") ? 3 : 2)); // 2=HTTP 3=HTTPS (Fanvil)
    rows.push(line("Auto Upgrade Cfg Interval", 10080));
    rows.push(line("Auto Upgrade Mode", 1));
    rows.push(``);
  }

  rows.push(`<<END OF FILE>>`);
  rows.push(``);
  return rows.join("\r\n");
}

/** Full URL G100S Auto Provision should poll (includes scheme). */
export function formatFanvilProvisionUrl(baseUrl: string, provisionToken: string): string {
  const raw = baseUrl.trim().replace(/\/$/, "");
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const pathBase = u.pathname.replace(/\/$/, "");
    return `${u.origin}${pathBase}/provision/${provisionToken}`;
  } catch {
    return `${raw.replace(/\/$/, "")}/provision/${provisionToken}`;
  }
}
