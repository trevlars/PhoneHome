import assert from "node:assert/strict";
import test from "node:test";
import {
  ataFreepbxSyncMode,
  clearPublicMediaIpCache,
  freepbxSipNotifyUrl,
  resolvePublicMediaIp,
  rebootAtaViaFreepbx,
  sha256Prefix,
  sipPublicHostFromEnv,
  syncAtaSipSecretToFreepbx,
} from "./freepbxSync.js";

test("sha256Prefix is stable and short", () => {
  assert.equal(sha256Prefix("abc"), sha256Prefix("abc"));
  assert.notEqual(sha256Prefix("abc"), sha256Prefix("abd"));
  assert.equal(sha256Prefix("abc").length, 16);
});

test("ataFreepbxSyncMode treats private hosts as lan and FQDNs as remote", () => {
  assert.equal(ataFreepbxSyncMode("192.168.2.105"), "lan");
  assert.equal(ataFreepbxSyncMode("192.168.2.105:5061"), "lan");
  assert.equal(ataFreepbxSyncMode("192.168.1.50"), "lan");
  assert.equal(ataFreepbxSyncMode("mothership.example"), "remote");
  assert.equal(ataFreepbxSyncMode("mothership.example:5061"), "remote");
  assert.equal(ataFreepbxSyncMode(""), "remote");
});

test("ataFreepbxSyncMode keeps mothership one-tap ATAs on lan even with public FQDN", () => {
  assert.equal(ataFreepbxSyncMode("mothership.example", { setupMode: "lan" }), "lan");
  assert.equal(ataFreepbxSyncMode("mothership.example", { setupMode: "download" }), "remote");
});

test("sipPublicHostFromEnv prefers SIP_PUBLIC_HOST then PUBLIC_BASE_URL", () => {
  const prevHost = process.env.SIP_PUBLIC_HOST;
  const prevBase = process.env.PUBLIC_BASE_URL;
  try {
    process.env.SIP_PUBLIC_HOST = "sip.example.com";
    process.env.PUBLIC_BASE_URL = "https://other.example.com:8443";
    assert.equal(sipPublicHostFromEnv(), "sip.example.com");
    delete process.env.SIP_PUBLIC_HOST;
    assert.equal(sipPublicHostFromEnv(), "other.example.com");
  } finally {
    if (prevHost === undefined) delete process.env.SIP_PUBLIC_HOST;
    else process.env.SIP_PUBLIC_HOST = prevHost;
    if (prevBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prevBase;
  }
});

test("resolvePublicMediaIp ignores the AdGuard hairpin and uses public DNS", async () => {
  clearPublicMediaIpCache();
  const prev = process.env.PHONEHOME_PUBLIC_MEDIA_IP;
  const prevSip = process.env.PHONEHOME_SIP_PUBLIC_IP;
  delete process.env.PHONEHOME_PUBLIC_MEDIA_IP;
  delete process.env.PHONEHOME_SIP_PUBLIC_IP;
  try {
    process.env.PHONEHOME_PUBLIC_MEDIA_IP = "192.168.2.31";
    const ip = await resolvePublicMediaIp({
      host: "mothership.example",
      lookupFn: async () => ({ address: "192.168.2.31", family: 4 }),
      publicLookupFn: async () => "50.36.49.13",
    });
    assert.equal(ip, "50.36.49.13");
  } finally {
    clearPublicMediaIpCache();
    if (prev === undefined) delete process.env.PHONEHOME_PUBLIC_MEDIA_IP;
    else process.env.PHONEHOME_PUBLIC_MEDIA_IP = prev;
    if (prevSip === undefined) delete process.env.PHONEHOME_SIP_PUBLIC_IP;
    else process.env.PHONEHOME_SIP_PUBLIC_IP = prevSip;
  }
});

test("resolvePublicMediaIp uses forced IP and DNS lookup", async () => {
  clearPublicMediaIpCache();
  const prev = process.env.PHONEHOME_PUBLIC_MEDIA_IP;
  try {
    process.env.PHONEHOME_PUBLIC_MEDIA_IP = "203.0.113.9";
    assert.equal(await resolvePublicMediaIp(), "203.0.113.9");
    delete process.env.PHONEHOME_PUBLIC_MEDIA_IP;
    const ip = await resolvePublicMediaIp({
      host: "sip.example.test",
      lookupFn: async () => ({ address: "198.51.100.7", family: 4 }),
    });
    assert.equal(ip, "198.51.100.7");
  } finally {
    clearPublicMediaIpCache();
    if (prev === undefined) delete process.env.PHONEHOME_PUBLIC_MEDIA_IP;
    else process.env.PHONEHOME_PUBLIC_MEDIA_IP = prev;
  }
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

test("sync posts media_address for remote mode (automagic from hub)", async () => {
  process.env.FREEPBX_SYNC_URL = "http://127.0.0.1:9/sip-secret";
  process.env.FREEPBX_SYNC_TOKEN = "test-token";
  process.env.FREEPBX_SYNC_ENV = "/tmp/phonehome-no-such-sync.env";
  process.env.SIP_PUBLIC_HOST = "mothership.example";
  clearPublicMediaIpCache();
  try {
    const posts: { url: string; auth?: string; body?: string }[] = [];
    const r = await syncAtaSipSecretToFreepbx("2002", "HousePhoneSecret99", {
      sipServer: "mothership.example",
      setupMode: "download",
      displayName: "Sam",
      lookupFn: async () => ({ address: "50.36.49.13", family: 4 }),
      fetchImpl: async (input, init) => {
        posts.push({
          url: String(input),
          auth: (init?.headers as Record<string, string>)?.Authorization,
          body: String(init?.body || ""),
        });
        return new Response(
          JSON.stringify({
            ok: true,
            secret_sha256: "abcd",
            created: true,
            mode: "remote",
            media_address: "50.36.49.13",
          }),
          { status: 200 }
        );
      },
    });
    assert.equal(r.ok, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.auth, "Bearer test-token");
    assert.match(posts[0]?.body || "", /"ext":"2002"/);
    assert.match(posts[0]?.body || "", /HousePhoneSecret99/);
    assert.match(posts[0]?.body || "", /"mode":"remote"/);
    assert.match(posts[0]?.body || "", /"media_address":"50\.36\.49\.13"/);
    assert.match(posts[0]?.body || "", /"sip_public_host":"mothership\.example"/);
    assert.match(posts[0]?.body || "", /"display_name":"Sam"/);
    assert.equal((r as { created?: boolean }).created, true);
  } finally {
    delete process.env.FREEPBX_SYNC_URL;
    delete process.env.FREEPBX_SYNC_TOKEN;
    delete process.env.SIP_PUBLIC_HOST;
    clearPublicMediaIpCache();
  }
});

test("sync lan mode omits media_address", async () => {
  process.env.FREEPBX_SYNC_URL = "http://127.0.0.1:9/sip-secret";
  process.env.FREEPBX_SYNC_TOKEN = "test-token";
  process.env.FREEPBX_SYNC_ENV = "/tmp/phonehome-no-such-sync.env";
  try {
    const posts: string[] = [];
    const r = await syncAtaSipSecretToFreepbx("2001", "HousePhoneSecret99", {
      setupMode: "lan",
      sipServer: "mothership.example",
      fetchImpl: async (_input, init) => {
        posts.push(String(init?.body || ""));
        return new Response(JSON.stringify({ ok: true, mode: "lan" }), { status: 200 });
      },
    });
    assert.equal(r.ok, true);
    assert.match(posts[0] || "", /"mode":"lan"/);
    assert.doesNotMatch(posts[0] || "", /media_address/);
  } finally {
    delete process.env.FREEPBX_SYNC_URL;
    delete process.env.FREEPBX_SYNC_TOKEN;
  }
});

test("freepbxSipNotifyUrl rewrites sip-secret to sip-notify", () => {
  assert.equal(
    freepbxSipNotifyUrl("http://192.168.2.31:8797/sip-secret"),
    "http://192.168.2.31:8797/sip-notify"
  );
  assert.equal(
    freepbxSipNotifyUrl("http://192.168.2.31:8797/sip-notify"),
    "http://192.168.2.31:8797/sip-notify"
  );
});

test("rebootAtaViaFreepbx posts event=reboot to /sip-notify", async () => {
  process.env.FREEPBX_SYNC_URL = "http://127.0.0.1:9/sip-secret";
  process.env.FREEPBX_SYNC_TOKEN = "test-token";
  process.env.FREEPBX_SYNC_ENV = "/tmp/phonehome-no-such-sync.env";
  try {
    const posts: { url: string; body: string }[] = [];
    const r = await rebootAtaViaFreepbx("2003", {
      fetchImpl: async (input, init) => {
        posts.push({ url: String(input), body: String(init?.body || "") });
        return new Response(
          JSON.stringify({ ok: true, ext: "2003", event: "reboot", detail: "Sending NOTIFY" }),
          { status: 200 }
        );
      },
    });
    assert.equal(r.ok, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.url, "http://127.0.0.1:9/sip-notify");
    assert.match(posts[0]?.body || "", /"ext":"2003"/);
    assert.match(posts[0]?.body || "", /"event":"reboot"/);
  } finally {
    delete process.env.FREEPBX_SYNC_URL;
    delete process.env.FREEPBX_SYNC_TOKEN;
  }
});

test("rebootAtaViaFreepbx skips when sync unset", async () => {
  const prevUrl = process.env.FREEPBX_SYNC_URL;
  const prevTok = process.env.FREEPBX_SYNC_TOKEN;
  const prevEnv = process.env.FREEPBX_SYNC_ENV;
  delete process.env.FREEPBX_SYNC_URL;
  delete process.env.FREEPBX_SYNC_TOKEN;
  process.env.FREEPBX_SYNC_ENV = "/tmp/phonehome-no-such-sync.env";
  try {
    const r = await rebootAtaViaFreepbx("2001", {
      fetchImpl: async () => new Response("nope"),
    });
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
