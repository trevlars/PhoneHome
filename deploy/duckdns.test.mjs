import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDuckDnsToEnv,
  duckDnsPublicUrls,
  normalizeDuckDnsDomain,
  normalizeDuckDnsToken,
} from "./duckdns.mjs";

test("normalizeDuckDnsDomain strips FQDN and URL junk", () => {
  assert.equal(normalizeDuckDnsDomain("MyFamily"), "myfamily");
  assert.equal(normalizeDuckDnsDomain("myfamily.duckdns.org"), "myfamily");
  assert.equal(normalizeDuckDnsDomain("https://myfamily.duckdns.org:8443/"), "myfamily");
  assert.equal(normalizeDuckDnsDomain("bad_name"), "");
  assert.equal(normalizeDuckDnsDomain(""), "");
});

test("normalizeDuckDnsToken trims quotes", () => {
  assert.equal(normalizeDuckDnsToken('  "abc-def"  '), "abc-def");
});

test("duckDnsPublicUrls builds origin + host", () => {
  assert.deepEqual(duckDnsPublicUrls({ domain: "example" }), {
    host: "example.duckdns.org",
    origin: "https://example.duckdns.org:8443",
    port: "8443",
  });
  assert.equal(duckDnsPublicUrls({ domain: "x", httpsPort: "443" }).origin, "https://x.duckdns.org");
});

test("applyDuckDnsToEnv fills placeholders without clobbering custom URL", () => {
  const env = {
    DUCKDNS_DOMAIN: "myfamily",
    DUCKDNS_TOKEN: "token-here",
    PUBLIC_BASE_URL: "",
    SIP_PUBLIC_HOST: "phonehome.local",
  };
  const r = applyDuckDnsToEnv(env);
  assert.equal(r.applied, true);
  assert.equal(env.PUBLIC_BASE_URL, "https://myfamily.duckdns.org:8443");
  assert.equal(env.SIP_PUBLIC_HOST, "myfamily.duckdns.org");

  const keep = {
    DUCKDNS_DOMAIN: "myfamily",
    DUCKDNS_TOKEN: "token-here",
    PUBLIC_BASE_URL: "https://custom.example.net:9443",
    SIP_PUBLIC_HOST: "custom.example.net",
  };
  applyDuckDnsToEnv(keep);
  assert.equal(keep.PUBLIC_BASE_URL, "https://custom.example.net:9443");
  assert.equal(keep.SIP_PUBLIC_HOST, "custom.example.net");
});
