/**
 * Host network setup (DuckDNS / PUBLIC_BASE_URL) for Mothership onboarding.
 * Writes DATA_DIR/phonehome.env — same keys as macOS Preferences / deploy/duckdns.mjs.
 * Never logs DuckDNS tokens.
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_HTTPS_PORT = "8443";
const DUCKDNS_UPDATE = "https://www.duckdns.org/update";

export type HostNetworkConfig = {
  publicBaseUrl: string;
  duckDnsDomain: string;
  duckDnsHttpsPort: string;
  hasDuckDnsToken: boolean;
  sipPublicHost: string;
};

export function envFilePath(dataDir: string): string {
  return path.join(dataDir, "phonehome.env");
}

export function normalizeDuckDnsDomain(raw: string): string {
  let d = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  if (d.endsWith(".duckdns.org")) d = d.slice(0, -".duckdns.org".length);
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(d)) return "";
  return d;
}

export function normalizeDuckDnsToken(token: string): string {
  return String(token || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

export function duckDnsPublicOrigin(domain: string, httpsPort?: string): string | null {
  const d = normalizeDuckDnsDomain(domain);
  if (!d) return null;
  const port = String(httpsPort || DEFAULT_HTTPS_PORT).trim() || DEFAULT_HTTPS_PORT;
  const host = `${d}.duckdns.org`;
  return port === "443" ? `https://${host}` : `https://${host}:${port}`;
}

/** Parse KEY=value lines (no export, basic quotes). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function upsertEnvLines(existing: string, updates: Record<string, string>): string {
  const lines = existing
    ? existing.split("\n").map((l) => l.replace(/\r$/, ""))
    : [];
  // Drop trailing empty line so we re-add a single newline at the end.
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const [key, value] of Object.entries(updates)) {
    const prefix = `${key}=`;
    const idx = lines.findIndex((l) => l.startsWith(prefix) || l.startsWith(`${key} =`));
    const line = `${prefix}${value}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  return lines.join("\n") + "\n";
}

export function readHostNetworkConfig(dataDir: string): HostNetworkConfig {
  const file = envFilePath(dataDir);
  let fromFile: Record<string, string> = {};
  try {
    if (fs.existsSync(file)) fromFile = parseEnvFile(fs.readFileSync(file, "utf8"));
  } catch {
    /* ignore */
  }
  const pick = (key: string) =>
    (fromFile[key] ?? process.env[key] ?? "").toString().trim();
  const token = normalizeDuckDnsToken(pick("DUCKDNS_TOKEN"));
  return {
    publicBaseUrl: pick("PUBLIC_BASE_URL").replace(/\/$/, ""),
    duckDnsDomain: normalizeDuckDnsDomain(pick("DUCKDNS_DOMAIN")),
    duckDnsHttpsPort: pick("DUCKDNS_HTTPS_PORT") || DEFAULT_HTTPS_PORT,
    hasDuckDnsToken: Boolean(token),
    sipPublicHost: pick("SIP_PUBLIC_HOST"),
  };
}

export async function updateDuckDns(opts: {
  domain: string;
  token: string;
}): Promise<{ ok: boolean; body: string }> {
  const domain = normalizeDuckDnsDomain(opts.domain);
  const token = normalizeDuckDnsToken(opts.token);
  if (!domain || !token) return { ok: false, body: "missing domain or token" };
  const params = new URLSearchParams({
    domains: domain,
    token,
    ip: "",
    verbose: "true",
  });
  try {
    const res = await fetch(`${DUCKDNS_UPDATE}?${params}`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.text()).trim();
    return { ok: res.ok && /^OK\b/i.test(body), body };
  } catch (e) {
    return { ok: false, body: e instanceof Error ? e.message : "network error" };
  }
}

export type ApplyHostNetworkInput = {
  publicBaseUrl?: string;
  duckDnsDomain?: string;
  duckDnsToken?: string;
  duckDnsHttpsPort?: string;
  /** When true, call DuckDNS update API before saving (requires token). */
  testDuckDns?: boolean;
};

export type ApplyHostNetworkResult = {
  ok: boolean;
  error?: string;
  duckDnsStatus?: string;
  config: HostNetworkConfig;
  /** True when phonehome.env was written. */
  saved: boolean;
};

/**
 * Persist network settings, optionally testing DuckDNS first.
 * Updates process.env so invite links pick up PUBLIC_BASE_URL without a full restart.
 */
export async function applyHostNetwork(
  dataDir: string,
  input: ApplyHostNetworkInput
): Promise<ApplyHostNetworkResult> {
  const current = readHostNetworkConfig(dataDir);
  let domain = normalizeDuckDnsDomain(
    input.duckDnsDomain !== undefined ? input.duckDnsDomain : current.duckDnsDomain
  );
  let port = String(
    input.duckDnsHttpsPort !== undefined ? input.duckDnsHttpsPort : current.duckDnsHttpsPort
  )
    .trim()
    .replace(/[^\d]/g, "");
  if (!port) port = DEFAULT_HTTPS_PORT;

  let token = "";
  if (input.duckDnsToken !== undefined && String(input.duckDnsToken).trim() !== "") {
    token = normalizeDuckDnsToken(input.duckDnsToken);
  } else {
    // Keep existing token from file when client omits it (masked field).
    try {
      const parsed = parseEnvFile(fs.readFileSync(envFilePath(dataDir), "utf8"));
      token = normalizeDuckDnsToken(parsed.DUCKDNS_TOKEN || "");
    } catch {
      token = normalizeDuckDnsToken(process.env.DUCKDNS_TOKEN || "");
    }
  }

  let publicBaseUrl = String(
    input.publicBaseUrl !== undefined ? input.publicBaseUrl : current.publicBaseUrl
  )
    .trim()
    .replace(/\/$/, "");

  let duckDnsStatus: string | undefined;

  if (input.testDuckDns) {
    if (!domain) {
      return {
        ok: false,
        error: "Enter a DuckDNS subdomain.",
        config: current,
        saved: false,
      };
    }
    if (!token) {
      return {
        ok: false,
        error: "Paste your DuckDNS token from duckdns.org.",
        config: current,
        saved: false,
      };
    }
    const upd = await updateDuckDns({ domain, token });
    if (!upd.ok) {
      return {
        ok: false,
        error: `DuckDNS said no — check subdomain + token.`,
        duckDnsStatus: upd.body.slice(0, 80),
        config: current,
        saved: false,
      };
    }
    const origin = duckDnsPublicOrigin(domain, port);
    if (origin) publicBaseUrl = origin;
    duckDnsStatus = `OK — ${domain}.duckdns.org updated. Forward HTTPS port ${port} to this host.`;
  } else if (domain && !publicBaseUrl) {
    const origin = duckDnsPublicOrigin(domain, port);
    if (origin) publicBaseUrl = origin;
  }

  if (publicBaseUrl && !/^https:\/\//i.test(publicBaseUrl)) {
    return {
      ok: false,
      error: "App URL must be https://…",
      config: current,
      saved: false,
    };
  }

  let sipHost = "";
  if (domain) sipHost = `${domain}.duckdns.org`;
  else {
    try {
      sipHost = publicBaseUrl ? new URL(publicBaseUrl).hostname : "";
    } catch {
      sipHost = "";
    }
  }

  const updates: Record<string, string> = {
    PUBLIC_BASE_URL: publicBaseUrl,
    DUCKDNS_DOMAIN: domain,
    DUCKDNS_HTTPS_PORT: port,
  };
  if (token) updates.DUCKDNS_TOKEN = token;
  if (sipHost) updates.SIP_PUBLIC_HOST = sipHost;

  fs.mkdirSync(dataDir, { recursive: true });
  const file = envFilePath(dataDir);
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    existing = "";
  }
  const next = upsertEnvLines(existing, updates);
  fs.writeFileSync(file, next, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }

  process.env.PUBLIC_BASE_URL = publicBaseUrl;
  process.env.DUCKDNS_DOMAIN = domain;
  process.env.DUCKDNS_HTTPS_PORT = port;
  if (token) process.env.DUCKDNS_TOKEN = token;
  if (sipHost) process.env.SIP_PUBLIC_HOST = sipHost;

  const config = readHostNetworkConfig(dataDir);
  return { ok: true, duckDnsStatus, config, saved: true };
}
