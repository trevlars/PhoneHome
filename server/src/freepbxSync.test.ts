import assert from "node:assert/strict";
import test from "node:test";
import { sha256Prefix, syncAtaSipSecretToFreepbx } from "./freepbxSync.js";

test("sha256Prefix is stable and short", () => {
  assert.equal(sha256Prefix("abc"), sha256Prefix("abc"));
  assert.notEqual(sha256Prefix("abc"), sha256Prefix("abd"));
  assert.equal(sha256Prefix("abc").length, 16);
});

test("sync no-ops when FREEPBX_SYNC is unset", async () => {
  const prevUrl = process.env.FREEPBX_SYNC_URL;
  const prevTok = process.env.FREEPBX_SYNC_TOKEN;
  const prevEnv = process.env.FREEPBX_SYNC_ENV;
  delete process.env.FREEPBX_SYNC_URL;
  delete process.env.FREEPBX_SYNC_TOKEN;
  process.env.FREEPBX_SYNC_ENV = "/tmp/phonehome-no-such-sync.env";
  try {
    let fetched = 0;
    const r = await syncAtaSipSecretToFreepbx("2001", "HousePhoneSecret99", {
      fetchImpl: async () => {
        fetched += 1;
        return new Response("nope");
      },
    });
    assert.equal(fetched, 0);
    assert.equal(r.ok, true);
    assert.equal((r as { skipped?: boolean }).skipped, true);
  } finally {
    if (prevUrl === undefined) delete process.env.FREEPBX_SYNC_URL;
    else process.env.FREEPBX_SYNC_URL = prevUrl;
    if (prevTok === undefined) delete process.env.FREEPBX_SYNC_TOKEN;
    else process.env.FREEPBX_SYNC_TOKEN = prevTok;
    if (prevEnv === undefined) delete process.env.FREEPBX_SYNC_ENV;
    else process.env.FREEPBX_SYNC_ENV = prevEnv;
  }
});

test("sync posts ext+secret and never treats HTTP error as ok", async () => {
  process.env.FREEPBX_SYNC_URL = "http://127.0.0.1:9/sip-secret";
  process.env.FREEPBX_SYNC_TOKEN = "test-token";
  process.env.FREEPBX_SYNC_ENV = "/tmp/phonehome-no-such-sync.env";
  try {
    const posts: { url: string; auth?: string; body?: string }[] = [];
    const r = await syncAtaSipSecretToFreepbx("2001", "HousePhoneSecret99", {
      fetchImpl: async (input, init) => {
        posts.push({
          url: String(input),
          auth: (init?.headers as Record<string, string>)?.Authorization,
          body: String(init?.body || ""),
        });
        return new Response(JSON.stringify({ ok: true, secret_sha256: "abcd" }), { status: 200 });
      },
    });
    assert.equal(r.ok, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.auth, "Bearer test-token");
    assert.match(posts[0]?.body || "", /"ext":"2001"/);
    assert.match(posts[0]?.body || "", /HousePhoneSecret99/);
  } finally {
    delete process.env.FREEPBX_SYNC_URL;
    delete process.env.FREEPBX_SYNC_TOKEN;
  }
});
