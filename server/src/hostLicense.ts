import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HOST_LICENSE_TRIAL_DAYS = 30;
export const HOST_LICENSE_GRACE_DAYS = 30;
export const HOST_LICENSE_YEAR_DAYS = 365;

export type HostLicenseKind = "trial" | "licensed";
export type HostLicenseState = "trial" | "licensed" | "grace" | "locked";

export type HostLicenseStatus = {
  state: HostLicenseState;
  kind: HostLicenseKind | null;
  instanceId: string;
  expiresAt: string | null;
  daysLeft: number | null;
  graceDaysLeft: number | null;
  buyUrl: string;
  message: string;
  /** Shareable host referral code from signed license claims (`ref`), when licensed. */
  referralCode?: string | null;
};

type EntitlementFile = {
  instanceId: string;
  trialStartedAt: string;
  licenseBlob: string | null;
};

type LicensePayload = {
  v: 1;
  kind: "licensed";
  instanceId: string;
  email?: string;
  /** Shareable referral code embedded at issue time. */
  ref?: string;
  iat: number;
  exp: number;
};

function buyUrl(): string {
  return String(process.env.HOST_LICENSE_BUY_URL || "https://phonehome.pages.dev/buy.html").trim();
}

function publicKeyPem(): string {
  const fromEnv = String(process.env.HOST_LICENSE_PUBLIC_KEY || "").trim();
  if (fromEnv) return fromEnv.replace(/\\n/g, "\n");
  const file = String(process.env.HOST_LICENSE_PUBLIC_KEY_FILE || "").trim();
  if (file) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {
      return "";
    }
  }
  // Convention: DATA_DIR/host-license.pub next to host-license.json
  return "";
}

/** When set, skip license enforcement (lab / CI). */
export function hostLicenseEnforcementDisabled(): boolean {
  const raw = String(process.env.HOST_LICENSE_ENFORCE || "1").trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "off";
}

function entitlementPath(dataDir: string): string {
  return path.join(dataDir, "host-license.json");
}

function readEntitlement(dataDir: string): EntitlementFile | null {
  const file = entitlementPath(dataDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as EntitlementFile;
  } catch {
    return null;
  }
}

function writeEntitlement(dataDir: string, value: EntitlementFile): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(entitlementPath(dataDir), JSON.stringify(value, null, 2), "utf8");
}

export function ensureHostInstanceId(dataDir: string): string {
  const existing = readEntitlement(dataDir);
  if (existing?.instanceId) return existing.instanceId;
  const instanceId = `phinst_${crypto.randomBytes(12).toString("hex")}`;
  const now = new Date().toISOString();
  writeEntitlement(dataDir, {
    instanceId,
    trialStartedAt: now,
    licenseBlob: existing?.licenseBlob || null,
  });
  return instanceId;
}

export function ensureTrialStarted(dataDir: string): EntitlementFile {
  const existing = readEntitlement(dataDir);
  if (existing?.instanceId && existing.trialStartedAt) return existing;
  const instanceId = existing?.instanceId || `phinst_${crypto.randomBytes(12).toString("hex")}`;
  const trialStartedAt = existing?.trialStartedAt || new Date().toISOString();
  const next: EntitlementFile = {
    instanceId,
    trialStartedAt,
    licenseBlob: existing?.licenseBlob || null,
  };
  writeEntitlement(dataDir, next);
  return next;
}

/** HAOS / Docker: paste license in options → env or `host-license.blob` file. */
export function bootstrapHostLicenseFromEnv(dataDir: string): void {
  ensureTrialStarted(dataDir);
  const fromEnv = String(process.env.HOST_LICENSE_BLOB || "").trim();
  const blobPath = path.join(dataDir, "host-license.blob");
  let blob = fromEnv;
  if (!blob && fs.existsSync(blobPath)) {
    try {
      blob = fs.readFileSync(blobPath, "utf8").trim();
    } catch {
      blob = "";
    }
  }
  if (!blob) return;
  const result = activateHostLicense(dataDir, blob);
  if (!result.ok) {
    console.warn(`[host-license] bootstrap activate failed: ${result.error}`);
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/** Sign a license payload (control plane). Requires HOST_LICENSE_PRIVATE_KEY PEM. */
export function signHostLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(body, "utf8"), key);
  return `${body}.${b64url(sig)}`;
}

export function verifyHostLicenseBlob(
  blob: string,
  publicKeyPem: string
): { ok: true; payload: LicensePayload } | { ok: false; error: string } {
  const parts = blob.trim().split(".");
  if (parts.length !== 2) return { ok: false, error: "Invalid license format" };
  const [body, sigB64] = parts;
  if (!body || !sigB64) return { ok: false, error: "Invalid license format" };
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    const good = crypto.verify(null, Buffer.from(body, "utf8"), key, fromB64url(sigB64));
    if (!good) return { ok: false, error: "License signature invalid" };
    const payload = JSON.parse(fromB64url(body).toString("utf8")) as LicensePayload;
    if (payload.v !== 1 || payload.kind !== "licensed") {
      return { ok: false, error: "Unsupported license version" };
    }
    if (!payload.instanceId || !payload.exp) return { ok: false, error: "License missing fields" };
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "License verify failed" };
  }
}

export function activateHostLicense(
  dataDir: string,
  blob: string
): { ok: true; status: HostLicenseStatus } | { ok: false; error: string } {
  const pem = publicKeyPem();
  if (!pem) return { ok: false, error: "HOST_LICENSE_PUBLIC_KEY is not configured on this mothership" };
  const verified = verifyHostLicenseBlob(blob, pem);
  if (!verified.ok) return verified;
  const ent = ensureTrialStarted(dataDir);
  if (verified.payload.instanceId !== ent.instanceId && verified.payload.instanceId !== "*") {
    return {
      ok: false,
      error: `License is for instance ${verified.payload.instanceId}, this mothership is ${ent.instanceId}`,
    };
  }
  writeEntitlement(dataDir, { ...ent, licenseBlob: blob.trim() });
  return { ok: true, status: getHostLicenseStatus(dataDir) };
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.ceil((toMs - fromMs) / (86400 * 1000));
}

export function getHostLicenseStatus(dataDir: string, nowMs = Date.now()): HostLicenseStatus {
  if (hostLicenseEnforcementDisabled()) {
    const instanceId = ensureHostInstanceId(dataDir);
    return {
      state: "licensed",
      kind: "licensed",
      instanceId,
      expiresAt: null,
      daysLeft: null,
      graceDaysLeft: null,
      buyUrl: buyUrl(),
      message: "Host license enforcement disabled (lab)",
      referralCode: null,
    };
  }

  const ent = ensureTrialStarted(dataDir);
  const pem = publicKeyPem();
  const buy = buyUrl();

  if (ent.licenseBlob && pem) {
    const verified = verifyHostLicenseBlob(ent.licenseBlob, pem);
    if (verified.ok) {
      const expMs = verified.payload.exp * 1000;
      const graceEnd = expMs + HOST_LICENSE_GRACE_DAYS * 86400 * 1000;
      const referralCode = verified.payload.ref ? String(verified.payload.ref) : null;
      if (nowMs < expMs) {
        return {
          state: "licensed",
          kind: "licensed",
          instanceId: ent.instanceId,
          expiresAt: new Date(expMs).toISOString(),
          daysLeft: Math.max(0, daysBetween(nowMs, expMs)),
          graceDaysLeft: null,
          buyUrl: buy,
          message: "Host license active",
          referralCode,
        };
      }
      if (nowMs < graceEnd) {
        return {
          state: "grace",
          kind: "licensed",
          instanceId: ent.instanceId,
          expiresAt: new Date(expMs).toISOString(),
          daysLeft: 0,
          graceDaysLeft: Math.max(0, daysBetween(nowMs, graceEnd)),
          buyUrl: buy,
          message: "Host license in grace — renew soon",
          referralCode,
        };
      }
      return {
        state: "locked",
        kind: "licensed",
        instanceId: ent.instanceId,
        expiresAt: new Date(expMs).toISOString(),
        daysLeft: 0,
        graceDaysLeft: 0,
        buyUrl: buy,
        message: "Host license expired — renew on the PhoneHome website",
        referralCode,
      };
    }
  }

  const trialStart = Date.parse(ent.trialStartedAt);
  const trialEnd = trialStart + HOST_LICENSE_TRIAL_DAYS * 86400 * 1000;
  if (Number.isFinite(trialStart) && nowMs < trialEnd) {
    return {
      state: "trial",
      kind: "trial",
      instanceId: ent.instanceId,
      expiresAt: new Date(trialEnd).toISOString(),
      daysLeft: Math.max(0, daysBetween(nowMs, trialEnd)),
      graceDaysLeft: null,
      buyUrl: buy,
      message: `Trial — ${Math.max(0, daysBetween(nowMs, trialEnd))} days left`,
      referralCode: null,
    };
  }

  return {
    state: "locked",
    kind: "trial",
    instanceId: ent.instanceId,
    expiresAt: Number.isFinite(trialEnd) ? new Date(trialEnd).toISOString() : null,
    daysLeft: 0,
    graceDaysLeft: 0,
    buyUrl: buy,
    message: "Trial ended — subscribe on the PhoneHome website to activate this Mothership",
    referralCode: null,
  };
}

export function hostLicenseAllowsCalls(status: HostLicenseStatus): boolean {
  return status.state === "trial" || status.state === "licensed" || status.state === "grace";
}

/** Paths that must work while locked (setup, license, health, auth). */
export function isHostLicenseExemptPath(pathname: string): boolean {
  const p = pathname.split("?")[0] || "";
  if (p === "/api/health" || p === "/api/bootstrap" || p === "/api/ice") return true;
  if (p.startsWith("/api/license")) return true;
  if (p.startsWith("/api/host/network")) return true;
  if (p === "/api/login" || p === "/api/logout" || p === "/api/setup" || p === "/api/me") return true;
  if (p.startsWith("/api/auth/")) return true;
  if (p.startsWith("/api/setup")) return true;
  // Migrate / peer setup while locked so hosts can leave & re-activate elsewhere.
  if (p.includes("/migrate/")) return true;
  if (p.startsWith("/api/peers")) return true;
  // Static / non-API
  if (!p.startsWith("/api/")) return true;
  return false;
}

export function issueAnnualLicensePayload(opts: {
  instanceId: string;
  email?: string;
  nowMs?: number;
  extendFromExpMs?: number | null;
}): LicensePayload {
  const nowMs = opts.nowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const base = opts.extendFromExpMs && opts.extendFromExpMs > nowMs ? opts.extendFromExpMs : nowMs;
  const exp = Math.floor(base / 1000) + HOST_LICENSE_YEAR_DAYS * 86400;
  return {
    v: 1,
    kind: "licensed",
    instanceId: opts.instanceId,
    email: opts.email,
    iat,
    exp,
  };
}
