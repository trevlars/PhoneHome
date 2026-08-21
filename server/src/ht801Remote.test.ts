import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrivateAtaHost,
  buildHt801CfgMultipart,
  clearHt801LoginCooldown,
  ht801LoginCooldownRemainingMs,
  ht801LoginFailMessage,
  ht801UnreachableMessage,
  Ht801LoginAbortError,
  isHt801LoginAbortError,
  pushHt801Config,
  validateHt801AdminPassword,
} from "./ht801Remote.js";

test("buildHt801CfgMultipart is curl-shaped (not undici FormData)", () => {
  const { contentType, body } = buildHt801CfgMultipart("<gs_provision/>", "cfg.xml");
  assert.match(contentType, /^multipart\/form-data; boundary=----PhoneHomeBoundary/);
  const text = body.toString("utf8");
  assert.match(text, /Content-Disposition: form-data; name="cfg_file"; filename="cfg\.xml"/);
  assert.match(text, /<gs_provision\/>/);
  assert.ok(text.endsWith("--\r\n") || /--PhoneHomeBoundary[^\r\n]+--\r\n$/.test(text));
});

test("validateHt801AdminPassword enforces Grandstream-friendly rules", () => {
  assert.equal(validateHt801AdminPassword("short").ok, false);
  assert.equal(validateHt801AdminPassword("alllowercase1").ok, false);
  assert.equal(validateHt801AdminPassword("ALLUPPERCASE1").ok, false);
  assert.equal(validateHt801AdminPassword("NoNumberHere").ok, false);
  assert.equal(validateHt801AdminPassword("Bad!Char1").ok, false);
  assert.equal(validateHt801AdminPassword("HousePhone1").ok, true);
});

test("ht801LoginFailMessage explains remainN and locked", () => {
  assert.match(ht801LoginFailMessage("remain3"), /3 tries left/i);
  assert.match(ht801LoginFailMessage("remain1"), /1 try left/i);
  assert.match(ht801LoginFailMessage("locked"), /wait about 2 minutes|power-cycle/i);
  assert.match(ht801LoginFailMessage("nope"), /sticker|last setup/i);
});

test("ht801UnreachableMessage includes IP and distinguishes refuse vs TLS", () => {
  assert.match(ht801UnreachableMessage("10.0.4.42", "connect ECONNREFUSED 10.0.4.42:443"), /10\.0\.4\.42/);
  assert.match(ht801UnreachableMessage("10.0.4.42", "connect ECONNREFUSED"), /router|sticker/i);
  assert.doesNotMatch(ht801UnreachableMessage("10.0.4.42", "connect ECONNREFUSED"), /same Wi/);
  assert.match(ht801UnreachableMessage("10.0.4.42", "unable to verify the first certificate"), /HTTPS/i);
  assert.match(ht801UnreachableMessage("10.0.4.43", "fetch failed"), /10\.0\.4\.43/);
});

test("assertPrivateAtaHost allows home LAN only", () => {
  assert.equal(assertPrivateAtaHost("192.168.1.50"), "192.168.1.50");
  assert.equal(assertPrivateAtaHost("10.0.4.42"), "10.0.4.42");
  assert.equal(assertPrivateAtaHost("http://172.16.0.9:80/"), "172.16.0.9");
  assert.throws(() => assertPrivateAtaHost("8.8.8.8"), /home network|private/i);
  assert.throws(() => assertPrivateAtaHost("not-an-ip"), /look like|must look/i);
});

test("pushHt801Config uses https:// by default (mock fetchImpl)", async () => {
  clearHt801LoginCooldown("10.0.4.42");
  const calls: { url: string; method?: string; body?: string; contentType?: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    let body = "";
    if (typeof init?.body === "string") body = init.body;
    else if (Buffer.isBuffer(init?.body)) body = init.body.toString("utf8");
    else if (init?.body && typeof (init.body as FormData).get === "function") {
      body = "multipart:cfg_file";
    }
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, method, body, contentType: headers?.["Content-Type"] || headers?.["content-type"] });

    if (url.includes("/cgi-bin/dologin")) {
      return new Response(JSON.stringify({ response: "success", body: { session_token: "tok1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/cgi-bin/api-change_default_password")) {
      return new Response(
        JSON.stringify({ response: "success", body: { session_token: "tok2" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/cgi-bin/restore_cfg")) {
      return new Response(JSON.stringify({ response: "success", body: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/cgi-bin/rs")) {
      return new Response(JSON.stringify({ response: "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("nope", { status: 404 });
  };

  const result = await pushHt801Config({
    host: "10.0.4.42",
    currentPassword: "admin",
    newPassword: "HousePhone1",
    configXml: `<?xml version="1.0"?><gs_provision version="1"><config></config></gs_provision>`,
    fetchImpl,
  });

  assert.equal(result.host, "10.0.4.42");
  assert.equal(result.passwordChanged, true);
  assert.equal(result.uploaded, true);
  assert.equal(result.rebooted, true);
  assert.ok(calls.every((c) => c.url.startsWith("https://10.0.4.42:443/")));
  assert.ok(calls.some((c) => c.url.includes("/cgi-bin/dologin")));
  assert.ok(calls.some((c) => c.url.includes("/cgi-bin/api-change_default_password")));
  assert.ok(calls.some((c) => c.url.includes("/cgi-bin/restore_cfg")));
  assert.ok(calls.some((c) => c.url.includes("/cgi-bin/rs")));
  const login = calls.find((c) => c.url.includes("dologin"));
  assert.ok(login?.body?.includes("P2=YWRtaW4%3D") || login?.body?.includes("P2=YWRtaW4="));
  const up = calls.find((c) => c.url.includes("restore_cfg"));
  assert.match(String(up?.contentType || ""), /multipart\/form-data; boundary=/);
  assert.match(String(up?.body || ""), /name="cfg_file"/);
  assert.match(String(up?.body || ""), /gs_provision/);
});

test("pushHt801Config maps network errors to IP-aware message", async () => {
  clearHt801LoginCooldown("10.0.4.43");
  const fetchImpl: typeof fetch = async () => {
    throw new Error("connect ECONNREFUSED 10.0.4.43:443");
  };
  await assert.rejects(
    () =>
      pushHt801Config({
        host: "10.0.4.43",
        currentPassword: "admin",
        newPassword: "HousePhone1",
        configXml: `<gs_provision version="1"><config></config></gs_provision>`,
        fetchImpl,
      }),
    (err: unknown) => {
      assert.match((err as Error).message, /10\.0\.4\.43/);
      assert.match((err as Error).message, /router|sticker/i);
      assert.doesNotMatch((err as Error).message, /same Wi/);
      return true;
    }
  );
});

test("pushHt801Config maps remainN lockouts to clear errors", async () => {
  clearHt801LoginCooldown("10.0.4.42");
  let logins = 0;
  const fetchImpl: typeof fetch = async () => {
    logins += 1;
    return new Response(JSON.stringify({ response: "error", body: "remain2" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  await assert.rejects(
    () =>
      pushHt801Config({
        host: "10.0.4.42",
        currentPassword: "admin",
        newPassword: "HousePhone1",
        configXml: `<gs_provision version="1"><config></config></gs_provision>`,
        fetchImpl,
      }),
    (err: unknown) => {
      assert.ok(isHt801LoginAbortError(err));
      assert.equal((err as Ht801LoginAbortError).kind, "remain");
      assert.match((err as Error).message, /2 tries left/i);
      return true;
    }
  );
  assert.equal(logins, 1, "exactly one dologin — no password retry loop");
  assert.ok(ht801LoginCooldownRemainingMs("10.0.4.42") > 0);

  // Second push must not hit the ATA again during cooldown
  logins = 0;
  await assert.rejects(
    () =>
      pushHt801Config({
        host: "10.0.4.42",
        currentPassword: "otherGuess",
        newPassword: "HousePhone1",
        configXml: `<gs_provision version="1"><config></config></gs_provision>`,
        fetchImpl,
      }),
    /cooldown/i
  );
  assert.equal(logins, 0, "cooldown blocks further dologin");
  clearHt801LoginCooldown("10.0.4.42");
});

test("pushHt801Config rejects public IPs before fetch", async () => {
  await assert.rejects(
    () =>
      pushHt801Config({
        host: "1.1.1.1",
        currentPassword: "admin",
        newPassword: "HousePhone1",
        configXml: `<gs_provision></gs_provision>`,
        fetchImpl: async () => new Response("no"),
      }),
    /home network|private/i
  );
});
