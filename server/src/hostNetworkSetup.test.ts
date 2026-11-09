import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyHostNetwork,
  duckDnsPublicOrigin,
  normalizeDuckDnsDomain,
  parseEnvFile,
  readHostNetworkConfig,
  upsertEnvLines,
} from "./hostNetworkSetup.js";

test("normalizeDuckDnsDomain strips FQDN and URL junk", () => {
  assert.equal(normalizeDuckDnsDomain("MyFamily"), "myfamily");
  assert.equal(normalizeDuckDnsDomain("myfamily.duckdns.org"), "myfamily");
  assert.equal(normalizeDuckDnsDomain("https://myfamily.duckdns.org:8443/"), "myfamily");
  assert.equal(normalizeDuckDnsDomain("bad_name"), "");
});

test("duckDnsPublicOrigin builds https origin", () => {
  assert.equal(duckDnsPublicOrigin("trevlars"), "https://mothership.example:8443");
  assert.equal(duckDnsPublicOrigin("x", "443"), "https://x.duckdns.org");
});

test("upsertEnvLines replaces and appends", () => {
  const next = upsertEnvLines("PORT=8787\nPUBLIC_BASE_URL=https://old\n", {
    PUBLIC_BASE_URL: "https://new.example:8443",
    DUCKDNS_DOMAIN: "new",
  });
  const parsed = parseEnvFile(next);
  assert.equal(parsed.PORT, "8787");
  assert.equal(parsed.PUBLIC_BASE_URL, "https://new.example:8443");
  assert.equal(parsed.DUCKDNS_DOMAIN, "new");
});

test("applyHostNetwork writes phonehome.env and updates process.env", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-hostnet-"));
  const prev = {
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    DUCKDNS_DOMAIN: process.env.DUCKDNS_DOMAIN,
    DUCKDNS_TOKEN: process.env.DUCKDNS_TOKEN,
    DUCKDNS_HTTPS_PORT: process.env.DUCKDNS_HTTPS_PORT,
    SIP_PUBLIC_HOST: process.env.SIP_PUBLIC_HOST,
  };
  try {
    const result = await applyHostNetwork(dir, {
      duckDnsDomain: "myfamily",
      duckDnsToken: "secret-token",
      duckDnsHttpsPort: "8443",
      testDuckDns: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.saved, true);
    assert.equal(result.config.publicBaseUrl, "https://myfamily.duckdns.org:8443");
    assert.equal(result.config.hasDuckDnsToken, true);
    assert.equal(process.env.PUBLIC_BASE_URL, "https://myfamily.duckdns.org:8443");
    assert.equal(process.env.SIP_PUBLIC_HOST, "myfamily.duckdns.org");

    const again = readHostNetworkConfig(dir);
    assert.equal(again.duckDnsDomain, "myfamily");
    assert.equal(again.hasDuckDnsToken, true);

    // Omitting token keeps the stored one.
    const keep = await applyHostNetwork(dir, {
      duckDnsDomain: "myfamily",
      duckDnsHttpsPort: "9443",
      publicBaseUrl: "",
      testDuckDns: false,
    });
    assert.equal(keep.ok, true);
    assert.equal(keep.config.publicBaseUrl, "https://myfamily.duckdns.org:9443");
    assert.equal(keep.config.hasDuckDnsToken, true);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyHostNetwork rejects non-https public URL", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-hostnet-"));
  try {
    const result = await applyHostNetwork(dir, {
      publicBaseUrl: "http://insecure.example",
      testDuckDns: false,
    });
    assert.equal(result.ok, false);
    assert.match(result.error || "", /https/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
