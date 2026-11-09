import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { issueAnnualLicensePayload, signHostLicense } from "./hostLicenseSign.js";

test("annual host license signs and renew extends from prior expiry", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
  const first = issueAnnualLicensePayload({
    instanceId: "phinst_abc123def456",
    email: "host@example.com",
    nowMs,
  });
  const blob = signHostLicense(first, privatePem);
  assert.match(blob, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const [body, sig] = blob.split(".");
  assert.ok(
    crypto.verify(null, Buffer.from(body!, "utf8"), crypto.createPublicKey(publicPem), Buffer.from(sig!, "base64url"))
  );

  const renew = issueAnnualLicensePayload({
    instanceId: "phinst_abc123def456",
    nowMs: nowMs + 1000,
    extendFromExpMs: first.exp * 1000,
  });
  assert.equal(renew.exp, first.exp + 365 * 86400);
});
