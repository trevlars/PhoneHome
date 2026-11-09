import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HOST_LICENSE_TRIAL_DAYS,
  activateHostLicense,
  ensureTrialStarted,
  getHostLicenseStatus,
  hostLicenseAllowsCalls,
  issueAnnualLicensePayload,
  signHostLicense,
  verifyHostLicenseBlob,
} from "./hostLicense.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ph-license-"));
}

function keyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

test("trial starts on first ensure and expires after 30 days", () => {
  const dir = tmpDir();
  const previous = process.env.HOST_LICENSE_ENFORCE;
  process.env.HOST_LICENSE_ENFORCE = "1";
  delete process.env.HOST_LICENSE_PUBLIC_KEY;
  try {
    const ent = ensureTrialStarted(dir);
    const status = getHostLicenseStatus(dir);
    assert.equal(status.state, "trial");
    assert.equal(status.instanceId, ent.instanceId);
    assert.ok((status.daysLeft ?? 0) <= HOST_LICENSE_TRIAL_DAYS);
    assert.ok(hostLicenseAllowsCalls(status));

    const after = getHostLicenseStatus(
      dir,
      Date.parse(ent.trialStartedAt) + (HOST_LICENSE_TRIAL_DAYS + 1) * 86400 * 1000
    );
    assert.equal(after.state, "locked");
    assert.equal(hostLicenseAllowsCalls(after), false);
  } finally {
    if (previous === undefined) delete process.env.HOST_LICENSE_ENFORCE;
    else process.env.HOST_LICENSE_ENFORCE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("signed annual license activates and enters grace after expiry", () => {
  const dir = tmpDir();
  const keys = keyPair();
  const previous = {
    enforce: process.env.HOST_LICENSE_ENFORCE,
    pub: process.env.HOST_LICENSE_PUBLIC_KEY,
  };
  process.env.HOST_LICENSE_ENFORCE = "1";
  process.env.HOST_LICENSE_PUBLIC_KEY = keys.publicPem;
  try {
    const ent = ensureTrialStarted(dir);
    const payload = issueAnnualLicensePayload({ instanceId: ent.instanceId, email: "a@b.co" });
    const blob = signHostLicense(payload, keys.privatePem);
    const verified = verifyHostLicenseBlob(blob, keys.publicPem);
    assert.equal(verified.ok, true);

    const activated = activateHostLicense(dir, blob);
    assert.equal(activated.ok, true);
    if (!activated.ok) return;
    assert.equal(activated.status.state, "licensed");

    const grace = getHostLicenseStatus(dir, payload.exp * 1000 + 2 * 86400 * 1000);
    assert.equal(grace.state, "grace");
    assert.ok(hostLicenseAllowsCalls(grace));

    const locked = getHostLicenseStatus(dir, payload.exp * 1000 + 40 * 86400 * 1000);
    assert.equal(locked.state, "locked");
  } finally {
    if (previous.enforce === undefined) delete process.env.HOST_LICENSE_ENFORCE;
    else process.env.HOST_LICENSE_ENFORCE = previous.enforce;
    if (previous.pub === undefined) delete process.env.HOST_LICENSE_PUBLIC_KEY;
    else process.env.HOST_LICENSE_PUBLIC_KEY = previous.pub;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
