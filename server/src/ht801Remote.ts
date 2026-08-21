/**
 * Push-provision a Grandstream HT801 over its LAN web API (SPA CGI).
 * Browser cannot do this (CORS / mixed content) — PhoneHome server on the LAN can.
 *
 * Endpoints reverse-engineered from HT8xx web UI (lighttpd + Vue):
 *   POST /cgi-bin/dologin                         username + P2=base64(password)
 *   POST /cgi-bin/api-change_default_password     cur_pwd / new_pwd / user_name
 *   POST /cgi-bin/restore_cfg?session_token=…     multipart cfg_file  (Backup/Import XML)
 *   POST /cgi-bin/upload_cfg?session_token=…      multipart cfg_file  (txt/xml provision; not used)
 *   POST /cgi-bin/rs                              reboot
 *
 * HT801 V2 web UI: Import XML → restore_cfg; "upload configuration" → upload_cfg.
 * gs_provision XML must use restore_cfg — upload_cfg returns a lighttpd 500 HTML page.
 */

import { Buffer } from "node:buffer";
// Prefer node:undici when available; package import works on Node builds that omit the builtin.
import { Agent, fetch as undiciFetch } from "undici";

/** LAN ATA uses self-signed HTTPS; only used for private RFC1918 hosts (SSRF-guarded). */
const ataInsecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export type Ht801AdminPasswordRules = {
  ok: boolean;
  reason?: string;
};

/** Parent-facing admin password: 8–30 chars, upper+lower+digit, no specials. */
export function validateHt801AdminPassword(raw: string): Ht801AdminPasswordRules {
  const pwd = String(raw || "");
  if (pwd.length < 8 || pwd.length > 30) {
    return { ok: false, reason: "Password must be 8–30 characters" };
  }
  if (/[^A-Za-z0-9]/.test(pwd)) {
    return { ok: false, reason: "No special characters — letters and numbers only" };
  }
  if (!/[a-z]/.test(pwd) || !/[A-Z]/.test(pwd) || !/[0-9]/.test(pwd)) {
    return { ok: false, reason: "Need at least one uppercase, one lowercase, and one number" };
  }
  return { ok: true };
}

/** Only allow RFC1918 / CGNAT / link-local so we never SSRF into the public internet. */
export function assertPrivateAtaHost(host: string): string {
  const h = String(host || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  if (!h) throw new Error("Adapter IP is required");
  if (h.includes(":") && !h.startsWith("[")) {
    throw new Error("Use the adapter’s IPv4 address");
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) throw new Error("Adapter IP must look like 192.168.1.50");
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) throw new Error("Invalid adapter IP");
  const [a, b] = parts;
  const privateOk =
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127);
  if (!privateOk) throw new Error("Adapter IP must be on your home network (private address)");
  return parts.join(".");
}

export type Ht801PushInput = {
  host: string;
  currentPassword: string;
  newPassword: string;
  configXml: string;
  port?: number;
  fetchImpl?: typeof fetch;
  skipReboot?: boolean;
};

export type Ht801PushResult = {
  host: string;
  passwordChanged: boolean;
  uploaded: boolean;
  rebooted: boolean;
};

type GsJson = {
  response?: string;
  body?: unknown;
};

function encodeP2(password: string): string {
  return Buffer.from(String(password), "utf8").toString("base64");
}

function formBody(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

/**
 * HT801's lighttpd CGI 500s on undici/Node FormData+Blob multipart.
 * Hand-built multipart (same shape as curl -F) returns normal JSON.
 */
export function buildHt801CfgMultipart(xml: string, filename = "cfg.xml"): {
  contentType: string;
  body: Buffer;
} {
  const boundary = `----PhoneHomeBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="cfg_file"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([Buffer.from(head, "utf8"), Buffer.from(xml, "utf8"), Buffer.from(tail, "utf8")]),
  };
}

async function readJson(res: Response): Promise<GsJson> {
  const text = await res.text();
  try {
    return JSON.parse(text) as GsJson;
  } catch {
    throw new Error(`Adapter returned non-JSON (${res.status})`);
  }
}

function sessionFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const tok = b.session_token ?? b.sessionToken ?? b.token;
  return tok != null && String(tok) ? String(tok) : null;
}

function failReason(body: unknown, fallback: string): string {
  if (body == null) return fallback;
  if (typeof body === "string") return body || fallback;
  if (typeof body === "object" && body && "reason" in body) {
    return String((body as { reason?: unknown }).reason || fallback);
  }
  return fallback;
}

/** How long PhoneHome refuses further dologin attempts after remainN/locked (ms). */
const HT801_LOGIN_COOLDOWN_MS = 130_000;

/** host → epoch ms until we may attempt dologin again (in-process; agents + API share this). */
const ht801LoginCooldownUntil = new Map<string, number>();

export type Ht801LoginFailKind = "locked" | "remain" | "wrong_password" | "other";

/**
 * Auth failure that must abort all further login attempts (no password loops).
 * SIP/FXS can still work while the Grandstream web UI is locked.
 */
export class Ht801LoginAbortError extends Error {
  readonly abortRetries = true as const;
  readonly lockout: boolean;
  readonly kind: Ht801LoginFailKind;
  readonly host: string;
  readonly cooldownMs: number;

  constructor(opts: {
    message: string;
    kind: Ht801LoginFailKind;
    host: string;
    lockout?: boolean;
    cooldownMs?: number;
  }) {
    super(opts.message);
    this.name = "Ht801LoginAbortError";
    this.kind = opts.kind;
    this.host = opts.host;
    this.lockout = opts.lockout ?? (opts.kind === "locked" || opts.kind === "remain");
    this.cooldownMs = opts.cooldownMs ?? HT801_LOGIN_COOLDOWN_MS;
  }
}

export function isHt801LoginAbortError(err: unknown): err is Ht801LoginAbortError {
  return err instanceof Ht801LoginAbortError || Boolean((err as { abortRetries?: boolean })?.abortRetries);
}

function classifyLoginFail(reasonRaw: string): Ht801LoginFailKind {
  const reason = String(reasonRaw || "").trim();
  if (reason === "locked") return "locked";
  if (/^remain\d+$/i.test(reason)) return "remain";
  if (reason && reason !== "login failed") return "wrong_password";
  return "other";
}

/** True when PhoneHome must not hit /cgi-bin/dologin for this host yet. */
export function ht801LoginCooldownRemainingMs(host: string, now = Date.now()): number {
  try {
    const h = assertPrivateAtaHost(host);
    const until = ht801LoginCooldownUntil.get(h) || 0;
    return Math.max(0, until - now);
  } catch {
    return 0;
  }
}

/** Test helper — clear in-process cooldown. */
export function clearHt801LoginCooldown(host?: string): void {
  if (host) {
    try {
      ht801LoginCooldownUntil.delete(assertPrivateAtaHost(host));
    } catch {
      /* ignore */
    }
    return;
  }
  ht801LoginCooldownUntil.clear();
}

function armHt801LoginCooldown(host: string, ms = HT801_LOGIN_COOLDOWN_MS): void {
  ht801LoginCooldownUntil.set(host, Date.now() + ms);
}

/**
 * Grandstream returns body "remainN" (tries left) or "locked" after bad logins.
 * Map to parent-facing copy — never echo the password.
 */
export function ht801LoginFailMessage(reasonRaw: string): string {
  const reason = String(reasonRaw || "").trim();
  if (reason === "locked") {
    return (
      "Adapter web login is locked after too many wrong passwords — wait about 2 minutes (or power-cycle the adapter), then try once with the correct current password. " +
      "Do not retry sticker/admin guesses in a loop. SIP calling can still work while the web UI is locked. " +
      "Use the sticker password only if you never finished Set up adapter; otherwise use the new admin password you chose last time."
    );
  }
  const remain = /^remain(\d+)$/i.exec(reason);
  if (remain) {
    const n = Number(remain[1]);
    const tries = n === 1 ? "1 try" : `${n} tries`;
    return (
      `Wrong adapter password — ${tries} left before lockout. Stop and use the password from your last successful Set up adapter (sticker no longer works after that). ` +
      "Do not try alternate passwords automatically."
    );
  }
  return "Wrong adapter password (sticker if never changed, or the new password from last setup). Try once — do not loop guesses.";
}

/** Parent-facing copy when PhoneHome cannot reach the ATA over LAN HTTPS. */
export function ht801UnreachableMessage(host: string, errMsg: string): string {
  const ip = host || "?";
  const msg = String(errMsg || "");
  if (/ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|ECONNRESET|ETIMEDOUT|abort|timeout/i.test(msg)) {
    return (
      `Can't reach the adapter at ${ip}. Check the IP on the router or adapter sticker — ` +
      "PhoneHome must be on the same home network. Use Download config if the hub can't reach it."
    );
  }
  if (/certificate|TLS|SSL|UNABLE_TO_VERIFY|self.?signed|CERT_/i.test(msg)) {
    return (
      `Can't talk to the adapter at ${ip} over HTTPS. Open https://${ip} on your home network to confirm, ` +
      "or use Download config."
    );
  }
  if (/fetch failed|network/i.test(msg)) {
    return (
      `Can't reach the adapter at ${ip}. Confirm that IP is correct and the adapter is powered on, ` +
      "then try again — or use Download config."
    );
  }
  return msg || `Can't reach the adapter at ${ip}`;
}

function defaultAtaFetch(): typeof fetch {
  // undici Agent disables TLS verify for private LAN ATA self-signed certs only.
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as object),
      dispatcher: ataInsecureAgent,
    })) as typeof fetch;
}

/**
 * Single login attempt only. Never call this in a password-guess loop.
 * On remainN/locked, arms a per-host cooldown so later API/agent calls refuse without hitting the ATA.
 */
export async function pushHt801Config(input: Ht801PushInput): Promise<Ht801PushResult> {
  const host = assertPrivateAtaHost(input.host);
  const port = input.port && input.port > 0 ? input.port : 443;
  const base = `https://${host}:${port}`;
  const fetchFn = input.fetchImpl || defaultAtaFetch();

  const cooldownLeft = ht801LoginCooldownRemainingMs(host);
  if (cooldownLeft > 0) {
    const secs = Math.ceil(cooldownLeft / 1000);
    throw new Ht801LoginAbortError({
      host,
      kind: "locked",
      lockout: true,
      cooldownMs: cooldownLeft,
      message:
        `Adapter web login is in cooldown after a failed/locked attempt — wait ~${secs}s (or power-cycle), then try once with the correct current password. ` +
        "No further login attempts from PhoneHome until then.",
    });
  }

  const cur = String(input.currentPassword || "");
  const next = String(input.newPassword || "");
  if (!cur) throw new Error("Current adapter password is required");
  const rules = validateHt801AdminPassword(next);
  if (!rules.ok) throw new Error(rules.reason || "Invalid new password");
  if (!String(input.configXml || "").includes("<gs_provision")) {
    throw new Error("Internal error: missing HT801 config XML");
  }

  // 1) Login — exactly one dologin per push. Never retry with alternate passwords here.
  let loginJson: GsJson;
  try {
    const loginRes = await fetchFn(`${base}/cgi-bin/dologin`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ username: "admin", P2: encodeP2(cur) }),
      signal: AbortSignal.timeout(8000),
    });
    loginJson = await readJson(loginRes);
  } catch (e) {
    if (isHt801LoginAbortError(e)) throw e;
    const msg = (e as Error).message || String(e);
    if (
      /abort|timeout|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ETIMEDOUT|fetch failed|network|certificate|TLS|SSL|UNABLE_TO_VERIFY|CERT_/i.test(
        msg
      )
    ) {
      throw new Error(ht801UnreachableMessage(host, msg));
    }
    throw e instanceof Error ? e : new Error(String(e));
  }

  if (loginJson.response !== "success") {
    const reason = failReason(loginJson.body, "login failed");
    const kind = classifyLoginFail(reason);
    // remainN and locked both mean stop — another guess burns the last try or extends lock.
    if (kind === "locked" || kind === "remain" || kind === "wrong_password") {
      armHt801LoginCooldown(host);
      throw new Ht801LoginAbortError({
        host,
        kind,
        lockout: kind === "locked" || kind === "remain",
        message: ht801LoginFailMessage(reason),
      });
    }
    throw new Error(ht801LoginFailMessage(reason));
  }

  // Success clears any prior cooldown for this host.
  ht801LoginCooldownUntil.delete(host);

  let session = sessionFrom(loginJson.body);
  if (!session) throw new Error("Adapter login succeeded but no session token");

  let passwordChanged = false;

  // 2) Set parent-chosen admin password (also written into XML as P2)
  if (next !== cur) {
    const chRes = await fetchFn(`${base}/cgi-bin/api-change_default_password`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        cur_pwd: cur,
        new_pwd: next,
        user_name: "admin",
        session_token: session,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const chJson = await readJson(chRes);
    if (chJson.response !== "success") {
      throw new Error(`Could not set new adapter password (${failReason(chJson.body, "rejected")})`);
    }
    const newTok = sessionFrom(chJson.body);
    if (newTok) session = newTok;
    passwordChanged = true;
  }

  // 3) Upload configuration XML via Backup/Import (restore_cfg). Same path as the
  // parent manual flow. Must use hand-built multipart — Node FormData/Blob 500s the CGI.
  const multipart = buildHt801CfgMultipart(input.configXml);
  const upRes = await fetchFn(
    `${base}/cgi-bin/restore_cfg?session_token=${encodeURIComponent(session)}`,
    {
      method: "POST",
      headers: { "Content-Type": multipart.contentType },
      body: multipart.body as unknown as BodyInit,
      signal: AbortSignal.timeout(60000),
    }
  );
  const upText = await upRes.text();
  let upOk = false;
  try {
    const upJson = JSON.parse(upText) as GsJson;
    upOk = upJson.response === "success" || /success/i.test(JSON.stringify(upJson.body ?? ""));
    if (!upOk) {
      const why = failReason(upJson.body, "upload rejected");
      if (/invalid file/i.test(why)) throw new Error("Adapter rejected the config file (invalid file)");
      if (/upload locked|provision locked/i.test(why)) {
        throw new Error("Adapter config upload is locked — wait a minute, or power-cycle, then try once");
      }
      if (/busy/i.test(why)) throw new Error("Adapter is busy — wait a moment and try once");
      throw new Error(`Config upload rejected (${why})`);
    }
  } catch (e) {
    if (upOk) {
      /* already accepted */
    } else if (/success|ok|reboot|needreboot/i.test(upText) && upRes.ok) {
      upOk = true;
    } else if (/<html|Internal Server Error|<!DOCTYPE/i.test(upText)) {
      throw new Error(
        `Config upload failed (HTTP ${upRes.status}). Try Download config and import it on the adapter, or power-cycle and retry once.`
      );
    } else if (e instanceof Error && e.message && !e.message.includes("JSON")) {
      throw e;
    } else {
      throw new Error(`Config upload failed: ${upText.slice(0, 160) || upRes.status}`);
    }
  }

  // 4) Reboot so SIP + password apply
  let rebooted = false;
  if (!input.skipReboot) {
    try {
      await fetchFn(`${base}/cgi-bin/rs`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ session_token: session }),
        signal: AbortSignal.timeout(8000),
      });
      rebooted = true;
    } catch {
      rebooted = false;
    }
  }

  return { host, passwordChanged, uploaded: true, rebooted };
}
