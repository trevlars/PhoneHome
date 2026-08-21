import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  addAllowlist,
  addGuardianByUsername,
  addLine,
  bootstrapAdmin,
  canCall,
  canManageChild,
  canManageHouseholdChildState,
  createGuardianInvite,
  createHousehold,
  createInvite,
  canCreateHouseholdInvite,
  declineAllowlist,
  endCallLog,
  expireStaleRings,
  expireStaleAnswered,
  finalizeOrphanAnsweredCalls,
  markCallAnswered,
  RING_TIMEOUT_MS,
  MAX_ACTIVE_CALL_MS,
  householdSnapshot,
  linePresenceOnline,
  listAtaDevices,
  listGuardians,
  logCall,
  loginWithPassword,
  loginWithSetupCode,
  publicUser,
  redeemGuardianInvite,
  redeemInvite,
  registerParent,
  leaveVoicemailForContact,
  deleteVoicemail,
  deleteVoicemails,
  lineAnsweringMachineOn,
  removeAllowlist,
  removeGuardian,
  resetChildPasswordByGuardian,
  setChildLineLogin,
  setLineGreeting,
  clearLineGreeting,
  confirmLineGreeting,
  isChildOnlyAccount,
  canHearLineGreeting,
  canEditLineGreeting,
  setLineAvatar,
  clearLineAvatar,
  canEditLineAvatar,
  canViewLineAvatar,
  setUserCredentials,
  updateAllowlistEntry,
  updateHouseholdRules,
  updateLine,
  verifyParentPin,
  publicHousehold,
  userInHousehold,
  normalizePin,
  setLiveCall,
  clearLiveCall,
  clearLiveCallsForLine,
  liveCallsForHousehold,
  getSessionUser,
  getAtaByLineId,
  getAtaByProvisionToken,
  upsertAtaDevice,
  deleteAtaDevice,
  deleteChildLine,
  deleteParentAccount,
  publicAta,
  defaultSipServer,
  ataConfigXmlForDevice,
  ataConfigTxtForDevice,
  ataConfigForDevice,
  resolveAtaDial,
  resolveAtaMailbox,
  listAtaMailboxMessages,
  routeCallTarget,
  createBridgeSession,
} from "./api.js";
import { formatConfigServerPath, normalizeAtaModel } from "./ht801.js";
import {
  isHt801LoginAbortError,
  pushHt801Config,
  validateHt801AdminPassword,
} from "./ht801Remote.js";
import { formatFanvilProvisionUrl } from "./g100s.js";
import {
  deriveAtaStatus,
  parseBridgeSipStatus,
  unknownSipStatus,
  type AtaStatusKind,
  type BridgeSipStatus,
} from "./ataStatus.js";
import { freepbxSyncConfigured, syncAtaSipSecretToFreepbx } from "./freepbxSync.js";
import { openDb, type LineType } from "./db.js";
import { listIosVoipTokensForLine, upsertIosVoipToken } from "./pushDevices.js";
import { apnsConfigured, sendIosVoipPush } from "./apnsVoip.js";

/**
 * Remote Download config is only safe if FreePBX already holds this secret.
 * Sync first; if sync is configured and fails, refuse the download so parents
 * never install a file that cannot REGISTER.
 */
async function ensureFreepbxHasAtaSecret(ata: {
  sip_extension: string;
  sip_password: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sync = await syncAtaSipSecretToFreepbx(ata.sip_extension, ata.sip_password);
  if (sync.ok) return { ok: true };
  console.warn(
    `[freepbx-sync] fail ext=${ata.sip_extension} err=${sync.error} (download blocked)`
  );
  return {
    ok: false,
    error:
      "Couldn’t sync the SIP password to the phone system. Try again in a minute — " +
      "don’t upload an old Download until this succeeds, or the adapter won’t register.",
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "kids-landline.db");
const WEB_DIR = path.join(ROOT, "web", "public");

function buildIceServers(): RTCIceServerLike[] {
  const servers: RTCIceServerLike[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const turnUrls = (process.env.TURN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
}

type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string };
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = openDb(DB_PATH);
const boot = bootstrapAdmin(db);

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

/** Public HTTPS origin for invite links (Cloudflare tunnel / named host). */
function publicBaseUrl(req: express.Request): string {
  const fromEnv = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const xfProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const xfHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  if (xfProto && xfHost) return `${xfProto}://${xfHost}`;
  return `${req.protocol}://${req.get("host")}`;
}

function requestHostname(req: express.Request): string {
  const raw = String(req.get("x-forwarded-host") || req.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return raw.split(":")[0];
}

/** Redirect direct LAN HTTP hits to PUBLIC_BASE_URL — never bounce Cloudflare tunnel traffic. */
app.use((req, res, next) => {
  const pub = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (!pub || (req.method !== "GET" && req.method !== "HEAD")) return next();

  const host = requestHostname(req);
  if (!host || host === "127.0.0.1" || host === "localhost") return next();

  let pubHost = "";
  try {
    pubHost = new URL(pub).hostname.toLowerCase();
  } catch {
    return next();
  }
  if (host === pubHost) return next();

  const xfProto = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  // Tunnel / reverse-proxy already HTTPS from the client's POV
  if (xfProto === "https") return next();

  const isPrivate =
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host) || host.endsWith(".local");
  if (!isPrivate) return next();

  const dest = `${pub}${req.originalUrl || "/"}`;
  return res.redirect(302, dest);
});

function sessionId(req: express.Request): string | undefined {
  return (
    (req.cookies?.kl_session as string | undefined) ||
    (req.headers["x-session-id"] as string | undefined) ||
    (typeof req.query?.sid === "string" ? req.query.sid : undefined)
  );
}

function requireUser(req: express.Request, res: express.Response) {
  const user = getSessionUser(db, sessionId(req));
  if (!user) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  return user;
}

/** One-tap ATA push needs PhoneHome on the same LAN as the adapter. Opt out for shared/cloud hosts. */
function ataLanPushEnabled(): boolean {
  const raw = String(process.env.ATA_LAN_PUSH ?? "1").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "kids-landline",
    stage: 1,
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "") || null,
    /** True when this host (home hub) can attempt HT801 LAN push — not the parent app client. */
    ataLanPush: ataLanPushEnabled(),
  });
});

app.get("/api/ice", (_req, res) => {
  res.json({ iceServers: buildIceServers() });
});

app.get("/api/bootstrap", (_req, res) => {
  const initialized = Boolean(db.prepare(`SELECT 1 FROM sessions LIMIT 1`).get());
  res.json({
    initialized,
    hostSetupHint: initialized ? null : "Use the printed setup code from server logs on first boot",
  });
});

app.post("/api/auth/login", (req, res) => {
  try {
    const { code, username, password, displayName } = req.body as {
      code?: string;
      username?: string;
      password?: string;
      displayName?: string;
    };
    const pub = (u: Parameters<typeof publicUser>[0]) =>
      publicUser(u, { isChildOnly: isChildOnlyAccount(db, u.id) });
    if (username || password) {
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }
      const { user, session } = loginWithPassword(db, String(username), String(password));
      res.cookie("kl_session", session.id, { httpOnly: true, sameSite: "lax", maxAge: 30 * 864e5 });
      return res.json({ user: pub(user), sessionId: session.id });
    }
    if (!code) return res.status(400).json({ error: "Username/password or setup code required" });
    const { user, session } = loginWithSetupCode(db, String(code), displayName);
    res.cookie("kl_session", session.id, { httpOnly: true, sameSite: "lax", maxAge: 30 * 864e5 });
    res.json({ user: pub(user), sessionId: session.id });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/auth/register", (req, res) => {
  try {
    const { displayName, username, password } = req.body as {
      displayName?: string;
      username?: string;
      password?: string;
    };
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const result = registerParent(db, displayName || "Parent", {
      username: String(username),
      password: String(password),
    });
    res.cookie("kl_session", result.sessionId, { httpOnly: true, sameSite: "lax", maxAge: 30 * 864e5 });
    res.json({
      user: publicUser(result.user, { isChildOnly: isChildOnlyAccount(db, result.user.id) }),
      sessionId: result.sessionId,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/auth/set-password", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!password) return res.status(400).json({ error: "Password required" });
    const updated = setUserCredentials(db, user.id, {
      username: username ?? user.username ?? undefined,
      password: String(password),
    });
    res.json({ user: publicUser(updated, { isChildOnly: isChildOnlyAccount(db, updated.id) }) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const sid = sessionId(req);
  if (sid) db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
  res.clearCookie("kl_session");
  res.json({ ok: true });
});

app.post("/api/account/delete", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { confirm } = (req.body || {}) as { confirm?: string };
    const result = deleteParentAccount(db, user.id, DATA_DIR, { confirm });
    const sid = sessionId(req);
    if (sid) db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
    res.clearCookie("kl_session");
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/me", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const snap = householdSnapshot(db, user.id);
    await enrichDirectoryPresence(snap.directory);
    res.json({
      user: publicUser(user, { isChildOnly: isChildOnlyAccount(db, user.id) }),
      ...snap,
      userIncluded: true,
    });
  } catch (e) {
    console.error("[api/me]", e);
    // Session is valid — don't strand a fresh login behind a snapshot bug.
    res.status(500).json({ error: "Could not load your account. Try again." });
  }
});

app.post("/api/households", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { name } = req.body as { name?: string };
  const household = createHousehold(db, user.id, name || "Family");
  res.json({ household });
});

app.patch("/api/households/:id/rules", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  try {
    const household = updateHouseholdRules(db, req.params.id, req.body);
    res.json({ household: publicHousehold(household) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/households/:id/lines", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!userInHousehold(db, req.params.id, user.id)) {
    return res.status(403).json({ error: "Not a member of this household" });
  }
  const { name, type } = req.body as { name?: string; type?: LineType };
  const line = addLine(db, req.params.id, user.id, name || "Softphone", type || "softphone");
  res.json({ line });
});

app.patch("/api/households/:id/lines/:lineId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageChild(db, user.id, req.params.lineId) && !userInHousehold(db, req.params.id, user.id)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  try {
    const { mode, child_label, name, answering_machine } = (req.body || {}) as {
      mode?: "parent" | "child";
      child_label?: string | null;
      name?: string;
      answering_machine?: boolean | number;
    };
    if (answering_machine !== undefined && !canEditLineGreeting(db, user.id, req.params.lineId)) {
      return res.status(403).json({ error: "Not authorized for this line" });
    }
    const line = updateLine(
      db,
      req.params.id,
      req.params.lineId,
      { mode, child_label, name, answering_machine },
      { actorUserId: user.id }
    );
    res.json({ line, guardians: listGuardians(db, line.id) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Hard-delete a child line (confirm body: DELETE or child name). */
app.post("/api/households/:id/lines/:lineId/delete", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { confirm } = (req.body || {}) as { confirm?: string };
    const result = deleteChildLine(db, user.id, req.params.id, req.params.lineId, DATA_DIR, {
      confirm,
    });
    res.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    const status = /not authorized|only household/i.test(msg) ? 403 : 400;
    res.status(status).json({ error: msg });
  }
});

app.put("/api/households/:id/lines/:lineId/greeting", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canEditLineGreeting(db, user.id, req.params.lineId)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  try {
    const { audioBase64, audioMime } = (req.body || {}) as {
      audioBase64?: string;
      audioMime?: string;
    };
    if (!audioBase64) return res.status(400).json({ error: "audioBase64 required" });
    const line = setLineGreeting(db, req.params.id, req.params.lineId, {
      audioBase64,
      audioMime,
      dataDir: DATA_DIR,
    });
    const { greeting_path: _gp, greeting_confirmed_at: _gc, avatar_path: _ap, ...safe } = line;
    res.json({
      line: {
        ...safe,
        has_greeting: true,
        greeting_confirmed: true,
        greeting_updated_at: line.greeting_updated_at,
      },
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/households/:id/lines/:lineId/greeting", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canEditLineGreeting(db, user.id, req.params.lineId)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  try {
    const line = clearLineGreeting(db, req.params.id, req.params.lineId, DATA_DIR);
    const { greeting_path: _gp, greeting_confirmed_at: _gc, avatar_path: _ap, ...safe } = line;
    res.json({
      line: {
        ...safe,
        has_greeting: false,
        greeting_confirmed: true,
        greeting_updated_at: null,
      },
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Confirm default greeting (or keep current) — marks parent setup Sounds step done. */
app.post("/api/households/:id/lines/:lineId/greeting/confirm", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canEditLineGreeting(db, user.id, req.params.lineId)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  try {
    const line = confirmLineGreeting(db, req.params.id, req.params.lineId);
    const { greeting_path: _gp, greeting_confirmed_at: _gc, avatar_path: _ap, ...safe } = line;
    res.json({
      line: {
        ...safe,
        has_greeting: Boolean(line.greeting_path),
        greeting_confirmed: true,
        greeting_updated_at: line.greeting_updated_at,
      },
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.put("/api/households/:id/lines/:lineId/avatar", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canEditLineAvatar(db, user.id, req.params.lineId)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  try {
    const { imageBase64, imageMime } = (req.body || {}) as {
      imageBase64?: string;
      imageMime?: string;
    };
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 required" });
    const line = setLineAvatar(db, req.params.id, req.params.lineId, {
      imageBase64,
      imageMime,
      dataDir: DATA_DIR,
    });
    const { greeting_path: _gp, avatar_path: _ap, ...safe } = line;
    res.json({
      line: {
        ...safe,
        has_avatar: true,
        avatar_url: `/api/lines/${line.id}/avatar`,
        avatar_updated_at: line.avatar_updated_at,
      },
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/households/:id/lines/:lineId/avatar", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canEditLineAvatar(db, user.id, req.params.lineId)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  try {
    const line = clearLineAvatar(db, req.params.id, req.params.lineId, DATA_DIR);
    const { greeting_path: _gp, avatar_path: _ap, ...safe } = line;
    res.json({
      line: {
        ...safe,
        has_avatar: false,
        avatar_url: null,
        avatar_updated_at: null,
      },
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Serve a line's profile picture — any signed-in household member / guardian. */
app.get("/api/lines/:lineId/avatar", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canViewLineAvatar(db, user.id, req.params.lineId)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(req.params.lineId) as
    | { avatar_path: string | null }
    | undefined;
  if (!line?.avatar_path) return res.status(404).json({ error: "No profile picture" });
  const abs = path.resolve(DATA_DIR, line.avatar_path);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep)) {
    return res.status(400).json({ error: "Bad path" });
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "Avatar file missing" });
  const ext = path.extname(abs).toLowerCase();
  const type =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : "image/jpeg";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "private, max-age=3600");
  fs.createReadStream(abs).pipe(res);
});

/** Play a line's greeting — owner/guardian, or allowlisted caller (leave-a-message). */
app.get("/api/lines/:lineId/greeting", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const fromLineId = typeof req.query.fromLineId === "string" ? req.query.fromLineId : undefined;
  if (!canHearLineGreeting(db, user.id, req.params.lineId, fromLineId)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(req.params.lineId) as
    | { greeting_path: string | null }
    | undefined;
  if (!line?.greeting_path) return res.status(404).json({ error: "No custom greeting" });
  const abs = path.resolve(DATA_DIR, line.greeting_path);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep)) {
    return res.status(400).json({ error: "Bad path" });
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "Greeting file missing" });
  const ext = path.extname(abs).toLowerCase();
  const type =
    ext === ".wav"
      ? "audio/wav"
      : ext === ".ogg"
        ? "audio/ogg"
        : ext === ".m4a"
          ? "audio/mp4"
          : "audio/webm";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "private, max-age=60");
  fs.createReadStream(abs).pipe(res);
});

app.get("/api/lines/:lineId/guardians", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageChild(db, user.id, req.params.lineId)) {
    return res.status(403).json({ error: "Not authorized for this child line" });
  }
  res.json({ guardians: listGuardians(db, req.params.lineId) });
});

app.post("/api/lines/:lineId/guardians", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { username } = (req.body || {}) as { username?: string };
    if (!username) return res.status(400).json({ error: "username required" });
    const guardian = addGuardianByUsername(db, user.id, req.params.lineId, String(username));
    res.json({ guardian, guardians: listGuardians(db, req.params.lineId) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/lines/:lineId/guardians/:userId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    removeGuardian(db, user.id, req.params.lineId, req.params.userId);
    res.json({ ok: true, guardians: listGuardians(db, req.params.lineId) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/lines/:lineId/guardian-invites", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const invite = createGuardianInvite(db, user.id, req.params.lineId);
    const base = publicBaseUrl(req);
    res.json({
      invite,
      shareUrl: `${base}/?guardian=${invite.code}`,
      shareText: `Become a guardian on our PhoneHome child phone. Sign in, then enter guardian code ${invite.code}.`,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/guardian-invites/redeem", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { code } = (req.body || {}) as { code?: string };
    const result = redeemGuardianInvite(db, user.id, String(code || ""));
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/lines/:lineId/child-login", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { username, password, displayName } = (req.body || {}) as {
      username?: string;
      password?: string;
      displayName?: string;
    };
    if (!username || !password) {
      return res.status(400).json({ error: "username and password required" });
    }
    const result = setChildLineLogin(db, user.id, req.params.lineId, {
      username: String(username),
      password: String(password),
      displayName,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/lines/:lineId/reset-child-password", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { password } = (req.body || {}) as { password?: string };
    if (!password) return res.status(400).json({ error: "password required" });
    const result = resetChildPasswordByGuardian(db, user.id, req.params.lineId, String(password));
    res.json({ ...result, flash: result.message });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/households/:id/invites", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canCreateHouseholdInvite(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Only parents can invite family" });
  }
  try {
    const invite = createInvite(db, req.params.id, user.id);
    const base = publicBaseUrl(req);
    res.json({
      invite,
      publicBaseUrl: base,
      shareUrl: `${base}/?invite=${invite.code}`,
      shareText: `Join our PhoneHome (private family phone). Open the link, tap “I was invited,” enter code ${invite.code}. Then we each approve the other so kids can call.`,
    });
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

app.post("/api/invites/redeem", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { code, householdName } = req.body as { code?: string; householdName?: string };
    const result = redeemInvite(db, String(code || ""), user.id, householdName || "Family");
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/households/:id/allowlist", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  const { targetLineId, label, speedDial, favorite, alwaysAllow } = req.body as {
    targetLineId?: string;
    label?: string;
    speedDial?: number;
    favorite?: boolean;
    alwaysAllow?: boolean;
  };
  if (!targetLineId) return res.status(400).json({ error: "targetLineId required" });
  try {
    const entry = addAllowlist(db, req.params.id, targetLineId, label || "Contact", {
      speedDial,
      favorite,
      alwaysAllow,
    });
    res.json({ entry });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/households/:id/allowlist/decline", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  try {
    const { targetLineId } = (req.body || {}) as { targetLineId?: string };
    if (!targetLineId) return res.status(400).json({ error: "targetLineId required" });
    res.json(declineAllowlist(db, req.params.id, targetLineId));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.patch("/api/households/:id/allowlist/:entryId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  try {
    const entry = updateAllowlistEntry(db, req.params.id, req.params.entryId, req.body || {});
    res.json({ entry });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/households/:id/allowlist/:entryId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  removeAllowlist(db, req.params.id, req.params.entryId);
  res.json({ ok: true });
});

app.post("/api/households/:id/pin/verify", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(req.params.id) as
    | import("./db.js").Household
    | undefined;
  if (!hh) return res.status(404).json({ error: "Household not found" });
  if (!hh.parent_pin_hash) {
    return res.status(400).json({ error: "No parent PIN set" });
  }
  const pin = normalizePin((req.body as { pin?: string })?.pin);
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: "PIN must be 4–6 digits" });
  }
  if (!verifyParentPin(hh, pin)) {
    return res.status(403).json({ error: "Incorrect PIN" });
  }
  res.json({ ok: true });
});

app.post("/api/households/:id/voicemails/:vmId/listen", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!userInHousehold(db, req.params.id, user.id)) {
    return res.status(403).json({ error: "Not a member of this household" });
  }
  db.prepare(`UPDATE voicemails SET listened = 1 WHERE id = ? AND household_id = ?`).run(
    req.params.vmId,
    req.params.id
  );
  res.json({ ok: true });
});

app.get("/api/households/:id/voicemails/:vmId/audio", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!userInHousehold(db, req.params.id, user.id)) {
    return res.status(403).json({ error: "Not a member of this household" });
  }
  const row = db
    .prepare(`SELECT * FROM voicemails WHERE id = ? AND household_id = ?`)
    .get(req.params.vmId, req.params.id) as { audio_path: string | null } | undefined;
  if (!row?.audio_path) return res.status(404).json({ error: "No audio" });
  const abs = path.resolve(DATA_DIR, row.audio_path);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep)) {
    return res.status(400).json({ error: "Bad path" });
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "Audio missing" });
  const ext = path.extname(abs).toLowerCase();
  const type =
    ext === ".ogg" ? "audio/ogg" : ext === ".m4a" ? "audio/mp4" : "audio/webm";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "private, max-age=3600");
  fs.createReadStream(abs).pipe(res);
});

app.delete("/api/households/:id/voicemails/:vmId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!userInHousehold(db, req.params.id, user.id)) {
    return res.status(403).json({ error: "Not a member of this household" });
  }
  try {
    const result = deleteVoicemail(db, req.params.id, req.params.vmId, DATA_DIR);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Bulk erase — same household-member AuthZ as single delete. */
app.post("/api/households/:id/voicemails/delete", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!userInHousehold(db, req.params.id, user.id)) {
    return res.status(403).json({ error: "Not a member of this household" });
  }
  try {
    const { ids } = req.body as { ids?: unknown };
    const result = deleteVoicemails(db, req.params.id, ids, DATA_DIR);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/voicemails", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { fromLineId, toLineId, audioBase64, audioMime } = req.body as {
      fromLineId?: string;
      toLineId?: string;
      body?: string;
      audioBase64?: string;
      audioMime?: string;
    };
    if (!fromLineId || !toLineId) return res.status(400).json({ error: "fromLineId and toLineId required" });
    if (!audioBase64) return res.status(400).json({ error: "Record a voice message" });
    const vm = leaveVoicemailForContact(db, user.id, fromLineId, toLineId, "", {
      audioBase64,
      audioMime,
      dataDir: DATA_DIR,
    });
    // Notify recipient softphone only (answering-machine “new message” light).
    const unread = db
      .prepare(
        `SELECT COUNT(*) AS n FROM voicemails WHERE to_line_id = ? AND listened = 0`
      )
      .get(vm.to_line_id) as { n: number };
    fanoutVoicemailNew(vm.household_id, vm, Number(unread?.n || 1));
    res.json({ voicemail: vm });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/directory", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const snap = householdSnapshot(db, user.id);
  await enrichDirectoryPresence(snap.directory);
  res.json({ directory: snap.directory });
});

/**
 * Softphone WS online OR ATA SIP-registered (and not in Quiet Time / quiet hours).
 * Mutates directory entries in place. SIP status is cached with ata-status (~20s).
 */
async function enrichDirectoryPresence(
  directory: { id: string; household_id: string; online: number }[]
): Promise<void> {
  if (!directory.length) return;
  const atas = listAtaDevices(db);
  if (!atas.length) return;

  const registeredByLine = new Map<string, boolean>();
  await Promise.all(
    atas.map(async (ata) => {
      if (!ata.sip_extension || !ata.sip_password) {
        registeredByLine.set(ata.line_id, false);
        return;
      }
      // Reuse Home chip cache when fresh.
      const cached = ataStatusCache.get(ata.line_id);
      if (cached && Date.now() - cached.at < ATA_STATUS_TTL_MS) {
        registeredByLine.set(ata.line_id, Boolean(cached.body.registered));
        return;
      }
      const sip = await fetchBridgeSipStatus(ata.sip_extension);
      // An unverifiable check must not light up the directory dot.
      const { status, registered } = deriveAtaStatus(sip);
      registeredByLine.set(ata.line_id, registered);
      ataStatusCache.set(ata.line_id, {
        at: Date.now(),
        body: {
          status,
          registered,
          sip_extension: ata.sip_extension,
          state: sip.state || null,
          confidence: sip.confidence,
          method: sip.method,
          reason: sip.reason || null,
          checked_at: new Date().toISOString(),
        },
      });
    })
  );

  const hhCache = new Map<
    string,
    {
      dnd: number;
      quiet_start: string | null;
      quiet_end: string | null;
      quiet_tz: string | null;
      quiet_days: string | null;
      skip_holidays: number;
      schedule_preset: string;
    }
  >();
  for (const row of directory) {
    let hh = hhCache.get(row.household_id);
    if (!hh) {
      hh = db
        .prepare(
          `SELECT dnd, quiet_start, quiet_end, quiet_tz, quiet_days, skip_holidays, schedule_preset FROM households WHERE id = ?`
        )
        .get(row.household_id) as
        | {
            dnd: number;
            quiet_start: string | null;
            quiet_end: string | null;
            quiet_tz: string | null;
            quiet_days: string | null;
            skip_holidays: number;
            schedule_preset: string;
          }
        | undefined;
      if (!hh) continue;
      hhCache.set(row.household_id, hh);
    }
    const online = linePresenceOnline({
      softphoneOnline: Boolean(row.online),
      ataRegistered: Boolean(registeredByLine.get(row.id)),
      household: hh,
    });
    row.online = online ? 1 : 0;
  }
}

function canManageLineAta(userId: string, lineId: string, householdId?: string): boolean {
  if (canManageChild(db, userId, lineId)) return true;
  const line = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(lineId) as
    | { household_id: string }
    | undefined;
  if (!line) return false;
  if (householdId && line.household_id !== householdId) return false;
  return userInHousehold(db, line.household_id, userId);
}

function bridgeSecretOk(req: express.Request): boolean {
  const expected = (process.env.BRIDGE_SECRET || "").trim();
  if (!expected) return false;
  const hdr = String(req.get("authorization") || "");
  const bearer = hdr.toLowerCase().startsWith("bearer ") ? hdr.slice(7).trim() : "";
  const alt = String(req.get("x-bridge-secret") || "");
  return bearer === expected || alt === expected;
}

const BRIDGE_URL = (process.env.BRIDGE_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
/** Brief cache so Home refresh does not spam ARI. */
const ATA_STATUS_TTL_MS = 20_000;
type AtaStatusBody = {
  status: AtaStatusKind;
  registered: boolean;
  sip_extension: string | null;
  state: string | null;
  /** How the bridge knows — surfaced for support, not shown to parents. */
  confidence: BridgeSipStatus["confidence"] | null;
  method: string | null;
  reason: string | null;
  checked_at: string;
  cached?: boolean;
};
const ataStatusCache = new Map<string, { at: number; body: AtaStatusBody }>();

function bridgeAuthHeaders(): { secret: string; headers: Record<string, string> } {
  const secret = (process.env.BRIDGE_SECRET || "").trim();
  return {
    secret,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
  };
}

/** Ask bridged to claim the target line on /ws so softphone→ATA uses normal signaling. */
async function claimBridgeCallee(opts: {
  lineId: string;
  sipExtension: string;
  callId: string;
}): Promise<void> {
  const { secret, headers } = bridgeAuthHeaders();
  if (!secret) throw new Error("BRIDGE_SECRET not configured");
  const res = await fetch(`${BRIDGE_URL}/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts),
  });
  const text = await res.text();
  let body: { error?: string; reason?: string } | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    throw new Error(body?.reason || body?.error || `bridge claim HTTP ${res.status}`);
  }
}

/** Drop a leftover FXS claim so a softphone tab can own the line again. */
async function releaseBridgeCallee(lineId: string): Promise<void> {
  const { secret, headers } = bridgeAuthHeaders();
  if (!secret) return;
  try {
    await fetch(`${BRIDGE_URL}/release`, {
      method: "POST",
      headers,
      body: JSON.stringify({ lineId }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* best-effort */
  }
  for (const c of clients) {
    if (c.lineId === lineId && !c.isBridge) {
      send(c.ws, { type: "session.ata_cleared", lineId });
    }
  }
}

/**
 * Ask bridged whether the ATA really has a usable SIP registration.
 * Every failure path here is inconclusive, never "registered" — see ataStatus.ts.
 */
async function fetchBridgeSipStatus(sipExtension: string): Promise<BridgeSipStatus> {
  const secret = (process.env.BRIDGE_SECRET || "").trim();
  if (!secret) return unknownSipStatus("BRIDGE_SECRET not configured");
  try {
    const res = await fetch(
      `${BRIDGE_URL}/sip-status?ext=${encodeURIComponent(sipExtension)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(4000),
      }
    );
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!body) return unknownSipStatus(`bridge sip-status HTTP ${res.status}`);
    return parseBridgeSipStatus(body, res.ok);
  } catch (e) {
    return unknownSipStatus((e as Error).message || "bridge unreachable");
  }
}

/** Parent: get ATA / HT801 binding for a line. */
app.get("/api/households/:id/lines/:lineId/ata", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageLineAta(user.id, req.params.lineId, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  const ata = getAtaByLineId(db, req.params.lineId);
  const base = publicBaseUrl(req);
  res.json({
    ata: ata ? publicAta(ata) : null,
    config_server_path: ata
      ? normalizeAtaModel(ata.model) === "g100s"
        ? formatFanvilProvisionUrl(base, ata.provision_token)
        : formatConfigServerPath(base, ata.provision_token)
      : null,
    provision_urls: ata
      ? {
          cfg: `${base}/provision/${ata.provision_token}/cfg.xml`,
          cfgMacTemplate: `${base}/provision/${ata.provision_token}/cfg{mac}.xml`,
          fanvilCfg: `${base}/provision/${ata.provision_token}/{mac}.cfg`,
          fanvilTxt: `${base}/provision/${ata.provision_token}/{mac}.txt`,
        }
      : null,
    defaults: {
      sip_server: defaultSipServer(),
      sip_extension: "2001",
    },
  });
});

/**
 * Parent Home: glanceable HT801 health (configured vs ARI PJSIP online/offline).
 * Cached ~20s so presence polling does not hammer FreePBX.
 */
app.get("/api/lines/:lineId/ata-status", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const lineId = req.params.lineId;
  if (!canManageLineAta(user.id, lineId)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  const force = String(req.query.refresh || "") === "1";
  const cached = ataStatusCache.get(lineId);
  if (!force && cached && Date.now() - cached.at < ATA_STATUS_TTL_MS) {
    return res.json({ ...cached.body, cached: true });
  }

  const ata = getAtaByLineId(db, lineId);
  const checked_at = new Date().toISOString();
  if (!ata || !ata.sip_password || !ata.sip_extension) {
    const body: AtaStatusBody = {
      status: "not_configured",
      registered: false,
      sip_extension: ata?.sip_extension || null,
      state: null,
      confidence: null,
      method: null,
      reason: null,
      checked_at,
    };
    ataStatusCache.set(lineId, { at: Date.now(), body });
    return res.json(body);
  }

  const sip = await fetchBridgeSipStatus(ata.sip_extension);
  const { status, registered } = deriveAtaStatus(sip);

  const body: AtaStatusBody = {
    status,
    registered,
    sip_extension: ata.sip_extension,
    state: sip.state || null,
    confidence: sip.confidence,
    method: sip.method,
    reason: sip.reason || null,
    checked_at,
  };
  ataStatusCache.set(lineId, { at: Date.now(), body });
  res.json(body);
});

/** Parent: create/update ATA binding. */
app.put("/api/households/:id/lines/:lineId/ata", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageLineAta(user.id, req.params.lineId, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  try {
    const body = (req.body || {}) as {
      sip_extension?: string;
      sip_password?: string;
      sip_server?: string;
      mac?: string | null;
      display_name?: string | null;
      model?: string | null;
      rotate_provision_token?: boolean;
    };
    // Parents never set SIP extension/password — ignore any client-supplied values (anti-takeover).
    const ata = upsertAtaDevice(db, req.params.lineId, {
      sip_server: body.sip_server,
      mac: body.mac,
      display_name: body.display_name,
      model: body.model,
      rotate_provision_token: body.rotate_provision_token,
    });
    ataStatusCache.delete(req.params.lineId);
    // Keep FreePBX in lockstep so a later Download config is REGISTER-ready for remote parents.
    void syncAtaSipSecretToFreepbx(ata.sip_extension, ata.sip_password).then((r) => {
      if (!r.ok) console.warn(`[freepbx-sync] upsert fail ext=${ata.sip_extension} err=${r.error}`);
      else if (!r.skipped) console.log(`[freepbx-sync] ok ext=${ata.sip_extension}`);
    });
    const base = publicBaseUrl(req);
    res.json({
      ata: publicAta(ata),
      config_server_path:
        normalizeAtaModel(ata.model) === "g100s"
          ? formatFanvilProvisionUrl(base, ata.provision_token)
          : formatConfigServerPath(base, ata.provision_token),
      provision_urls: {
        cfg: `${base}/provision/${ata.provision_token}/cfg.xml`,
        cfgMacTemplate: `${base}/provision/${ata.provision_token}/cfg{mac}.xml`,
        fanvilCfg: `${base}/provision/${ata.provision_token}/{mac}.cfg`,
        fanvilTxt: `${base}/provision/${ata.provision_token}/{mac}.txt`,
      },
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/households/:id/lines/:lineId/ata", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageLineAta(user.id, req.params.lineId, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  deleteAtaDevice(db, req.params.lineId);
  ataStatusCache.delete(req.params.lineId);
  res.json({ ok: true });
});

/** Authenticated download of ATA config (Grandstream XML or Fanvil txt). */
app.get("/api/households/:id/lines/:lineId/ata/config.xml", (req, res) => {
  serveAtaDownload(req, res);
});
app.get("/api/households/:id/lines/:lineId/ata/config.txt", (req, res) => {
  serveAtaDownload(req, res);
});
app.get("/api/households/:id/lines/:lineId/ata/config.cfg", (req, res) => {
  serveAtaDownload(req, res);
});

/**
 * One-tap HT801 setup: PhoneHome logs into the adapter on the LAN, sets a new
 * admin password, uploads config XML, and reboots — no Grandstream web UI.
 */
app.post("/api/households/:id/lines/:lineId/ata/push", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageLineAta(user.id, req.params.lineId, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  const ata = getAtaByLineId(db, req.params.lineId);
  if (!ata) return res.status(404).json({ error: "Save connection details first (Advanced)" });
  if (normalizeAtaModel(ata.model) !== "ht801") {
    return res.status(400).json({ error: "One-tap setup is only for Grandstream HT801 right now" });
  }

  const body = (req.body || {}) as {
    ata_ip?: string;
    box_password?: string;
    new_password?: string;
  };
  const ataIp = String(body.ata_ip || "").trim();
  const boxPassword = String(body.box_password || "");
  const newPassword = String(body.new_password || "");
  const rules = validateHt801AdminPassword(newPassword);
  if (!rules.ok) return res.status(400).json({ error: rules.reason || "Invalid new password" });

  const base = publicBaseUrl(req);
  // Same gate as Download — one-tap must not push a secret FreePBX rejects.
  if (freepbxSyncConfigured()) {
    const gate = await ensureFreepbxHasAtaSecret(ata);
    if (!gate.ok) return res.status(503).json({ error: gate.error });
  }
  const xml = ataConfigXmlForDevice(ata, {
    publicBaseUrl: base,
    includeConfigServerPath: true,
    adminPassword: newPassword,
  });

  try {
    const result = await pushHt801Config({
      host: ataIp,
      currentPassword: boxPassword,
      newPassword,
      configXml: xml,
    });
    console.log(
      `[ata/push] ok line=${req.params.lineId} host=${result.host} password_changed=${result.passwordChanged} rebooted=${result.rebooted}`
    );
    res.json({
      ok: true,
      host: result.host,
      password_changed: result.passwordChanged,
      uploaded: result.uploaded,
      rebooted: result.rebooted,
      message: result.rebooted
        ? "Config sent — adapter is rebooting. Give it about a minute, then try dialing 0."
        : "Config sent. If the phone doesn’t register, reboot the adapter once.",
    });
  } catch (e) {
    const msg = (e as Error).message || "Push failed";
    // Never log passwords / XML; host + reason only.
    console.warn(`[ata/push] fail line=${req.params.lineId} host=${ataIp || "?"} err=${msg}`);
    if (isHt801LoginAbortError(e)) {
      // 423 = stop retries (parent UI + agents). Grandstream web lock ≠ SIP down.
      return res.status(423).json({
        error: msg,
        abort_retries: true,
        lockout: e.lockout,
        kind: e.kind,
        cooldown_ms: e.cooldownMs,
      });
    }
    res.status(400).json({ error: msg });
  }
});

function serveAtaDownload(req: express.Request, res: express.Response) {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageLineAta(user.id, req.params.lineId, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  const ata = getAtaByLineId(db, req.params.lineId);
  if (!ata) return res.status(404).json({ error: "Link an analog adapter first" });

  // Critical for remote parents: never hand out XML FreePBX won’t accept.
  void (async () => {
    if (freepbxSyncConfigured()) {
      const gate = await ensureFreepbxHasAtaSecret(ata);
      if (!gate.ok) {
        res.status(503).json({ error: gate.error });
        return;
      }
    }
    const base = publicBaseUrl(req);
    const pathName = String(req.path || "");
    const wantFanvil = /\.(txt|cfg)$/i.test(pathName) || req.query.model === "g100s";
    const file = ataConfigForDevice(
      { ...ata, model: wantFanvil ? "g100s" : "ht801" },
      { publicBaseUrl: base, includeConfigServerPath: true }
    );
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.body);
  })().catch((e) => {
    console.warn(`[ata/download] fail line=${req.params.lineId} err=${(e as Error).message}`);
    if (!res.headersSent) res.status(500).json({ error: "Could not build adapter config" });
  });
}

/** Unauthenticated (token-gated) provisioning for HT801 Config Server Path. */
function serveProvisionXml(
  req: express.Request,
  res: express.Response,
  macHint?: string,
  format?: "ht801" | "g100s"
) {
  const ata = getAtaByProvisionToken(db, req.params.token);
  if (!ata) return res.status(404).type("text/plain").send("not found");
  if (macHint) {
    const want = macHint.replace(/^cfg/i, "").replace(/\.xml$/i, "");
    const mac = want.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
    if (mac.length === 12) {
      if (ata.mac && ata.mac !== mac) {
        return res.status(403).type("text/plain").send("mac mismatch");
      }
      if (!ata.mac) {
        try {
          upsertAtaDevice(db, ata.line_id, { mac });
        } catch {
          /* ignore race */
        }
      }
    }
  }
  const base = publicBaseUrl(req);
  const fresh = getAtaByLineId(db, ata.line_id) || ata;
  const kind = format || normalizeAtaModel(fresh.model);
  if (kind === "g100s") {
    const body = ataConfigTxtForDevice(fresh, { publicBaseUrl: base, includeConfigServerPath: true });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
    return;
  }
  const xml = ataConfigXmlForDevice(fresh, { publicBaseUrl: base, includeConfigServerPath: true });
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(xml);
}

app.get("/provision/:token/cfg.xml", (req, res) => serveProvisionXml(req, res, undefined, "ht801"));
app.get(/^\/provision\/([^/]+)\/cfg([0-9a-fA-F]{12})\.xml$/i, (req, res) => {
  const m = req.path.match(/^\/provision\/([^/]+)\/cfg([0-9a-fA-F]{12})\.xml$/i);
  if (!m) return res.status(404).end();
  (req.params as { token: string }).token = m[1];
  serveProvisionXml(req, res, m[2], "ht801");
});
app.get(/^\/provision\/([^/]+)\/([0-9a-fA-F]{12})\.(cfg|txt)$/i, (req, res) => {
  const m = req.path.match(/^\/provision\/([^/]+)\/([0-9a-fA-F]{12})\.(cfg|txt)$/i);
  if (!m) return res.status(404).end();
  (req.params as { token: string }).token = m[1];
  serveProvisionXml(req, res, m[2], "g100s");
});

/** SIP bridge: resolve dialed speed-dial → lines (shared secret). */
app.post("/api/bridge/resolve", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const { sipExtension, dialed } = (req.body || {}) as { sipExtension?: string; dialed?: string };
  const result = resolveAtaDial(db, String(sipExtension || ""), String(dialed || ""));
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

/** ATA *98 Messages / greeting IVR — mailbox for this SIP extension’s line. */
app.post("/api/bridge/mailbox", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const { sipExtension } = (req.body || {}) as { sipExtension?: string };
  const result = resolveAtaMailbox(db, String(sipExtension || ""));
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.get("/api/bridge/lines/:lineId/greeting", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(req.params.lineId) as
    | { greeting_path: string | null }
    | undefined;
  if (!line?.greeting_path) return res.status(404).json({ error: "No custom greeting" });
  const abs = path.resolve(DATA_DIR, line.greeting_path);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep) || !fs.existsSync(abs)) {
    return res.status(404).json({ error: "Greeting file missing" });
  }
  const ext = path.extname(abs).toLowerCase();
  const type =
    ext === ".wav"
      ? "audio/wav"
      : ext === ".ogg"
        ? "audio/ogg"
        : ext === ".m4a"
          ? "audio/mp4"
          : "audio/webm";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(abs).pipe(res);
});

app.put("/api/bridge/lines/:lineId/greeting", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(req.params.lineId) as
      | { id: string; household_id: string }
      | undefined;
    if (!line) return res.status(404).json({ error: "Line not found" });
    const { audioBase64, audioMime } = (req.body || {}) as {
      audioBase64?: string;
      audioMime?: string;
    };
    if (!audioBase64) return res.status(400).json({ error: "audioBase64 required" });
    const updated = setLineGreeting(db, line.household_id, line.id, {
      audioBase64,
      audioMime: audioMime || "audio/wav",
      dataDir: DATA_DIR,
    });
    res.json({
      ok: true,
      has_greeting: true,
      greeting_updated_at: updated.greeting_updated_at,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/bridge/lines/:lineId/greeting", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(req.params.lineId) as
      | { id: string; household_id: string }
      | undefined;
    if (!line) return res.status(404).json({ error: "Line not found" });
    clearLineGreeting(db, line.household_id, line.id, DATA_DIR);
    res.json({ ok: true, has_greeting: false });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/bridge/lines/:lineId/voicemails", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const list = listAtaMailboxMessages(db, req.params.lineId);
  res.json({
    voicemails: list.map((v) => ({
      id: v.id,
      from_label: v.from_label,
      listened: v.listened,
      created_at: v.created_at,
    })),
  });
});

/** @deprecated Prefer /api/bridge/lines/:lineId/voicemails (per-recipient mailbox). */
app.get("/api/bridge/households/:id/voicemails", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const lineId = String(req.query.lineId || "");
  if (!lineId) {
    return res.status(400).json({ error: "lineId query required" });
  }
  const list = listAtaMailboxMessages(db, lineId);
  res.json({
    voicemails: list.map((v) => ({
      id: v.id,
      from_label: v.from_label,
      listened: v.listened,
      created_at: v.created_at,
    })),
  });
});

app.get("/api/bridge/voicemails/:vmId/audio", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const row = db.prepare(`SELECT * FROM voicemails WHERE id = ?`).get(req.params.vmId) as
    | { audio_path: string | null; household_id: string }
    | undefined;
  if (!row?.audio_path) return res.status(404).json({ error: "No audio" });
  const abs = path.resolve(DATA_DIR, row.audio_path);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep) || !fs.existsSync(abs)) {
    return res.status(404).json({ error: "Audio missing" });
  }
  const ext = path.extname(abs).toLowerCase();
  const type =
    ext === ".wav"
      ? "audio/wav"
      : ext === ".ogg"
        ? "audio/ogg"
        : ext === ".m4a"
          ? "audio/mp4"
          : "audio/webm";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(abs).pipe(res);
});

app.post("/api/bridge/voicemails/:vmId/listen", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const row = db.prepare(`SELECT household_id FROM voicemails WHERE id = ?`).get(req.params.vmId) as
    | { household_id: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  db.prepare(`UPDATE voicemails SET listened = 1 WHERE id = ?`).run(req.params.vmId);
  res.json({ ok: true });
});

app.delete("/api/bridge/voicemails/:vmId", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const row = db.prepare(`SELECT household_id FROM voicemails WHERE id = ?`).get(req.params.vmId) as
      | { household_id: string }
      | undefined;
    if (!row) return res.status(404).json({ error: "Not found" });
    deleteVoicemail(db, row.household_id, req.params.vmId, DATA_DIR);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Softphone / bridge: route a line→line call (FXS if target has ATA). */
app.post("/api/bridge/route", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const { fromLineId, toLineId } = (req.body || {}) as { fromLineId?: string; toLineId?: string };
  const result = routeCallTarget(db, String(fromLineId || ""), String(toLineId || ""));
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post("/api/bridge/session", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { lineId } = (req.body || {}) as { lineId?: string };
    if (!lineId) return res.status(400).json({ error: "lineId required" });
    const session = createBridgeSession(db, lineId);
    bridgeSessionIds.add(session.sessionId);
    res.json(session);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/bridge/health", (_req, res) => {
  res.json({
    ok: true,
    bridgeSecretConfigured: Boolean((process.env.BRIDGE_SECRET || "").trim()),
    sipServer: defaultSipServer(),
    bridgeUrl: (process.env.BRIDGE_URL || "http://127.0.0.1:8790").trim(),
    apnsVoipConfigured: apnsConfigured(),
  });
});

/** iOS PushKit token registration (CallKit wake). */
app.post("/api/devices/voip-token", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body || {}) as { lineId?: string; voipToken?: string; platform?: string };
  const lineId = String(body.lineId || "").trim();
  const voipToken = String(body.voipToken || "").trim();
  if (!lineId || !voipToken) return res.status(400).json({ error: "lineId and voipToken required" });
  const line = db.prepare(`SELECT id, household_id, owner_user_id, child_user_id FROM lines WHERE id = ?`).get(
    lineId
  ) as
    | { id: string; household_id: string; owner_user_id: string; child_user_id: string | null }
    | undefined;
  if (!line) return res.status(404).json({ error: "Line not found" });
  const member = db
    .prepare(`SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`)
    .get(line.household_id, user.id);
  const allowed =
    Boolean(member) ||
    line.owner_user_id === user.id ||
    line.child_user_id === user.id ||
    canManageChild(db, user.id, lineId);
  if (!allowed) return res.status(403).json({ error: "Not allowed for this line" });
  try {
    const row = upsertIosVoipToken(db, { userId: user.id, lineId, voipToken });
    console.log(`[push] ios voip token line=${lineId} user=${user.id} …${row.voip_token.slice(-8)}`);
    res.json({ ok: true, platform: "ios", lineId });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Pending softphone offer after VoIP wake (SDP held briefly while CallKit answers). */
app.get("/api/calls/pending", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const lineId = String(req.query.lineId || "").trim();
  if (!lineId) return res.status(400).json({ error: "lineId required" });
  const pending = takePendingOffer(lineId);
  if (!pending) return res.json({ offer: null });
  res.json({ offer: pending });
});

app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "microphone=(self), camera=()");
  if (req.path === "/" || req.path.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  } else if (/\.(js|css)$/.test(req.path)) {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
  }
  next();
});

app.use(express.static(WEB_DIR, {
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    } else if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  },
}));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws") || req.path.startsWith("/provision")) {
    return next();
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(WEB_DIR, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

type Client = {
  ws: WebSocket;
  userId?: string;
  lineId?: string;
  /** True when this socket was minted via /api/bridge/session (FXS claim). */
  isBridge?: boolean;
};

const clients = new Set<Client>();
/** Session ids created for bridged FXS claims — softphones must not displace them. */
const bridgeSessionIds = new Set<string>();

type PendingOffer = {
  callId: string;
  fromLineId: string;
  toLineId: string;
  sdp: unknown;
  expires: number;
};
/** lineId → latest inbound offer waiting for CallKit / WS reconnect. */
const pendingOffers = new Map<string, PendingOffer>();

function storePendingOffer(offer: Omit<PendingOffer, "expires">, ttlMs = 90_000): void {
  pendingOffers.set(offer.toLineId, { ...offer, expires: Date.now() + ttlMs });
}

function takePendingOffer(lineId: string): PendingOffer | null {
  const p = pendingOffers.get(lineId);
  if (!p) return null;
  if (p.expires < Date.now()) {
    pendingOffers.delete(lineId);
    return null;
  }
  pendingOffers.delete(lineId);
  return p;
}

function peekPendingOffer(lineId: string): PendingOffer | null {
  const p = pendingOffers.get(lineId);
  if (!p) return null;
  if (p.expires < Date.now()) {
    pendingOffers.delete(lineId);
    return null;
  }
  return p;
}

async function wakeIosCallee(opts: {
  toLineId: string;
  fromLineId: string;
  callId: string;
  callerName: string;
}): Promise<void> {
  const tokens = listIosVoipTokensForLine(db, opts.toLineId);
  if (!tokens.length) return;
  for (const t of tokens.slice(0, 3)) {
    await sendIosVoipPush(t.voip_token, {
      callId: opts.callId,
      handle: opts.fromLineId,
      callerName: opts.callerName,
      fromLineId: opts.fromLineId,
      toLineId: opts.toLineId,
    });
  }
}

type GroupRoom = {
  id: string;
  hostLineId: string;
  /** Accepted participants */
  members: Set<string>;
  /** Still ringing */
  invited: Set<string>;
  createdAt: number;
};

const groupRooms = new Map<string, GroupRoom>();
const MAX_GROUP = 4;

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/** Inbound signaling prefers the FXS bridge when it shares a line with a softphone. */
function findByLine(lineId: string): Client | undefined {
  let soft: Client | undefined;
  let bridge: Client | undefined;
  for (const c of clients) {
    if (c.lineId !== lineId) continue;
    if (c.isBridge) bridge = c;
    else soft = c;
  }
  return bridge || soft;
}

/**
 * Register a socket on a line.
 * Softphone + ATA on the same line: keep both — inbound goes to the bridge (analog);
 * softphones stay connected for outbound and get `session.ata_preferred`.
 */
function claimLine(client: Client, lineId: string) {
  for (const c of [...clients]) {
    if (c === client || c.lineId !== lineId) continue;

    if (client.isBridge && !c.isBridge) {
      // FXS claim: softphone stays up for dialing out, but must not own inbound.
      send(c.ws, {
        type: "session.ata_preferred",
        lineId,
        message: "Incoming calls ring the analog phone while it’s connected.",
      });
      continue;
    }

    if (!client.isBridge && c.isBridge) {
      // Softphone hello while bridge holds the line — do not kick the FXS claim.
      send(client.ws, {
        type: "session.ata_preferred",
        lineId,
        message: "Incoming calls ring the analog phone while it’s connected.",
      });
      continue;
    }

    // Softphone displacing softphone (or bridge displacing bridge).
    console.log(`[ws] replacing stale socket for ${lineId}${c.isBridge ? " (bridge)" : ""}`);
    send(c.ws, { type: "session.replaced", lineId });
    try {
      c.ws.close(4000, "replaced");
    } catch {
      /* ignore */
    }
    clients.delete(c);
  }
  client.lineId = lineId;
}

function roomMemberList(room: GroupRoom): string[] {
  return [...room.members];
}

function fanoutGroup(room: GroupRoom, msg: unknown, exceptLineId?: string) {
  const targets = new Set([...room.members, ...room.invited]);
  for (const lineId of targets) {
    if (exceptLineId && lineId === exceptLineId) continue;
    const c = findByLine(lineId);
    if (c) send(c.ws, msg);
  }
}

function endGroupRoom(roomId: string, reason: string) {
  const room = groupRooms.get(roomId);
  if (!room) return;
  fanoutGroup(room, { type: "group.ended", roomId, reason });
  groupRooms.delete(roomId);
  console.log(`[group] ended ${roomId}: ${reason}`);
}

function householdIdForLine(lineId: string): string | null {
  const row = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(lineId) as
    | { household_id: string }
    | undefined;
  return row?.household_id || null;
}

function fanoutPresenceToHousehold(householdId: string, exceptLineId?: string) {
  const live_calls = liveCallsForHousehold(db, householdId);
  const msg = { type: "presence.call", householdId, live_calls };
  for (const c of clients) {
    if (!c.lineId || !c.ws || c.ws.readyState !== c.ws.OPEN) continue;
    if (exceptLineId && c.lineId === exceptLineId) continue;
    const hid = householdIdForLine(c.lineId);
    if (hid === householdId) send(c.ws, msg);
  }
}

function fanoutVoicemailNew(
  householdId: string,
  voicemail: {
    id: string;
    from_line_id?: string | null;
    to_line_id?: string | null;
    from_label?: string;
    created_at?: string;
    listened?: number;
  },
  unreadCount: number
) {
  const msg = {
    type: "voicemail.new",
    householdId,
    voicemail,
    unreadCount,
  };
  // Inbox is per recipient line — only notify the mailbox that received the message.
  // (Parents hear kid VMs by switching Active line to the kid, not mixed into their own.)
  const toLineId = voicemail?.to_line_id ? String(voicemail.to_line_id) : "";
  const fromLineId = voicemail?.from_line_id ? String(voicemail.from_line_id) : "";
  for (const c of clients) {
    if (!c.lineId || !c.ws || c.ws.readyState !== c.ws.OPEN) continue;
    if (fromLineId && c.lineId === fromLineId) continue;
    if (toLineId) {
      if (c.lineId !== toLineId) continue;
    } else {
      // Legacy rows without to_line_id: household fanout except caller.
      const hid = householdIdForLine(c.lineId);
      if (hid !== householdId) continue;
    }
    send(c.ws, msg);
  }
}

function publishLiveCall(
  callId: string,
  fromLineId: string,
  toLineId: string,
  status: "ringing" | "active"
) {
  setLiveCall({ callId, fromLineId, toLineId, status });
  const households = new Set<string>();
  const a = householdIdForLine(fromLineId);
  const b = householdIdForLine(toLineId);
  if (a) households.add(a);
  if (b) households.add(b);
  for (const hid of households) fanoutPresenceToHousehold(hid);
}

function endLiveCall(callId: string, fromLineId?: string, toLineId?: string) {
  clearLiveCall(callId);
  const households = new Set<string>();
  if (fromLineId) {
    const h = householdIdForLine(fromLineId);
    if (h) households.add(h);
  }
  if (toLineId) {
    const h = householdIdForLine(toLineId);
    if (h) households.add(h);
  }
  // Also refresh any household that might still list this call
  if (!households.size) {
    // fall through — nothing to notify
  }
  for (const hid of households) fanoutPresenceToHousehold(hid);
}

wss.on("connection", (ws) => {
  const client: Client = { ws };
  clients.add(client);

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const type = String(msg.type || "");

    if (type === "hello") {
      const sid = String(msg.sessionId || "");
      const user = getSessionUser(db, sid);
      if (!user) {
        send(ws, { type: "error", error: "bad session" });
        return;
      }
      client.userId = user.id;
      client.isBridge = bridgeSessionIds.has(sid);
      const lineId = String(msg.lineId || "");
      if (lineId) {
        claimLine(client, lineId);
        db.prepare(`UPDATE lines SET online = 1 WHERE id = ?`).run(lineId);
      }
      send(ws, {
        type: "welcome",
        userId: user.id,
        lineId: client.lineId,
        ataPreferred: Boolean(
          client.lineId && !client.isBridge && [...clients].some((c) => c.isBridge && c.lineId === client.lineId)
        ),
      });
      console.log(
        `[ws] hello line=${client.lineId} user=${user.display_name}${client.isBridge ? " (bridge)" : ""}`
      );
      // After CallKit wake, deliver any SDP that arrived while the app was suspended.
      if (client.lineId && !client.isBridge) {
        const pending = peekPendingOffer(client.lineId);
        if (pending) {
          send(ws, {
            type: "call.offer",
            callId: pending.callId,
            fromLineId: pending.fromLineId,
            toLineId: pending.toLineId,
            sdp: pending.sdp,
          });
          console.log(`[call] delivered pending offer ${pending.callId} → ${client.lineId}`);
        }
      }
      return;
    }

    if (type === "call.offer") {
      const fromLineId = String(msg.fromLineId || client.lineId || "");
      const toLineId = String(msg.toLineId || "");
      const check = canCall(db, fromLineId, toLineId);
      if (!check.ok) {
        console.log(`[call] rejected ${fromLineId}→${toLineId}: ${check.reason}`);
        logCall(db, fromLineId, toLineId, "blocked");
        send(ws, {
          type: "call.rejected",
          reason: check.reason,
          voice: check.voice,
          spoken: check.spoken,
          side: check.side,
        });
        return;
      }
      const call = logCall(db, fromLineId, toLineId, "ringing");
      const ata = getAtaByLineId(db, toLineId);

      // Same line has softphone + analog: default inbound to the FXS when it’s
      // registered/callable. Softphone stays for outbound; softphone must not steal the claim.
      void (async () => {
        try {
          let usedAta = false;
          if (ata) {
            const sip = await fetchBridgeSipStatus(ata.sip_extension);
            if (sip.callable || sip.registered) {
              try {
                await claimBridgeCallee({
                  lineId: toLineId,
                  sipExtension: ata.sip_extension,
                  callId: call.id,
                });
                usedAta = true;
              } catch (e) {
                console.log(
                  `[call] ATA claim failed ${call.id} ${fromLineId}→${toLineId}: ${(e as Error).message}; trying softphone`
                );
              }
            } else {
              console.log(
                `[call] ATA ${ata.sip_extension} not registered (${sip.state || sip.reason || "offline"}); ringing softphone`
              );
              await releaseBridgeCallee(toLineId);
            }
          }

          const target = findByLine(toLineId);
          const iosTokens = !usedAta ? listIosVoipTokensForLine(db, toLineId) : [];
          if (!target && !iosTokens.length) {
            endCallLog(db, call.id, "offline");
            console.log(`[call] offline ${call.id} ${fromLineId}→${toLineId}`);
            send(ws, {
              type: "call.rejected",
              reason: ata
                ? "Kid landline is offline, and their PhoneHome app isn’t open."
                : "Their phone isn’t reachable right now. Ask them to open PhoneHome (or the iOS app).",
            });
            return;
          }

          storePendingOffer({
            callId: call.id,
            fromLineId,
            toLineId,
            sdp: msg.sdp,
          });

          if (target) {
            // If we claimed FXS but findByLine somehow returned a softphone, re-prefer bridge.
            if (usedAta && !target.isBridge) {
              const bridge = [...clients].find((c) => c.isBridge && c.lineId === toLineId);
              if (bridge) {
                send(bridge.ws, {
                  type: "call.offer",
                  callId: call.id,
                  fromLineId,
                  toLineId,
                  sdp: msg.sdp,
                });
              } else {
                endCallLog(db, call.id, "offline");
                send(ws, {
                  type: "call.rejected",
                  reason: "Analog phone didn’t connect. Try again in a moment.",
                });
                return;
              }
            } else {
              send(target.ws, {
                type: "call.offer",
                callId: call.id,
                fromLineId,
                toLineId,
                sdp: msg.sdp,
              });
            }
          }

          // Softphone / iOS CallKit path — FXS-first skips wake so the wall phone owns the ring.
          if (!usedAta) {
            const fromLine = db
              .prepare(`SELECT name, child_label FROM lines WHERE id = ?`)
              .get(fromLineId) as { name: string; child_label: string | null } | undefined;
            const callerName =
              (fromLine?.child_label || fromLine?.name || "Family").trim().slice(0, 64) || "Family";
            void wakeIosCallee({
              toLineId,
              fromLineId,
              callId: call.id,
              callerName,
            });
          }
          send(ws, { type: "call.ringing", callId: call.id });
          publishLiveCall(call.id, fromLineId, toLineId, "ringing");
          console.log(
            `[call] ringing ${call.id} ${fromLineId}→${toLineId}${usedAta ? ` (FXS ${ata?.sip_extension})` : ""}${
              !target && iosTokens.length ? " (iOS VoIP wake)" : ""
            }`
          );
        } catch (e) {
          endCallLog(db, call.id, "offline");
          console.error(`[call] offer failed ${call.id}:`, e);
          send(ws, { type: "call.rejected", reason: "Call failed to connect" });
        }
      })();
      return;
    }

    if (type === "call.answer" || type === "call.ice" || type === "call.hangup" || type === "call.hold") {
      const fromLineId = String(msg.fromLineId || "");
      const toLineId = String(msg.toLineId || "");
      const otherId = client.lineId === fromLineId ? toLineId : fromLineId;
      const target = findByLine(otherId);
      if (!target) {
        console.log(`[call] ${type} no peer for ${otherId} (from ${client.lineId})`);
        if (type === "call.answer") {
          send(ws, { type: "call.rejected", reason: "Caller disconnected before answer" });
        }
      } else {
        send(target.ws, msg);
      }
      if (type === "call.hangup" && msg.callId) {
        const reason = String(msg.reason || "");
        // Ring timeout / no-answer → missed (caller then enters leave-a-message).
        endCallLog(db, String(msg.callId), reason === "no-answer" ? "missed" : "ended");
        endLiveCall(String(msg.callId), fromLineId, toLineId);
        console.log(`[call] hangup ${msg.callId}${reason ? ` (${reason})` : ""}`);
        // Drop FXS claim so a softphone on the same line can take inbound again if the ATA goes away.
        if (toLineId && getAtaByLineId(db, toLineId)) void releaseBridgeCallee(toLineId);
        if (fromLineId && getAtaByLineId(db, fromLineId)) void releaseBridgeCallee(fromLineId);
      }
      if (type === "call.answer" && msg.callId) {
        markCallAnswered(db, String(msg.callId));
        publishLiveCall(String(msg.callId), fromLineId, toLineId, "active");
        console.log(`[call] answered ${msg.callId}`);
      }
      return;
    }

    // —— Answering machine live monitor (opt-in; one-way WebRTC while leaving VM) ——
    if (
      type === "voicemail.monitor.offer" ||
      type === "voicemail.monitor.answer" ||
      type === "voicemail.monitor.ice" ||
      type === "voicemail.monitor.stop"
    ) {
      const fromLineId = String(msg.fromLineId || client.lineId || "");
      const toLineId = String(msg.toLineId || "");
      if (!fromLineId || !toLineId) {
        if (type === "voicemail.monitor.offer") {
          send(ws, { type: "voicemail.monitor.skip", reason: "bad-session" });
        }
        return;
      }
      if (type === "voicemail.monitor.offer") {
        if (fromLineId !== client.lineId) {
          send(ws, { type: "voicemail.monitor.skip", reason: "bad-session" });
          return;
        }
        // Never live-monitor onto the calling line (caller must not hear their own leave).
        if (fromLineId === toLineId) {
          send(ws, { type: "voicemail.monitor.skip", reason: "bad-session" });
          return;
        }
        // Recipient must have explicitly enabled answering machine (default off).
        if (!lineAnsweringMachineOn(db, toLineId)) {
          send(ws, { type: "voicemail.monitor.skip", reason: "off" });
          return;
        }
        // Caller must own from-line and have recipient allowlisted (same as leave-VM).
        const from = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(fromLineId) as
          | { household_id: string }
          | undefined;
        if (!from || !client.userId) {
          send(ws, { type: "voicemail.monitor.skip", reason: "bad-session" });
          return;
        }
        const member = db
          .prepare(`SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`)
          .get(from.household_id, client.userId);
        const childLogin = db
          .prepare(`SELECT 1 FROM lines WHERE id = ? AND child_user_id = ?`)
          .get(fromLineId, client.userId);
        const approved = db
          .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
          .get(from.household_id, toLineId);
        if ((!member && !childLogin) || !approved) {
          send(ws, { type: "voicemail.monitor.skip", reason: "not-allowed" });
          return;
        }
        const target = findByLine(toLineId);
        if (!target) {
          send(ws, { type: "voicemail.monitor.skip", reason: "offline" });
          return;
        }
        send(target.ws, msg);
        console.log(`[vm-monitor] offer ${fromLineId}→${toLineId}`);
        return;
      }
      // answer / ice / stop: relay between caller and recipient
      if (type === "voicemail.monitor.answer" && client.lineId !== toLineId) {
        return;
      }
      if (
        type !== "voicemail.monitor.answer" &&
        client.lineId !== fromLineId &&
        client.lineId !== toLineId
      ) {
        return;
      }
      const otherId = client.lineId === fromLineId ? toLineId : fromLineId;
      const target = findByLine(otherId);
      if (target) send(target.ws, msg);
      if (type === "voicemail.monitor.stop") {
        console.log(`[vm-monitor] stop ${fromLineId}↔${toLineId}`);
      }
      return;
    }

    // —— Group call (mesh, max 4) ——
    if (type === "group.start") {
      const fromLineId = String(msg.fromLineId || client.lineId || "");
      const toLineIds = Array.isArray(msg.toLineIds)
        ? (msg.toLineIds as unknown[]).map((x) => String(x)).filter(Boolean)
        : [];
      if (!fromLineId || fromLineId !== client.lineId) {
        send(ws, { type: "group.error", error: "Bad caller" });
        return;
      }
      const unique = [...new Set(toLineIds.filter((id) => id !== fromLineId))];
      if (!unique.length) {
        send(ws, { type: "group.error", error: "Pick at least one contact" });
        return;
      }
      if (unique.length + 1 > MAX_GROUP) {
        send(ws, { type: "group.error", error: `Group calls are limited to ${MAX_GROUP} people` });
        return;
      }
      for (const to of unique) {
        const check = canCall(db, fromLineId, to);
        if (!check.ok) {
          send(ws, { type: "group.error", error: check.reason });
          return;
        }
      }
      const online = unique.filter((id) => findByLine(id));
      if (!online.length) {
        send(ws, {
          type: "group.error",
          error: "Nobody’s phone is open right now. Ask them to keep PhoneHome open.",
        });
        return;
      }
      const roomId = `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const room: GroupRoom = {
        id: roomId,
        hostLineId: fromLineId,
        members: new Set([fromLineId]),
        invited: new Set(online),
        createdAt: Date.now(),
      };
      groupRooms.set(roomId, room);
      for (const to of online) {
        logCall(db, fromLineId, to, "ringing");
        const target = findByLine(to);
        if (target) {
          send(target.ws, {
            type: "group.invite",
            roomId,
            hostLineId: fromLineId,
            fromLineId,
            members: roomMemberList(room),
            invited: [...room.invited],
          });
        }
      }
      send(ws, {
        type: "group.started",
        roomId,
        hostLineId: fromLineId,
        members: roomMemberList(room),
        invited: [...room.invited],
      });
      console.log(`[group] start ${roomId} host=${fromLineId} invite=${online.join(",")}`);
      return;
    }

    if (type === "group.accept") {
      const roomId = String(msg.roomId || "");
      const lineId = String(msg.lineId || client.lineId || "");
      const room = groupRooms.get(roomId);
      if (!room || lineId !== client.lineId) {
        send(ws, { type: "group.error", error: "Group call not found" });
        return;
      }
      if (!room.invited.has(lineId) && !room.members.has(lineId)) {
        send(ws, { type: "group.error", error: "You weren’t invited to this group" });
        return;
      }
      room.invited.delete(lineId);
      room.members.add(lineId);
      const members = roomMemberList(room);
      fanoutGroup(room, {
        type: "group.peer-joined",
        roomId,
        lineId,
        hostLineId: room.hostLineId,
        members,
        invited: [...room.invited],
      });
      console.log(`[group] accept ${roomId} ${lineId} members=${members.length}`);
      return;
    }

    if (type === "group.reject") {
      const roomId = String(msg.roomId || "");
      const lineId = String(msg.lineId || client.lineId || "");
      const room = groupRooms.get(roomId);
      if (!room || lineId !== client.lineId) return;
      room.invited.delete(lineId);
      const host = findByLine(room.hostLineId);
      if (host) {
        send(host.ws, {
          type: "group.peer-declined",
          roomId,
          lineId,
          invited: [...room.invited],
          members: roomMemberList(room),
        });
      }
      if (room.members.size <= 1 && room.invited.size === 0) {
        endGroupRoom(roomId, "No one else joined");
      }
      return;
    }

    if (type === "group.leave") {
      const roomId = String(msg.roomId || "");
      const lineId = String(msg.lineId || client.lineId || "");
      const room = groupRooms.get(roomId);
      if (!room || lineId !== client.lineId) return;
      room.members.delete(lineId);
      room.invited.delete(lineId);
      if (lineId === room.hostLineId || room.members.size === 0) {
        endGroupRoom(roomId, lineId === room.hostLineId ? "Host ended the group call" : "Call ended");
        return;
      }
      fanoutGroup(room, {
        type: "group.peer-left",
        roomId,
        lineId,
        members: roomMemberList(room),
        invited: [...room.invited],
      });
      if (room.members.size < 2 && room.invited.size === 0) {
        endGroupRoom(roomId, "Everyone left");
      }
      return;
    }

    if (type === "group.offer" || type === "group.answer" || type === "group.ice") {
      const toLineId = String(msg.toLineId || "");
      const target = findByLine(toLineId);
      if (target) send(target.ws, msg);
      else console.log(`[group] ${type} no peer ${toLineId}`);
      return;
    }
  });

  ws.on("close", () => {
    if (client.lineId) {
      // Only mark offline if this was still the active socket for the line
      const still = findByLine(client.lineId);
      if (!still || still === client) {
        db.prepare(`UPDATE lines SET online = 0 WHERE id = ?`).run(client.lineId);
        const open = db
          .prepare(
            `SELECT id, from_line_id, to_line_id FROM call_logs
             WHERE outcome = 'ringing' AND ended_at IS NULL AND to_line_id = ?`
          )
          .all(client.lineId) as { id: string; from_line_id: string; to_line_id: string }[];
        for (const row of open) {
          endCallLog(db, row.id, "missed");
          endLiveCall(row.id, row.from_line_id, row.to_line_id);
          const caller = findByLine(row.from_line_id);
          if (caller) {
            send(caller.ws, {
              type: "call.rejected",
              callId: row.id,
              reason: "They closed the page before answering",
            });
          }
          console.log(`[call] missed (disconnect) ${row.id}`);
        }
        // Connected calls must end too — otherwise "answered" rows accrue talk time forever.
        const active = db
          .prepare(
            `SELECT id, from_line_id, to_line_id FROM call_logs
             WHERE outcome = 'answered' AND ended_at IS NULL
               AND (from_line_id = ? OR to_line_id = ?)`
          )
          .all(client.lineId, client.lineId) as {
          id: string;
          from_line_id: string;
          to_line_id: string;
        }[];
        for (const row of active) {
          endCallLog(db, row.id, "ended");
          endLiveCall(row.id, row.from_line_id, row.to_line_id);
          const peerId =
            row.from_line_id === client.lineId ? row.to_line_id : row.from_line_id;
          const peer = findByLine(peerId);
          if (peer) {
            send(peer.ws, {
              type: "call.hangup",
              callId: row.id,
              fromLineId: row.from_line_id,
              toLineId: row.to_line_id,
              reason: "peer-disconnected",
            });
          }
          console.log(`[call] completed (disconnect) ${row.id}`);
        }
        clearLiveCallsForLine(client.lineId);
        const hid = householdIdForLine(client.lineId);
        if (hid) fanoutPresenceToHousehold(hid);
        for (const room of [...groupRooms.values()]) {
          if (!room.members.has(client.lineId) && !room.invited.has(client.lineId)) continue;
          room.members.delete(client.lineId);
          room.invited.delete(client.lineId);
          if (client.lineId === room.hostLineId || room.members.size === 0) {
            endGroupRoom(room.id, "Someone disconnected");
          } else {
            fanoutGroup(room, {
              type: "group.peer-left",
              roomId: room.id,
              lineId: client.lineId,
              members: roomMemberList(room),
              invited: [...room.invited],
            });
          }
        }
      }
    }
    clients.delete(client);
  });
});
setInterval(() => {
  try {
    const expired = expireStaleRings(db, RING_TIMEOUT_MS);
    for (const row of expired) {
      endLiveCall(row.id, row.from_line_id, row.to_line_id);
      const caller = findByLine(row.from_line_id);
      if (caller) {
        send(caller.ws, {
          type: "call.rejected",
          callId: row.id,
          reason: "No answer",
        });
      }
      const callee = findByLine(row.to_line_id);
      if (callee) {
        send(callee.ws, {
          type: "call.hangup",
          callId: row.id,
          fromLineId: row.from_line_id,
          toLineId: row.to_line_id,
          reason: "no-answer",
        });
      }
      console.log(`[call] missed (ring timeout) ${row.id}`);
    }
    const orphans = finalizeOrphanAnsweredCalls(db);
    if (orphans) console.log(`[call] finalized ${orphans} orphan answered call(s)`);
    const staleActive = expireStaleAnswered(db, MAX_ACTIVE_CALL_MS);
    for (const row of staleActive) {
      endLiveCall(row.id, row.from_line_id, row.to_line_id);
      for (const lineId of [row.from_line_id, row.to_line_id]) {
        const peer = findByLine(lineId);
        if (peer) {
          send(peer.ws, {
            type: "call.hangup",
            callId: row.id,
            fromLineId: row.from_line_id,
            toLineId: row.to_line_id,
            reason: "max-duration",
          });
        }
      }
      console.log(`[call] completed (max duration) ${row.id}`);
    }
  } catch (e) {
    console.error("[call] maintenance tick failed", e);
  }
}, 5_000);
server.listen(PORT, () => {
  console.log("");
  console.log(`PhoneHome → http://127.0.0.1:${PORT}`);
  if (boot.fresh && boot.setupCode) {
    console.log("");
    console.log("╔══════════════════════════════════════╗");
    console.log(`║  HOST SETUP CODE:  ${boot.setupCode}           ║`);
    console.log("╚══════════════════════════════════════╝");
    console.log("Open the site → “I’m hosting” → enter this code.");
    console.log("");
    fs.writeFileSync(path.join(DATA_DIR, "HOST_CODE.txt"), `${boot.setupCode}\n`);
  } else {
    console.log("Database already initialized. Fresh start: rm -rf data && restart.");
    console.log("");
  }
  fs.writeFileSync(
    path.join(DATA_DIR, "bootstrap.json"),
    JSON.stringify(
      {
        port: PORT,
        setupCode: boot.fresh ? boot.setupCode : undefined,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
});
