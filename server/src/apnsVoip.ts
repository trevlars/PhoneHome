/**
 * Apple Push Notification service — VoIP (PushKit) pushes.
 *
 * Env (AuthKey .p8 from Apple Developer → Keys):
 *   APNS_KEY_ID          10-char key id
 *   APNS_TEAM_ID         10-char team id
 *   APNS_BUNDLE_ID       app.phonehome.ios
 *   APNS_KEY_P8          path to AuthKey_XXX.p8  OR
 *   APNS_KEY_P8_BASE64   base64 of the .p8 PEM
 *   APNS_PRODUCTION      1 for api.push.apple.com (TestFlight/App Store)
 *
 * Without these, sendIosVoipPush logs and no-ops (dev-safe).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";

export type VoipPushPayload = {
  callId: string;
  handle: string;
  callerName: string;
  fromLineId?: string;
  toLineId?: string;
};

type ApnsConfig = {
  keyId: string;
  teamId: string;
  bundleId: string;
  keyPem: string;
  production: boolean;
};

function loadConfig(): ApnsConfig | null {
  const keyId = (process.env.APNS_KEY_ID || "").trim();
  const teamId = (process.env.APNS_TEAM_ID || "").trim();
  const bundleId = (process.env.APNS_BUNDLE_ID || "app.phonehome.ios").trim();
  const production = process.env.APNS_PRODUCTION === "1" || process.env.APNS_PRODUCTION === "true";
  let keyPem = "";
  const b64 = (process.env.APNS_KEY_P8_BASE64 || "").trim();
  const path = (process.env.APNS_KEY_P8 || "").trim();
  if (b64) {
    keyPem = Buffer.from(b64, "base64").toString("utf8");
  } else if (path && fs.existsSync(path)) {
    keyPem = fs.readFileSync(path, "utf8");
  }
  if (!keyId || !teamId || !keyPem.includes("PRIVATE KEY")) return null;
  return { keyId, teamId, bundleId, keyPem, production };
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function makeJwt(cfg: ApnsConfig): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: cfg.keyId })));
  const now = Math.floor(Date.now() / 1000);
  const claims = base64url(Buffer.from(JSON.stringify({ iss: cfg.teamId, iat: now })));
  const unsigned = `${header}.${claims}`;
  const key = crypto.createPrivateKey(cfg.keyPem);
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${base64url(sig)}`;
}

export function apnsConfigured(): boolean {
  return Boolean(loadConfig());
}

/**
 * Fire-and-forget VoIP push. CallKit on device must report the incoming call
 * before the push completion handler returns — native plugin does that.
 */
export async function sendIosVoipPush(
  deviceTokenHex: string,
  payload: VoipPushPayload
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log(
      `[apns] skip VoIP push callId=${payload.callId} (set APNS_KEY_ID / TEAM_ID / KEY_P8 to enable)`
    );
    return { ok: false, reason: "apns-not-configured" };
  }
  const token = deviceTokenHex.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (token.length < 16) return { ok: false, reason: "bad-token" };

  const host = cfg.production ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const path = `/3/device/${token}`;
  const body = JSON.stringify({
    aps: { "content-available": 1 },
    callId: payload.callId,
    handle: payload.handle,
    callerName: payload.callerName,
    fromLineId: payload.fromLineId || "",
    toLineId: payload.toLineId || "",
  });

  const jwt = makeJwt(cfg);
  const topic = `${cfg.bundleId}.voip`;

  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    client.on("error", (err) => {
      console.warn(`[apns] connect error:`, err.message);
      resolve({ ok: false, reason: err.message });
    });
    const req = client.request({
      ":method": "POST",
      ":path": path,
      authorization: `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": "voip",
      "apns-priority": "10",
      "apns-expiration": "0",
      "content-type": "application/json",
    });
    let status = 0;
    let resp = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] || 0);
    });
    req.on("data", (c) => {
      resp += c;
    });
    req.on("end", () => {
      client.close();
      if (status >= 200 && status < 300) {
        console.log(`[apns] VoIP ok callId=${payload.callId} token=…${token.slice(-8)}`);
        resolve({ ok: true, status });
      } else {
        console.warn(`[apns] VoIP fail status=${status} body=${resp.slice(0, 200)}`);
        resolve({ ok: false, status, reason: resp || `http-${status}` });
      }
    });
    req.end(body);
  });
}
