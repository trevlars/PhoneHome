/**
 * Keep FreePBX's sip.secret (and PJSIP endpoint) in lockstep with PhoneHome ATA rows.
 *
 * Remote parents only have Download config → upload on the adapter. If FreePBX
 * still holds an older secret — or the extension was never created — REGISTER
 * fails. Call `syncAtaSipSecretToFreepbx` on Save and again before Download/push.
 *
 * Automagic media: the hub resolves SIP_PUBLIC_HOST / PUBLIC_BASE_URL to a public
 * IPv4 and sends `media_address` in the sync POST. FreePBX does not need manual
 * PHONEHOME_PUBLIC_MEDIA_IP in syncd env (lab pct-exec used to drop that and
 * create ring/no-audio remotes).
 *
 * Lab transport: HTTP POST to phonehome-freepbx-syncd on the Proxmox host
 * (see deploy/phonehome-freepbx-syncd.*). Never logs the secret — only hashes.
 */

import { createHash } from "node:crypto";
import { lookup, Resolver } from "node:dns/promises";
import { readFileSync, existsSync } from "node:fs";

export type FreepbxSyncMode = "remote" | "lan";

export type FreepbxSyncResult =
  | {
      ok: true;
      ext: string;
      secret_sha256: string;
      skipped?: boolean;
      created?: boolean;
      mode?: string;
      media_address?: string | null;
    }
  | { ok: false; ext: string; error: string };

function loadSyncEnv(): { url: string; token: string } | null {
  const url = (process.env.FREEPBX_SYNC_URL || "").trim();
  const token = (process.env.FREEPBX_SYNC_TOKEN || "").trim();
  if (url && token) return { url, token };

  const file = (process.env.FREEPBX_SYNC_ENV || "/var/lib/kids-landline/freepbx-sync.env").trim();
  if (!existsSync(file)) return null;
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    env[t.slice(0, i)] = t.slice(i + 1);
  }
  if (!env.FREEPBX_SYNC_URL || !env.FREEPBX_SYNC_TOKEN) return null;
  return { url: env.FREEPBX_SYNC_URL, token: env.FREEPBX_SYNC_TOKEN };
}

export function freepbxSyncConfigured(): boolean {
  return Boolean(loadSyncEnv());
}

/** Derive /sip-notify URL from FREEPBX_SYNC_URL (…/sip-secret). */
export function freepbxSipNotifyUrl(syncUrl: string): string {
  const u = String(syncUrl || "").trim().replace(/\/+$/, "");
  if (u.endsWith("/sip-secret")) return `${u.slice(0, -"/sip-secret".length)}/sip-notify`;
  if (u.endsWith("/sip-notify")) return u;
  return `${u}/sip-notify`;
}

export type FreepbxNotifyResult =
  | { ok: true; ext: string; event: string; skipped?: boolean; detail?: string }
  | { ok: false; ext: string; error: string };

export function sha256Prefix(secret: string, n = 16): string {
  return createHash("sha256").update(String(secret), "utf8").digest("hex").slice(0, n);
}

/**
 * FreePBX PJSIP mode for an ATA.
 *
 * - Private SIP host → lan/home: rewrite_contact=yes; omit public media_address
 *   in the POST (FreePBX pins media_address to its own LAN IP).
 * - Public FQDN + mothership one-tap → lan/home: same — do NOT send public
 *   media_address (WAN hairpin breaks softphone↔analog / home↔cousin uplink).
 *   rewrite_contact must stay yes so Contact remains on the SIP TLS proxy —
 *   otherwise qualify hits the ATA LAN IP and the app shows offline.
 * - Public FQDN + invited/cousin Download → remote: rewrite_contact=yes +
 *   media_address=public IP. Without media_address, SDP stays private →
 *   ring, no audio.
 */
export function ataFreepbxSyncMode(
  sipServer: string | null | undefined,
  opts?: { setupMode?: "lan" | "download" | null }
): FreepbxSyncMode {
  if (opts?.setupMode === "lan") return "lan";
  const host = String(sipServer || "")
    .trim()
    .toLowerCase()
    .split(":")[0]
    .replace(/^\[|\]$/g, "");
  if (!host) return "remote";
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "lan";
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return "lan";
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return "lan";
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return "lan";
  return "remote";
}

/** Hostname parents' ATAs dial (DuckDNS / custom FQDN). */
export function sipPublicHostFromEnv(): string {
  const explicit = (process.env.SIP_PUBLIC_HOST || process.env.SIP_SERVER || "").trim();
  if (explicit && !/^\d{1,3}(\.\d{1,3}){3}$/.test(explicit.split(":")[0]!)) {
    return explicit.split(":")[0]!.replace(/^\[|\]$/g, "");
  }
  const pub = (process.env.PUBLIC_BASE_URL || "").trim();
  if (pub) {
    try {
      return new URL(pub).hostname || "";
    } catch {
      /* ignore */
    }
  }
  return explicit.split(":")[0]?.replace(/^\[|\]$/g, "") || "";
}

function isIpv4(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

/** RFC1918 and loopback. AdGuard rewrites the public SIP name to the PVE box. */
export function isPrivateIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const n = m.slice(1).map((p) => Number(p));
  if (n.some((x) => x > 255)) return false;
  const a = n[0] ?? 0;
  const b = n[1] ?? 0;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function publicIpv4(ip: string | null | undefined): string | null {
  const s = String(ip || "").trim();
  if (!isIpv4(s) || isPrivateIpv4(s)) return null;
  return s;
}

let cachedMediaIp: { host: string; ip: string; at: number } | null = null;

/** A record via a resolver that does not apply the LAN AdGuard rewrite. */
async function lookupPublicA(host: string): Promise<string | null> {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  try {
    const addrs = await Promise.race([
      resolver.resolve4(host),
      new Promise<string[]>((_, reject) => {
        setTimeout(() => reject(new Error("public dns timeout")), 3000);
      }),
    ]);
    return addrs.map((a) => publicIpv4(a)).find((a): a is string => Boolean(a)) || null;
  } catch {
    return null;
  }
}

/**
 * Public IPv4 for remote ATA SDP (router UDP 10000–10200 → FreePBX).
 * Prefer an explicit public PHONEHOME_PUBLIC_MEDIA_IP. A private answer —
 * including that env var — is the LAN hairpin of SIP_PUBLIC_HOST and must
 * not be advertised to cousin ATAs (ring, no audio).
 */
export async function resolvePublicMediaIp(opts?: {
  host?: string | null;
  lookupFn?: typeof lookup;
  /** Used when system DNS returns a private address. Tests inject this. */
  publicLookupFn?: (host: string) => Promise<string | null>;
}): Promise<string | null> {
  const forced = (
    process.env.PHONEHOME_PUBLIC_MEDIA_IP ||
    process.env.PHONEHOME_SIP_PUBLIC_IP ||
    ""
  ).trim();
  if (forced && isIpv4(forced)) {
    const pub = publicIpv4(forced);
    if (pub) return pub;
  }

  const host = String(opts?.host || (forced && !isIpv4(forced) ? forced : "") || sipPublicHostFromEnv() || "")
    .trim()
    .split(":")[0]
    .replace(/^\[|\]$/g, "");
  if (!host) return null;
  if (isIpv4(host)) return publicIpv4(host);

  const now = Date.now();
  if (cachedMediaIp && cachedMediaIp.host === host && now - cachedMediaIp.at < 60_000) {
    return cachedMediaIp.ip;
  }

  let resolved: string | null = null;
  try {
    const r = await (opts?.lookupFn || lookup)(host, { family: 4 });
    resolved = publicIpv4(r.address);
  } catch {
    resolved = null;
  }
  if (!resolved) {
    resolved = publicIpv4(await (opts?.publicLookupFn || lookupPublicA)(host));
  }
  if (!resolved) return null;
  cachedMediaIp = { host, ip: resolved, at: now };
  return resolved;
}

/** Test helper — clear DNS cache between cases. */
export function clearPublicMediaIpCache(): void {
  cachedMediaIp = null;
}

/**
 * Push one extension into FreePBX (create-if-missing + secret + TLS/SRTP mode) and reload.
 * No-ops (ok + skipped) when sync is not configured.
 *
 * For remote mode, always sends media_address resolved on the hub so FreePBX
 * never depends on syncd env surviving pct exec.
 */
export async function syncAtaSipSecretToFreepbx(
  ext: string,
  secret: string,
  opts?: {
    fetchImpl?: typeof fetch;
    displayName?: string | null;
    mode?: FreepbxSyncMode;
    sipServer?: string | null;
    /** Mothership one-tap vs cousin Download — overrides FQDN→remote. */
    setupMode?: "lan" | "download" | null;
    lookupFn?: typeof lookup;
  }
): Promise<FreepbxSyncResult> {
  const extension = String(ext || "").replace(/\D/g, "");
  if (!/^\d{2,8}$/.test(extension)) {
    return { ok: false, ext: extension, error: "invalid extension" };
  }
  if (String(secret || "").length < 8) {
    return { ok: false, ext: extension, error: "secret too short" };
  }

  const cfg = loadSyncEnv();
  if (!cfg) {
    return { ok: true, ext: extension, secret_sha256: sha256Prefix(secret), skipped: true };
  }

  const mode =
    opts?.mode || ataFreepbxSyncMode(opts?.sipServer, { setupMode: opts?.setupMode });
  const display_name = String(opts?.displayName || "").trim().slice(0, 64) || undefined;
  const sip_public_host = sipPublicHostFromEnv() || undefined;

  let media_address: string | null = null;
  if (mode === "remote") {
    media_address = await resolvePublicMediaIp({
      host: sip_public_host,
      lookupFn: opts?.lookupFn,
    });
    if (!media_address) {
      return {
        ok: false,
        ext: extension,
        error:
          "Could not resolve a public media IP for remote analog (set SIP_PUBLIC_HOST / PUBLIC_BASE_URL). " +
          "Without it the phone rings with no audio.",
      };
    }
  }

  const fetchFn = opts?.fetchImpl || fetch;
  try {
    const res = await fetchFn(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ext: extension,
        secret: String(secret),
        mode,
        ...(display_name ? { display_name } : {}),
        ...(sip_public_host ? { sip_public_host } : {}),
        ...(media_address ? { media_address } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let body: {
      ok?: boolean;
      secret_sha256?: string;
      err?: string;
      error?: string;
      created?: boolean;
      mode?: string;
      media_address?: string | null;
    } | null = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        ext: extension,
        error: body?.err || body?.error || `sync HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      ext: extension,
      secret_sha256: String(body.secret_sha256 || sha256Prefix(secret)),
      created: Boolean(body.created),
      mode: String(body.mode || mode),
      media_address: body.media_address ?? media_address,
    };
  } catch (e) {
    return {
      ok: false,
      ext: extension,
      error: (e as Error).message || "sync unreachable",
    };
  }
}

/**
 * Ask FreePBX to SIP-NOTIFY one registered HT801 (check-sync;reboot=true by default).
 * Works for remote cousins — no LAN access to the Grandstream admin UI required.
 * No-ops (ok + skipped) when FreePBX sync is not configured.
 */
export async function rebootAtaViaFreepbx(
  ext: string,
  opts?: {
    event?: "reboot" | "check-sync";
    fetchImpl?: typeof fetch;
  }
): Promise<FreepbxNotifyResult> {
  const extension = String(ext || "").replace(/\D/g, "");
  if (!/^\d{2,8}$/.test(extension)) {
    return { ok: false, ext: extension, error: "invalid extension" };
  }
  const event = opts?.event === "check-sync" ? "check-sync" : "reboot";
  const cfg = loadSyncEnv();
  if (!cfg) {
    return { ok: true, ext: extension, event, skipped: true };
  }

  const fetchFn = opts?.fetchImpl || fetch;
  const url = freepbxSipNotifyUrl(cfg.url);
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ext: extension, event }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body: { ok?: boolean; err?: string; error?: string; detail?: string; event?: string } | null =
      null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        ext: extension,
        error: body?.err || body?.error || `notify HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      ext: extension,
      event: String(body.event || event),
      detail: body.detail ? String(body.detail).slice(0, 200) : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      ext: extension,
      error: (e as Error).message || "notify unreachable",
    };
  }
}
