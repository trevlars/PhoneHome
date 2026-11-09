import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";

export type GatewayPushKind = "voip" | "alert";
export type GatewayPushRequest = {
  deviceToken: string;
  storedApnsEnv?: "sandbox" | "production" | null;
  payload: Record<string, unknown> & { callId: string };
  expirationSec?: number;
};
export type GatewayPushResult = {
  ok: boolean;
  status?: number;
  reason?: string;
  production?: boolean;
};

type ApnsConfig = {
  keyId: string;
  teamId: string;
  bundleId: string;
  keyPem: string;
  production: boolean;
};

function loadConfig(): ApnsConfig | null {
  const keyId = String(process.env.APNS_KEY_ID || "").trim();
  const teamId = String(process.env.APNS_TEAM_ID || "").trim();
  const bundleId = String(process.env.APNS_BUNDLE_ID || "app.phonehome.ios").trim();
  const production = /^(1|true)$/i.test(String(process.env.APNS_PRODUCTION || ""));
  const b64 = String(process.env.APNS_KEY_P8_BASE64 || "").trim();
  const keyPath = String(process.env.APNS_KEY_P8 || "").trim();
  const keyPem = b64
    ? Buffer.from(b64, "base64").toString("utf8")
    : keyPath && fs.existsSync(keyPath)
      ? fs.readFileSync(keyPath, "utf8")
      : "";
  if (!keyId || !teamId || !keyPem.includes("PRIVATE KEY")) return null;
  return { keyId, teamId, bundleId, keyPem, production };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function providerJwt(cfg: ApnsConfig): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = base64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(Date.now() / 1000) }));
  const unsigned = `${header}.${claims}`;
  const key = crypto.createPrivateKey(cfg.keyPem);
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${base64url(sig)}`;
}

export function apnsConfigured(): boolean {
  return Boolean(loadConfig());
}

export function normalizeDeviceToken(raw: string): string {
  return String(raw || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
}

export function isBadDeviceToken(status?: number, reason?: string): boolean {
  return status === 400 && String(reason || "").includes("BadDeviceToken");
}

export function resolveProduction(
  stored: string | null | undefined,
  configuredProduction: boolean
): boolean {
  if (stored === "production") return true;
  if (stored === "sandbox") return false;
  return configuredProduction;
}

function postApns(
  kind: GatewayPushKind,
  request: GatewayPushRequest,
  production: boolean
): Promise<GatewayPushResult> {
  const cfg = loadConfig();
  if (!cfg) return Promise.resolve({ ok: false, reason: "apns-not-configured", production });
  const token = normalizeDeviceToken(request.deviceToken);
  if (token.length < 16) return Promise.resolve({ ok: false, reason: "bad-token", production });
  const topic = kind === "voip" ? `${cfg.bundleId}.voip` : cfg.bundleId;
  const body =
    kind === "voip"
      ? JSON.stringify({
          aps: { "content-available": 1 },
          callId: request.payload.callId,
          handle: String(request.payload.handle || ""),
          callerName: String(request.payload.callerName || "Family").slice(0, 64),
          fromLineId: String(request.payload.fromLineId || ""),
          toLineId: String(request.payload.toLineId || ""),
        })
      : JSON.stringify({
          aps: {
            alert: {
              title: String(request.payload.title || "PhoneHome").slice(0, 64),
              body: String(request.payload.body || "PhoneHome call").slice(0, 120),
            },
            sound: "default",
            ...(typeof request.payload.badge === "number"
              ? { badge: Math.max(0, Math.min(99, Math.floor(request.payload.badge))) }
              : {}),
          },
          type: String(request.payload.type || "incoming_call"),
          callId: request.payload.callId,
          handle: String(request.payload.handle || ""),
          callerName: String(request.payload.callerName || "Family").slice(0, 64),
          fromLineId: String(request.payload.fromLineId || ""),
          toLineId: String(request.payload.toLineId || ""),
        });
  const host = production ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const expiration =
    request.expirationSec && request.expirationSec > 0
      ? String(Math.floor(Date.now() / 1000) + request.expirationSec)
      : "0";

  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    let done = false;
    const finish = (result: GatewayPushResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.close();
      resolve(result);
    };
    const timer = setTimeout(() => {
      client.destroy();
      finish({ ok: false, reason: "timeout", production });
    }, 12_000);
    client.on("error", (error) => finish({ ok: false, reason: error.message, production }));
    let stream: http2.ClientHttp2Stream;
    try {
      stream = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${providerJwt(cfg)}`,
        "apns-topic": topic,
        "apns-push-type": kind,
        "apns-priority": "10",
        "apns-expiration": expiration,
        "content-type": "application/json",
      });
    } catch (error) {
      finish({
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        production,
      });
      return;
    }
    let status = 0;
    let response = "";
    stream.on("error", (error) => finish({ ok: false, reason: error.message, production }));
    stream.on("response", (headers) => {
      status = Number(headers[":status"] || 0);
    });
    stream.on("data", (chunk) => {
      response += chunk;
    });
    stream.on("end", () => {
      finish(
        status >= 200 && status < 300
          ? { ok: true, status, production }
          : { ok: false, status, reason: response || `http-${status}`, production }
      );
    });
    stream.end(body);
  });
}

export async function sendGatewayPush(
  kind: GatewayPushKind,
  request: GatewayPushRequest
): Promise<GatewayPushResult> {
  const cfg = loadConfig();
  const first = resolveProduction(request.storedApnsEnv, cfg?.production ?? false);
  const result = await postApns(kind, request, first);
  if (result.ok || !cfg || !isBadDeviceToken(result.status, result.reason)) return result;
  return postApns(kind, request, !first);
}
