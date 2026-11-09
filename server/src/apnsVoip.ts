/**
 * Apple Push Notification service — VoIP (PushKit) and standard alert pushes.
 *
 * Env (AuthKey .p8 from Apple Developer → Keys):
 *   APNS_KEY_ID          10-char key id
 *   APNS_TEAM_ID         10-char team id
 *   APNS_BUNDLE_ID       app.phonehome.ios
 *   APNS_KEY_P8          path to AuthKey_XXX.p8  OR
 *   APNS_KEY_P8_BASE64   base64 of the .p8 PEM
 *   APNS_PRODUCTION      1 prefer production first; omit to prefer sandbox.
 *                        BadDeviceToken retries the other host (Xcode + TestFlight mix).
 *   IOS_CALLKIT          auto (default) — VoIP if the line has a VoIP token,
 *                        otherwise alert APNs. 0 / alert = never VoIP.
 *                        1 / voip = prefer VoIP when a token exists.
 *
 * Without APNs key env, send helpers log and no-op (dev-safe).
 *
 * Note: PushKit VoIP requires reporting every push to CallKit. Tokens are only
 * registered after the iOS app enables Lock-screen Answer. IOS_CALLKIT=0 is a
 * hub kill switch (alert only). Killed-app wake via alert APNs is less reliable.
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

export type AlertPushPayload = VoipPushPayload & {
  /** Notification title (default PhoneHome). */
  title?: string;
  /** Notification body (default “Call from …”). */
  body?: string;
  /** Client routing: incoming_call (default) or voicemail. */
  type?: "incoming_call" | "voicemail" | string;
  /** Optional app-icon badge count. */
  badge?: number;
};

/** Build APNs alert JSON body (exported for tests). */
export function buildAlertPushBody(payload: AlertPushPayload): string {
  const caller = (payload.callerName || "Family").trim().slice(0, 64) || "Family";
  const title = (payload.title || "PhoneHome").trim().slice(0, 64) || "PhoneHome";
  const bodyText =
    (payload.body || `Call from ${caller}`).trim().slice(0, 120) || `Call from ${caller}`;
  const type = String(payload.type || "incoming_call").trim() || "incoming_call";
  const aps: Record<string, unknown> = {
    alert: { title, body: bodyText },
    sound: "default",
  };
  if (typeof payload.badge === "number" && Number.isFinite(payload.badge) && payload.badge >= 0) {
    aps.badge = Math.min(99, Math.floor(payload.badge));
  }
  return JSON.stringify({
    aps,
    type,
    callId: payload.callId,
    handle: payload.handle,
    callerName: caller,
    fromLineId: payload.fromLineId || "",
    toLineId: payload.toLineId || "",
  });
}

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

export type IosCallKitMode = "auto" | "voip" | "alert";

/** Hub wake mode. Default auto — VoIP only when a device registered a VoIP token. */
export function iosCallKitMode(): IosCallKitMode {
  const v = (process.env.IOS_CALLKIT || process.env.CALLKIT_ENABLED || "auto").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "voip") return "voip";
  if (v === "0" || v === "false" || v === "no" || v === "alert") return "alert";
  return "auto";
}

/** True unless the hub is forced to alert-only (`IOS_CALLKIT=0`). */
export function iosCallKitPushEnabled(): boolean {
  return iosCallKitMode() !== "alert";
}

/**
 * Send PushKit VoIP when the hub allows it *and* this line has a VoIP token.
 * Devices only register a token after CallKit is enabled on the phone.
 */
export function shouldSendVoipPush(hasVoipTokens: boolean): boolean {
  if (!iosCallKitPushEnabled()) return false;
  return Boolean(hasVoipTokens);
}

export type ApnsSendResult = {
  ok: boolean;
  status?: number;
  reason?: string;
  /** Host used for this attempt / the successful retry. */
  production?: boolean;
};

/** Prefer the token's last-known APNs host; otherwise the hub APNS_PRODUCTION default. */
export function resolveApnsProduction(
  storedEnv: string | null | undefined,
  cfgProduction: boolean
): boolean {
  const e = String(storedEnv || "").trim().toLowerCase();
  if (e === "production") return true;
  if (e === "sandbox") return false;
  return cfgProduction;
}

export function apnsEnvName(production: boolean): "production" | "sandbox" {
  return production ? "production" : "sandbox";
}

export function isApnsBadDeviceToken(status?: number, reason?: string): boolean {
  if (status !== 400) return false;
  return String(reason || "").includes("BadDeviceToken");
}

function apnsHost(production: boolean): string {
  return production ? "api.push.apple.com" : "api.sandbox.push.apple.com";
}

function postApns(opts: {
  tokenHex: string;
  topic: string;
  pushType: "voip" | "alert";
  body: string;
  callId: string;
  label: string;
  production: boolean;
  expirationSec?: number;
}): Promise<ApnsSendResult> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log(
      `[apns] skip ${opts.label} callId=${opts.callId} (set APNS_KEY_ID / TEAM_ID / KEY_P8 to enable)`
    );
    return Promise.resolve({ ok: false, reason: "apns-not-configured", production: opts.production });
  }
  const token = opts.tokenHex.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (token.length < 16) {
    return Promise.resolve({ ok: false, reason: "bad-token", production: opts.production });
  }

  const host = apnsHost(opts.production);
  const path = `/3/device/${token}`;
  const jwt = makeJwt(cfg);
  const expiration =
    opts.expirationSec != null && opts.expirationSec > 0
      ? String(Math.floor(Date.now() / 1000) + opts.expirationSec)
      : "0";

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ApnsSendResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        client.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const client = http2.connect(`https://${host}`);
    const timer = setTimeout(() => {
      console.warn(
        `[apns] ${opts.label} timeout ${apnsEnvName(opts.production)} callId=${opts.callId}`
      );
      try {
        client.destroy();
      } catch {
        /* ignore */
      }
      finish({ ok: false, reason: "timeout", production: opts.production });
    }, 12_000);

    client.on("error", (err) => {
      console.warn(`[apns] connect error (${apnsEnvName(opts.production)}):`, err.message);
      finish({ ok: false, reason: err.message, production: opts.production });
    });

    let req: http2.ClientHttp2Stream;
    try {
      req = client.request({
        ":method": "POST",
        ":path": path,
        authorization: `bearer ${jwt}`,
        "apns-topic": opts.topic,
        "apns-push-type": opts.pushType,
        "apns-priority": "10",
        "apns-expiration": expiration,
        "content-type": "application/json",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[apns] request error (${apnsEnvName(opts.production)}):`, message);
      finish({ ok: false, reason: message, production: opts.production });
      return;
    }

    let status = 0;
    let resp = "";
    req.on("error", (err) => {
      console.warn(`[apns] stream error (${apnsEnvName(opts.production)}):`, err.message);
      finish({ ok: false, reason: err.message, production: opts.production });
    });
    req.on("response", (headers) => {
      status = Number(headers[":status"] || 0);
    });
    req.on("data", (c) => {
      resp += c;
    });
    req.on("end", () => {
      if (status >= 200 && status < 300) {
        console.log(
          `[apns] ${opts.label} ok ${apnsEnvName(opts.production)} callId=${opts.callId} token=…${token.slice(-8)}`
        );
        finish({ ok: true, status, production: opts.production });
      } else {
        console.warn(
          `[apns] ${opts.label} fail ${apnsEnvName(opts.production)} status=${status} body=${resp.slice(0, 200)}`
        );
        finish({
          ok: false,
          status,
          reason: resp || `http-${status}`,
          production: opts.production,
        });
      }
    });
    req.end(opts.body);
  });
}

/** Send, then retry the other APNs host on BadDeviceToken (Xcode vs TestFlight mix). */
async function sendWithEnvFallback(opts: {
  tokenHex: string;
  topic: string;
  pushType: "voip" | "alert";
  body: string;
  callId: string;
  label: string;
  storedEnv?: string | null;
  expirationSec?: number;
}): Promise<ApnsSendResult> {
  const cfg = loadConfig();
  const first = resolveApnsProduction(opts.storedEnv, cfg?.production ?? false);
  const result = await postApns({ ...opts, production: first });
  if (result.ok || !cfg || !isApnsBadDeviceToken(result.status, result.reason)) {
    return result;
  }
  const second = !first;
  console.warn(
    `[apns] ${opts.label} retry ${apnsEnvName(second)} after BadDeviceToken callId=${opts.callId}`
  );
  return postApns({ ...opts, production: second });
}

/**
 * Fire-and-forget VoIP push. CallKit on device must report the incoming call
 * before the push completion handler returns — native plugin does that.
 * Only use when the callee line has a VoIP token (CallKit enabled on device).
 */
export async function sendIosVoipPush(
  deviceTokenHex: string,
  payload: VoipPushPayload,
  storedEnv?: string | null
): Promise<ApnsSendResult> {
  const cfg = loadConfig();
  const topic = `${(cfg?.bundleId || "app.phonehome.ios")}.voip`;
  const body = JSON.stringify({
    aps: { "content-available": 1 },
    callId: payload.callId,
    handle: payload.handle,
    callerName: payload.callerName,
    fromLineId: payload.fromLineId || "",
    toLineId: payload.toLineId || "",
  });
  return sendWithEnvFallback({
    tokenHex: deviceTokenHex,
    topic,
    pushType: "voip",
    body,
    callId: payload.callId,
    label: "VoIP",
    storedEnv,
    expirationSec: 30,
  });
}

/**
 * Standard alert APNs — tap opens the app to the in-app softphone ring/answer card.
 * Does not use PushKit; no CallKit requirement. Killed-app delivery is less reliable than VoIP.
 */
export async function sendIosAlertPush(
  deviceTokenHex: string,
  payload: AlertPushPayload,
  storedEnv?: string | null
): Promise<ApnsSendResult> {
  const cfg = loadConfig();
  const topic = cfg?.bundleId || "app.phonehome.ios";
  // Visible banner only — do not mix content-available (silent wake). Without
  // UIBackgroundModes remote-notification, mixed payloads are dropped when the
  // app is backgrounded or killed.
  const body = buildAlertPushBody(payload);
  const label = payload.type === "voicemail" ? "voicemail-alert" : "alert";
  return sendWithEnvFallback({
    tokenHex: deviceTokenHex,
    topic,
    pushType: "alert",
    body,
    callId: payload.callId,
    label,
    storedEnv,
    expirationSec: payload.type === "voicemail" ? 3600 : 60,
  });
}
