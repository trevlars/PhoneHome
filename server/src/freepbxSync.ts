/**
 * Keep FreePBX's sip.secret in lockstep with PhoneHome's ata_devices.sip_password.
 *
 * Remote parents only have Download config → upload on the adapter. If FreePBX
 * still holds an older secret, REGISTER fails and the line looks "broken" even
 * though the XML was correct. Call `syncAtaSipSecretToFreepbx` whenever we
 * mint/change a secret and again immediately before serving a download.
 *
 * Lab transport: HTTP POST to phonehome-freepbx-syncd on the Proxmox host
 * (see deploy/phonehome-freepbx-syncd.*). Never logs the secret — only hashes.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

export type FreepbxSyncResult =
  | { ok: true; ext: string; secret_sha256: string; skipped?: boolean }
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
 * Push one extension's SIP secret into FreePBX and reload.
 * No-ops (ok + skipped) when sync is not configured — so unit tests and
 * softphone-only deploys stay quiet.
 */
export async function syncAtaSipSecretToFreepbx(
  ext: string,
  secret: string,
  opts?: { fetchImpl?: typeof fetch }
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

  const fetchFn = opts?.fetchImpl || fetch;
  try {
    const res = await fetchFn(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ext: extension, secret: String(secret) }),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let body: { ok?: boolean; secret_sha256?: string; err?: string; error?: string } | null = null;
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
    };
  } catch (e) {
    return {
      ok: false,
      ext: extension,
      error: (e as Error).message || "sync unreachable",
    };
  }
}
