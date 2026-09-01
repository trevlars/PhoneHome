/**
 * Keep FreePBX's sip.secret (and PJSIP endpoint) in lockstep with PhoneHome ATA rows.
 *
 * Remote parents only have Download config → upload on the adapter. If FreePBX
 * still holds an older secret — or the extension was never created — REGISTER
 * fails. Call `syncAtaSipSecretToFreepbx` on Save and again before Download/push.
 *
 * Lab transport: HTTP POST to phonehome-freepbx-syncd on the Proxmox host
 * (see deploy/phonehome-freepbx-syncd.*). Never logs the secret — only hashes.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

export type FreepbxSyncMode = "remote" | "lan";

export type FreepbxSyncResult =
  | { ok: true; ext: string; secret_sha256: string; skipped?: boolean; created?: boolean; mode?: string }
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

export function sha256Prefix(secret: string, n = 16): string {
  return createHash("sha256").update(String(secret), "utf8").digest("hex").slice(0, n);
}

/**
 * LAN SIP host → lab ATA (rewrite_contact=no). Public FQDN → remote ATA.
 */
export function ataFreepbxSyncMode(sipServer: string | null | undefined): FreepbxSyncMode {
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

/**
 * Push one extension into FreePBX (create-if-missing + secret + TLS/SRTP mode) and reload.
 * No-ops (ok + skipped) when sync is not configured.
 */
export async function syncAtaSipSecretToFreepbx(
  ext: string,
  secret: string,
  opts?: {
    fetchImpl?: typeof fetch;
    displayName?: string | null;
    mode?: FreepbxSyncMode;
    sipServer?: string | null;
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

  const mode = opts?.mode || ataFreepbxSyncMode(opts?.sipServer);
  const display_name = String(opts?.displayName || "").trim().slice(0, 64) || undefined;

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
    };
  } catch (e) {
    return {
      ok: false,
      ext: extension,
      error: (e as Error).message || "sync unreachable",
    };
  }
}
