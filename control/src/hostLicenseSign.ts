import crypto from "node:crypto";
import fs from "node:fs";

export const HOST_LICENSE_YEAR_DAYS = 365;

export type HostLicensePayload = {
  v: 1;
  kind: "licensed";
  instanceId: string;
  email?: string;
  /** Shareable host referral code (e.g. PHAB12CD). */
  ref?: string;
  iat: number;
  exp: number;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Sign a license payload (Ed25519 / any Node crypto private key PEM). */
export function signHostLicense(payload: HostLicensePayload, privateKeyPem: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(body, "utf8"), key);
  return `${body}.${b64url(sig)}`;
}

export function issueAnnualLicensePayload(opts: {
  instanceId: string;
  email?: string;
  referralCode?: string;
  nowMs?: number;
  extendFromExpMs?: number | null;
}): HostLicensePayload {
  const nowMs = opts.nowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const base = opts.extendFromExpMs && opts.extendFromExpMs > nowMs ? opts.extendFromExpMs : nowMs;
  const exp = Math.floor(base / 1000) + HOST_LICENSE_YEAR_DAYS * 86400;
  const payload: HostLicensePayload = {
    v: 1,
    kind: "licensed",
    instanceId: opts.instanceId,
    email: opts.email,
    iat,
    exp,
  };
  if (opts.referralCode) payload.ref = opts.referralCode;
  return payload;
}

export function spinoffPromoCode(): string {
  return String(process.env.HOST_LICENSE_SPINOFF_PROMO || "OWNMS5").trim().toUpperCase();
}

export function referralCreditCents(): number {
  const n = Number(process.env.HOST_LICENSE_REFERRAL_CREDIT_CENTS || 300);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 300;
}

export function hostLicensePrivateKey(): string {
  const fromEnv = String(process.env.HOST_LICENSE_PRIVATE_KEY || "").trim();
  if (fromEnv) return fromEnv.replace(/\\n/g, "\n");
  const file = String(process.env.HOST_LICENSE_PRIVATE_KEY_FILE || "").trim();
  if (file) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {
      return "";
    }
  }
  return "";
}

export function hostLicenseAnnualPriceId(): string {
  return String(process.env.STRIPE_PRICE_HOST_ANNUAL || "").trim();
}

export function isHostLicensePrice(priceId: string): boolean {
  const annual = hostLicenseAnnualPriceId();
  return Boolean(priceId && annual && priceId === annual);
}
