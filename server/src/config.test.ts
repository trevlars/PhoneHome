import assert from "node:assert/strict";
import test from "node:test";
import { defaultSipServer } from "./api.js";

const ENV_KEYS = ["SIP_PUBLIC_HOST", "SIP_SERVER", "PUBLIC_BASE_URL"] as const;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<
    (typeof ENV_KEYS)[number],
    string | undefined
  >;
  try {
    for (const k of ENV_KEYS) {
      const v = overrides[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("defaultSipServer prefers SIP_PUBLIC_HOST", () => {
  withEnv(
    { SIP_PUBLIC_HOST: "sip.example.com", PUBLIC_BASE_URL: "https://app.example.com:8443" },
    () => {
      assert.equal(defaultSipServer(), "sip.example.com");
    }
  );
});

test("defaultSipServer derives hostname from PUBLIC_BASE_URL", () => {
  withEnv(
    { SIP_PUBLIC_HOST: undefined, SIP_SERVER: undefined, PUBLIC_BASE_URL: "https://phonehome.family.net:8443" },
    () => {
      assert.equal(defaultSipServer(), "phonehome.family.net");
    }
  );
});

test("defaultSipServer returns empty when unset", () => {
  withEnv({ SIP_PUBLIC_HOST: undefined, SIP_SERVER: undefined, PUBLIC_BASE_URL: undefined }, () => {
    assert.equal(defaultSipServer(), "");
  });
});
