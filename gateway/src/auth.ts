import crypto from "node:crypto";

export type InstanceClaims = {
  iss: "phonehome-mothership";
  sub: string;
  aud: "phonehome-push-gateway";
  iat: number;
  exp: number;
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodePart(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

export function signInstanceToken(
  instanceId: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
  ttlSec = 300
): string {
  if (!instanceId.trim() || secret.length < 24) throw new Error("Invalid instance credentials");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: InstanceClaims = {
    iss: "phonehome-mothership",
    sub: instanceId.trim(),
    aud: "phonehome-push-gateway",
    iat: now,
    exp: now + Math.max(30, Math.min(300, ttlSec)),
  };
  const payload = b64url(JSON.stringify(claims));
  const unsigned = `${header}.${payload}`;
  const signature = b64url(crypto.createHmac("sha256", secret).update(unsigned).digest());
  return `${unsigned}.${signature}`;
}

export function parseInstanceSecrets(raw = process.env.MOTHERSHIP_INSTANCE_SECRETS || ""): Map<string, string> {
  if (!raw.trim()) return new Map();
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const out = new Map<string, string>();
  for (const [id, value] of Object.entries(parsed)) {
    const secret = String(value || "");
    if (id.trim() && secret.length >= 24) out.set(id.trim(), secret);
  }
  return out;
}

export function verifyInstanceToken(
  token: string,
  secretForInstance: (instanceId: string) => string | undefined,
  now = Math.floor(Date.now() / 1000)
): InstanceClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  let header: { alg?: string };
  let claims: InstanceClaims;
  try {
    header = JSON.parse(decodePart(parts[0]).toString("utf8")) as { alg?: string };
    claims = JSON.parse(decodePart(parts[1]).toString("utf8")) as InstanceClaims;
  } catch {
    throw new Error("Invalid token");
  }
  if (
    header.alg !== "HS256" ||
    claims.iss !== "phonehome-mothership" ||
    claims.aud !== "phonehome-push-gateway" ||
    !claims.sub
  ) {
    throw new Error("Invalid token");
  }
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)) throw new Error("Invalid token");
  if (claims.iat > now + 30 || claims.exp <= now || claims.exp - claims.iat > 300) {
    throw new Error("Expired token");
  }
  const secret = secretForInstance(claims.sub);
  if (!secret) throw new Error("Unknown instance");
  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const actual = decodePart(parts[2]);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("Invalid token");
  }
  return claims;
}
