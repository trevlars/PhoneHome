import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { sessionCookieOptions } from "./sessionCookie.js";
import { createAttemptLimiter, type AttemptLimiter } from "./attemptLimiter.js";
import {
  TerminalSignalBuffer,
  type TerminalHangupSignal,
} from "./terminalSignalBuffer.js";
import {
  CALL_LIFECYCLE_CONTRACT_VERSION,
  CallLifecycleEventType,
  CallPhase,
  CallTerminalOutcome,
  callEnvelopeMatches,
  createCallLifecycle,
  restoreLegacyCallLifecycle,
  transitionCallLifecycle,
  type CallLifecycleEvent,
  type CallLifecycleState,
  type CallTransitionResult,
} from "./callLifecycle.js";
import {
  devicesToStopRinging,
  isSecondDevice,
  keepSocketOnClaim,
  sameDevice,
} from "./callDevices.js";
import { freepbxSyncConfigured, rebootAtaViaFreepbx, syncAtaSipSecretToFreepbx } from "./freepbxSync.js";
import { ataLanPushEnabled, ataSetupModeForDevice } from "./ataSetup.js";
import {
  analogCircleTalkPeers,
  groupSignalingRole,
  meshTalkPeerIds,
} from "./treehouseListen.js";
import {
  addAllowlist,
  addContactToParentSphere,
  linkVisibleContactToParentSphere,
  addGuardianByUsername,
  addLine,
  bootstrapAdmin,
  canCall,
  canManageChild,
  canManageHouseholdChildState,
  canManageHouseholdSettings,
  canAdminProvisionedRelativeLine,
  userCanOperateLine,
  provisionedRelativeAdminSnapshot,
  assertProvisionedRelativeAllowlistTarget,
  createGuardianInvite,
  createHousehold,
  createInvite,
  canCreateHouseholdInvite,
  declineAllowlist,
  ensureSphereForParent,
  getSphereByOwner,
  listHouseholdParentSpheres,
  listSphereMemberLineIds,
  removeLineFromSphere,
  renameSphere,
  setLineSphereAccess,
  setKidAuntUncle,
  listFamilyRoomMembers,
  addFamilyRoomMember,
  removeFamilyRoomMember,
  familyRoomCandidateLines,
  canJoinTreeHouse,
  listFamilyRoomAlwaysAllowedLineIds,
  listFamilyRoomTalkPairs,
  listTreeHouseKidLineIds,
  addFamilyRoomTalkPair,
  removeFamilyRoomTalkPair,
  canTalkInTreeHouse,
  treeHouseTalkPeers,
  MAX_FAMILY_ROOM,
  listAdultFamilyRoomMembers,
  addAdultFamilyRoomMember,
  removeAdultFamilyRoomMember,
  adultFamilyRoomCandidateLines,
  canJoinAdultFamilyRoom,
  listFamilyRoomChoicesForLine,
  isHouseholdOwner,
  updateUserProfile,
  setHouseholdParentTitle,
  householdAdminParentLine,
  householdSecondaryParentLine,
  householdHomeParentLine,
  listHouseholdParentLines,
  parentDisplayLabel,
  peerLabelForCall,
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
  peekInvite,
  issueInviteClaimToken,
  issueGuardianClaimToken,
  peekJoinToken,
  redeemJoinToken,
  familyJoinShareText,
  guardianJoinShareText,
  registerParent,
  provisionGrandparent,
  issueGrandparentSetupToken,
  redeemGrandparentSetupToken,
  grandparentSetupShareText,
  resetProvisionedRelativePassword,
  updateProvisionedRelativeLogin,
  updateOwnGrandparentKidNickname,
  leaveVoicemailForContact,
  leaveVoicemailFromBridge,
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
  adminResetPassword,
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
  lineIsBusy,
  busyCallRejection,
  getSessionUser,
  getAtaByLineId,
  getAtaByProvisionToken,
  getAtaBySipExtension,
  upsertAtaDevice,
  deleteAtaDevice,
  deleteChildLine,
  deleteParentAccount,
  publicAta,
  defaultSipServer,
  resolveAtaSipServer,
  syncAtaPublicSipHostsFromEnv,
  ataConfigXmlForDevice,
  ataConfigTxtForDevice,
  ataConfigForDevice,
  recordAtaProvisionHit,
  recordAtaConfigDownload,
  recordAtaLanPushResult,
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
  deriveAtaParentPhase,
  deriveAtaStatus,
  parseBridgeSipStatus,
  shouldAttemptFxsInbound,
  unknownSipStatus,
  type AtaParentPhase,
  type AtaStatusKind,
  type BridgeSipStatus,
} from "./ataStatus.js";
import { spokenFor } from "./unavailableVoice.js";
import {
  HOME_OG_IMAGE_PATH,
  HOME_OG_IMAGE_SIZE,
  INVITE_OG_IMAGE_PATH,
  INVITE_OG_IMAGE_SIZE,
  applyLinkPreviewMeta,
  familyInviteCodeFromRequest,
  gpClaimTokenFromRequest,
  gpShareCanonicalUrl,
  homeCanonicalUrl,
  invitePreviewCopy,
  inviteShareCanonicalUrl,
  joinClaimTokenFromRequest,
  joinShareCanonicalUrl,
  lookupInviterPreviewName,
  lookupInviterPreviewNameFromJoinToken,
  previewImageUrl,
} from "./invitePreview.js";
import { getMothershipStats } from "./mothershipLimits.js";
import {
  activateHostLicense,
  bootstrapHostLicenseFromEnv,
  ensureTrialStarted,
  ensureHostInstanceId,
  getHostLicenseStatus,
  hostLicenseAllowsCalls,
  isHostLicenseExemptPath,
} from "./hostLicense.js";
import { applyHostNetwork, readHostNetworkConfig } from "./hostNetworkSetup.js";
import { departHousehold, exportHouseholdForMigrate, importHouseholdFromMigrate } from "./migrateMothership.js";
import {
  acceptInboundPeer,
  createPeerInvite,
  drainPeerSignals,
  enqueuePeerSignal,
  ensurePeerServerSchema,
  forwardSignalToPeer,
  getTrustedPeer,
  listPeerServers,
  localAllowlistAllows,
  recordOutboundPeer,
} from "./peerServers.js";
import {
  addMothershipOperator,
  assertMothershipOperator,
  getMothershipBillingAdminSnapshot,
  getMothershipBillingSettings,
  markCirclePaid,
  removeMothershipOperator,
  updateCircleBilling,
  updateMothershipBillingSettings,
} from "./mothershipBilling.js";
import {
  getMothershipAdminSnapshot,
  listAdminAtaTargets,
  resolveUserIdForAdmin,
  type AdminAtaSipHealth,
} from "./mothershipAdmin.js";
import { openDb, type AtaDevice, type Household, type Line, type LineType } from "./db.js";
import {
  deleteAndroidTokensForLine,
  deleteIosVoipTokensForLine,
  deletePushDevice,
  filterIosWakeTokensExcludingCallerLine,
  listAndroidTokensForLine,
  listIosVoipReceivingLineIds,
  listIosAlertTokensForLine,
  listIosVoipTokensForLine,
  replaceAndroidTokenLines,
  replaceIosAlertTokenLines,
  replaceIosVoipTokenLines,
  setPushDeviceApnsEnv,
} from "./pushDevices.js";
import {
  apnsEnvName,
  iosCallKitMode,
  iosCallKitPushEnabled,
  isApnsBadDeviceToken,
  shouldSendVoipPush,
} from "./apnsVoip.js";
import {
  pushDeliveryConfigured,
  sendIosAlertPush,
  sendIosVoipPush,
} from "./pushGatewayClient.js";
import { fcmConfigured, sendFcmCall, sendFcmVoicemail } from "./fcmPush.js";
import { refreshManagedEntitlements } from "./managedEntitlements.js";

/**
 * Remote Download config is only safe if FreePBX already holds this secret.
 * Sync first; if sync is configured and fails, refuse the download so parents
 * never install a file that cannot REGISTER.
 */
async function ensureFreepbxHasAtaSecret(ata: {
  line_id: string;
  sip_extension: string;
  sip_password: string;
  sip_server?: string | null;
  display_name?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sipServer =
    resolveAtaSipServer({ line_id: ata.line_id, sip_server: ata.sip_server || "" }, db) || "";
  const ataRow = getAtaByLineId(db, ata.line_id);
  const sync = await syncAtaSipSecretToFreepbx(ata.sip_extension, ata.sip_password, {
    sipServer,
    displayName: ata.display_name,
    setupMode: ataRow ? ataSetupModeForDevice(db, ataRow) : "download",
  });
  if (sync.ok) return { ok: true };
  console.warn(
    `[freepbx-sync] fail ext=${ata.sip_extension} err=${sync.error} (download blocked)`
  );
  return {
    ok: false,
    error:
      "Couldn’t prepare the house-phone line on the phone system yet. Wait a minute and try Download again — " +
      "don’t upload an old file until this works, or the adapter won’t register.",
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
  // LAN TURN avoids eero hairpin when both phones are home but host↔host ICE fails
  // (iOS local-network permission / AP quirks). Safe to advertise alongside public TURN.
  // Set TURN_LAN_URLS to the LAN address of coturn. There is no default host.
  // Wrong LAN TURN → ICE stuck in "checking" / silent calls on home Wi‑Fi.
  const turnLanUrls = (process.env.TURN_LAN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allTurn = [...new Set([...turnUrls, ...turnLanUrls])];
  // TCP fallback when UDP TURN is blocked (cellular / strict Wi‑Fi).
  const withTransport: string[] = [];
  for (const u of allTurn) {
    withTransport.push(u);
    if (u.startsWith("turn:") && !u.includes("?transport=")) {
      withTransport.push(`${u}?transport=tcp`);
    }
  }
  const uniqTurn = [...new Set(withTransport)];
  if (uniqTurn.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({
      urls: uniqTurn,
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
void refreshManagedEntitlements().catch((error) => {
  console.warn(`[control] initial entitlement refresh failed: ${(error as Error).message}`);
});
setInterval(() => {
  void refreshManagedEntitlements().catch((error) => {
    console.warn(`[control] entitlement refresh failed: ${(error as Error).message}`);
  });
}, 60_000).unref();
const ataHostSync = syncAtaPublicSipHostsFromEnv(db);
if (ataHostSync > 0) {
  console.log(`Synced ${ataHostSync} ATA sip_server row(s) to mothership host`);
}

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

ensureTrialStarted(DATA_DIR);
bootstrapHostLicenseFromEnv(DATA_DIR);
ensurePeerServerSchema(db);

app.get("/api/health", (_req, res) => {
  const license = getHostLicenseStatus(DATA_DIR);
  res.json({
    ok: true,
    service: "phonehome",
    stage: 1,
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "") || null,
    /** True when this Mothership can attempt HT801 LAN push — not the parent app client. */
    ataLanPush: ataLanPushEnabled(),
    mothership: getMothershipStats(db),
    license: {
      state: license.state,
      daysLeft: license.daysLeft,
      instanceId: license.instanceId,
    },
  });
});

app.get("/api/ice", (_req, res) => {
  res.json({ iceServers: buildIceServers() });
});

function isLoopbackRequest(req: express.Request): boolean {
  const raw = String(req.ip || req.socket.remoteAddress || "");
  return (
    raw === "127.0.0.1" ||
    raw === "::1" ||
    raw === "::ffff:127.0.0.1" ||
    raw.endsWith("127.0.0.1")
  );
}

app.get("/api/bootstrap", (req, res) => {
  const initialized = Boolean(db.prepare(`SELECT 1 FROM sessions LIMIT 1`).get());
  const license = getHostLicenseStatus(DATA_DIR);
  let setupCode: string | null = null;
  // Loopback only — never expose the host setup code on a public hostname.
  if (!initialized && isLoopbackRequest(req)) {
    try {
      const fromFile = fs.readFileSync(path.join(DATA_DIR, "HOST_CODE.txt"), "utf8").trim();
      if (/^\d{6}$/.test(fromFile)) setupCode = fromFile;
    } catch {
      /* missing */
    }
    if (!setupCode && boot.fresh && boot.setupCode) setupCode = boot.setupCode;
  }
  const network =
    !initialized && isLoopbackRequest(req) ? readHostNetworkConfig(DATA_DIR) : undefined;
  res.json({
    initialized,
    hostSetupHint: initialized
      ? null
      : setupCode
        ? "Enter the Mothership setup code to claim this server as the host."
        : "Use the printed setup code from server logs / HOST_CODE.txt on first boot",
    setupCode,
    license,
    network,
  });
});

/** Loopback (first-run dashboard) or authenticated Mothership operator. */
function allowHostNetworkConfig(req: express.Request, res: express.Response): boolean {
  if (isLoopbackRequest(req)) return true;
  const user = requireUser(req, res);
  if (!user) return false;
  try {
    assertMothershipOperator(db, user.id);
    return true;
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
    return false;
  }
}

app.get("/api/host/network", (req, res) => {
  if (!allowHostNetworkConfig(req, res)) return;
  res.json(readHostNetworkConfig(DATA_DIR));
});

app.post("/api/host/network", async (req, res) => {
  if (!allowHostNetworkConfig(req, res)) return;
  const body = (req.body || {}) as {
    publicBaseUrl?: string;
    duckDnsDomain?: string;
    duckDnsToken?: string;
    duckDnsHttpsPort?: string;
    testDuckDns?: boolean;
  };
  try {
    const result = await applyHostNetwork(DATA_DIR, {
      publicBaseUrl: body.publicBaseUrl,
      duckDnsDomain: body.duckDnsDomain,
      duckDnsToken: body.duckDnsToken,
      duckDnsHttpsPort: body.duckDnsHttpsPort,
      testDuckDns: Boolean(body.testDuckDns),
    });
    if (!result.ok) {
      return res.status(400).json({
        error: result.error,
        duckDnsStatus: result.duckDnsStatus,
        config: result.config,
      });
    }
    res.json({
      ok: true,
      saved: result.saved,
      duckDnsStatus: result.duckDnsStatus,
      config: result.config,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || "Could not save network settings" });
  }
});

app.get("/api/license", (_req, res) => {
  res.json(getHostLicenseStatus(DATA_DIR));
});

app.post("/api/license/activate", (req, res) => {
  const blob = String(req.body?.license || req.body?.key || "").trim();
  if (!blob) return res.status(400).json({ error: "license required" });
  const result = activateHostLicense(DATA_DIR, blob);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result.status);
});

app.use((req, res, next) => {
  if (isHostLicenseExemptPath(req.path)) return next();
  const license = getHostLicenseStatus(DATA_DIR);
  if (hostLicenseAllowsCalls(license)) return next();
  if (req.method === "GET" || req.method === "HEAD") {
    // Allow read-only parent UI data while locked so hosts see the paywall.
    if (
      req.path === "/api/households" ||
      req.path.startsWith("/api/households/") ||
      req.path.startsWith("/api/mothership")
    ) {
      return next();
    }
  }
  return res.status(402).json({
    error: "host_license_locked",
    license,
  });
});

// 6-digit invite / guardian codes are guessable without a cap (~10⁶ space).
const inviteCodeLimiter = createAttemptLimiter({ maxFailures: 10, windowMs: 15 * 60e3 });
const inviteCodeIpLimiter = createAttemptLimiter({ maxFailures: 30, windowMs: 15 * 60e3 });
const loginLimiter = createAttemptLimiter({ maxFailures: 10, windowMs: 15 * 60e3 });
const loginIpLimiter = createAttemptLimiter({ maxFailures: 50, windowMs: 15 * 60e3 });
// Setup codes are 6 digits with no username — much tighter per-IP budget than passwords.
const setupCodeIpLimiter = createAttemptLimiter({ maxFailures: 10, windowMs: 15 * 60e3 });

/** Sends 429 and returns true when any bucket is over its failure budget. */
function rejectIfLimited(
  res: express.Response,
  checks: [AttemptLimiter, string[]][]
): boolean {
  let wait = 0;
  for (const [limiter, keys] of checks) wait = Math.max(wait, limiter.retryAfter(keys) || 0);
  if (!wait) return false;
  res.setHeader("Retry-After", String(wait));
  res.status(429).json({ error: "Too many tries — wait a few minutes and try again" });
  return true;
}

function inviteAttemptChecks(req: express.Request, userId: string): [AttemptLimiter, string[]][] {
  return [
    [inviteCodeLimiter, [`u:${userId}`]],
    [inviteCodeIpLimiter, [`ip:${req.ip}`]],
  ];
}

function recordAttempt(checks: [AttemptLimiter, string[]][], ok: boolean): void {
  for (const [limiter, keys] of checks) {
    if (!ok) limiter.fail(keys);
    else if (
      limiter !== inviteCodeIpLimiter &&
      limiter !== loginIpLimiter &&
      limiter !== setupCodeIpLimiter
    ) {
      limiter.succeed(keys);
    }
  }
}

app.post("/api/auth/login", (req, res) => {
  const body = (req.body || {}) as { username?: string; password?: string; code?: string };
  const codeLogin = !body.username && !body.password && Boolean(body.code);
  const checks: [AttemptLimiter, string[]][] = [
    [codeLogin ? setupCodeIpLimiter : loginIpLimiter, [`ip:${req.ip}`]],
    ...(body.username
      ? ([[loginLimiter, [`user:${String(body.username).trim().toLowerCase()}`]]] as [
          AttemptLimiter,
          string[],
        ][])
      : []),
  ];
  if (rejectIfLimited(res, checks)) return;
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
      recordAttempt(checks, true);
      res.cookie("kl_session", session.id, sessionCookieOptions(req));
      return res.json({ user: pub(user), sessionId: session.id });
    }
    if (!code) return res.status(400).json({ error: "Username/password or setup code required" });
    const { user, session } = loginWithSetupCode(db, String(code), displayName);
    recordAttempt(checks, true);
    res.cookie("kl_session", session.id, sessionCookieOptions(req));
    res.json({ user: pub(user), sessionId: session.id });
  } catch (e) {
    recordAttempt(checks, false);
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/auth/register", (req, res) => {
  try {
    const { displayName, username, password, inviteCode } = req.body as {
      displayName?: string;
      username?: string;
      password?: string;
      inviteCode?: string;
    };
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    let profile_role: "parent" | "grandparent" | undefined;
    if (inviteCode) {
      try {
        const peek = peekInvite(db, String(inviteCode));
        if (peek.kind === "grandparent") profile_role = "grandparent";
      } catch {
        /* invalid code — register still works; redeem will fail later */
      }
    }
    const result = registerParent(db, displayName || "Parent", {
      username: String(username),
      password: String(password),
      profile_role,
    });
    res.cookie("kl_session", result.sessionId, sessionCookieOptions(req));
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
  res.clearCookie("kl_session", sessionCookieOptions(req));
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
    res.clearCookie("kl_session", sessionCookieOptions(req));
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.patch("/api/me/kid-nickname", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const nickname = String((req.body || {}).nickname ?? (req.body || {}).kidNickname ?? "");
    const result = updateOwnGrandparentKidNickname(db, user.id, nickname);
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
    const fresh = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as typeof user;
    res.json({
      user: publicUser(fresh || user, { isChildOnly: isChildOnlyAccount(db, user.id) }),
      ...snap,
      userIncluded: true,
    });
  } catch (e) {
    console.error("[api/me]", e);
    // Session is valid — don't strand a fresh login behind a snapshot bug.
    res.status(500).json({ error: "Could not load your account. Try again." });
  }
});

app.get("/api/mothership/billing", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    res.json(getMothershipBillingAdminSnapshot(db));
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

/**
 * Full Mothership operator console: pods, lines, health, operators, billing.
 * Optional ?refresh=1 forces live ATA SIP checks (otherwise uses ~20s cache).
 */
app.get("/api/mothership/admin", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    const force = String(req.query.refresh || "") === "1";
    const sipByLine = await collectAdminAtaSipHealth(force);
    res.json(getMothershipAdminSnapshot(db, { ataSipByLineId: sipByLine }));
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

app.post("/api/mothership/users/reset-password", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    const body = (req.body || {}) as {
      username?: string;
      userId?: string;
      password?: string;
    };
    const targetId = resolveUserIdForAdmin(db, {
      userId: body.userId,
      username: body.username,
    });
    if (targetId === user.id) {
      return res.status(400).json({ error: "Use Account settings to change your own password" });
    }
    const target = db
      .prepare(`SELECT username, display_name FROM users WHERE id = ?`)
      .get(targetId) as { username: string | null; display_name: string } | undefined;
    if (!target?.username) {
      return res.status(400).json({ error: "That account has no username yet" });
    }
    const password = String(body.password || "");
    adminResetPassword(db, target.username, password);
    console.log(
      `[audit] mothership operator password reset by user_id=${user.id} for username=${target.username} user_id=${targetId}`
    );
    res.json({
      ok: true,
      user_id: targetId,
      username: target.username,
      display_name: target.display_name,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.patch("/api/mothership/billing/settings", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    const body = (req.body || {}) as {
      enabled?: boolean;
      enforcement?: string;
      default_monthly_cents?: number | null;
      grace_days?: number;
      payment_instructions?: string | null;
    };
    const settings = updateMothershipBillingSettings(db, {
      enabled: body.enabled,
      enforcement: body.enforcement as Parameters<typeof updateMothershipBillingSettings>[1]["enforcement"],
      default_monthly_cents: body.default_monthly_cents,
      grace_days: body.grace_days,
      payment_instructions: body.payment_instructions,
    });
    res.json({ settings, snapshot: getMothershipBillingAdminSnapshot(db) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.patch("/api/mothership/billing/circles/:lineId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    if (!getMothershipBillingSettings(db).enabled) {
      return res.status(400).json({ error: "Enable Circle billing first" });
    }
    const body = (req.body || {}) as {
      status?: string;
      monthly_cents?: number | null;
      note?: string | null;
      grace_until?: string | null;
    };
    const row = updateCircleBilling(db, req.params.lineId, {
      status: body.status as Parameters<typeof updateCircleBilling>[2]["status"],
      monthly_cents: body.monthly_cents,
      note: body.note,
      grace_until: body.grace_until,
    });
    res.json({ circle: row });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/mothership/billing/circles/:lineId/mark-paid", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    if (!getMothershipBillingSettings(db).enabled) {
      return res.status(400).json({ error: "Enable Circle billing first" });
    }
    const row = markCirclePaid(db, req.params.lineId);
    res.json({ circle: row });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/mothership/operators", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const body = (req.body || {}) as { userId?: string; username?: string };
    const targetId = resolveUserIdForAdmin(db, {
      userId: body.userId,
      username: body.username,
    });
    addMothershipOperator(db, user.id, targetId);
    res.json({ ok: true, operators: getMothershipBillingAdminSnapshot(db).operators });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/mothership/operators/:userId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    removeMothershipOperator(db, user.id, req.params.userId);
    res.json({ ok: true, operators: getMothershipBillingAdminSnapshot(db).operators });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Leave & take my Pod — export roster (not whole DB). See docs/migrate-mothership.md */
app.post("/api/households/:id/migrate/export", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdSettings(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = exportHouseholdForMigrate(db, req.params.id, {
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").trim() || null,
  });
  if ("error" in result) return res.status(404).json(result);
  res.json(result);
});

/** Restore a Pod on this mothership from a migrate export / device transfer. */
app.post("/api/migrate/import", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (isChildOnlyAccount(db, user.id)) {
    return res.status(403).json({ error: "Parent account required" });
  }
  const payload = req.body?.export ?? req.body;
  const result = importHouseholdFromMigrate(db, user.id, payload);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post("/api/households/:id/migrate/depart", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdSettings(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const removeAll = Boolean(req.body?.removeAllMembers);
  const result = departHousehold(db, req.params.id, {
    actingUserId: user.id,
    removeAllMembers: removeAll,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

/** Stage 3 — mothership peering (docs/family-mesh.md). */
app.get("/api/peers", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    res.json({
      peers: listPeerServers(db).map((p) => ({
        id: p.id,
        name: p.name,
        signaling_url: p.signaling_url,
        trusted: Boolean(p.trusted),
        peer_instance_id: p.peer_instance_id,
        created_at: p.created_at,
      })),
    });
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

app.post("/api/peers/invite", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    const base =
      (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    const invite = createPeerInvite(db, {
      name: String(req.body?.name || "Family peer"),
      localSignalingUrl: base,
      localInstanceId: ensureHostInstanceId(DATA_DIR),
    });
    res.status(201).json(invite);
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

app.post("/api/peers/accept", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    const peerId = String(req.body?.peerId || "").trim();
    const inviteToken = String(req.body?.inviteToken || req.body?.token || "").trim();
    const remoteSignalingUrl = String(req.body?.signalingUrl || "").trim();
    const remoteInstanceId = String(req.body?.instanceId || "").trim();
    if (!peerId || !inviteToken || !remoteSignalingUrl || !remoteInstanceId) {
      return res.status(400).json({ error: "peerId, token, signalingUrl, instanceId required" });
    }
    // Complete invite on the inviting mothership (this node issued the token).
    const accepted = acceptInboundPeer(db, {
      peerId,
      inviteToken,
      remoteSignalingUrl,
      remoteInstanceId,
      remotePublicKey: String(req.body?.publicKey || "") || null,
      remoteName: String(req.body?.name || "") || undefined,
    });
    if (!accepted.ok) return res.status(400).json({ error: accepted.error });
    res.json({ peer: accepted.peer });
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

/** Join a peer invite from another mothership (operator on the joining host). */
app.post("/api/peers/join", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    assertMothershipOperator(db, user.id);
    const inviteUrl = String(req.body?.inviteUrl || "").trim();
    const signalingUrl = String(req.body?.signalingUrl || "").trim();
    const peerId = String(req.body?.peerId || "").trim();
    const token = String(req.body?.token || "").trim();
    const remoteBase = signalingUrl || (inviteUrl ? new URL(inviteUrl).origin : "");
    let resolvedPeer = peerId;
    let resolvedToken = token;
    if (inviteUrl) {
      const u = new URL(inviteUrl);
      resolvedPeer = resolvedPeer || u.searchParams.get("peer") || "";
      resolvedToken = resolvedToken || u.searchParams.get("token") || "";
    }
    if (!remoteBase || !resolvedPeer || !resolvedToken) {
      return res.status(400).json({ error: "inviteUrl or signalingUrl+peerId+token required" });
    }
    const localBase =
      (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    const localInstance = ensureHostInstanceId(DATA_DIR);
    const acceptRes = await fetch(`${remoteBase.replace(/\/$/, "")}/api/peers/accept-remote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        peerId: resolvedPeer,
        inviteToken: resolvedToken,
        signalingUrl: localBase,
        instanceId: localInstance,
        name: String(req.body?.name || "Peer mothership"),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!acceptRes.ok) {
      const err = await acceptRes.json().catch(() => ({}));
      return res.status(400).json({ error: err.error || "Remote peer accept failed" });
    }
    const remoteMeta = (await acceptRes.json()) as { fromInstanceId?: string };
    const peer = recordOutboundPeer(db, {
      name: String(req.body?.name || "Family peer"),
      signalingUrl: remoteBase,
      peerInstanceId: String(remoteMeta.fromInstanceId || resolvedPeer),
    });
    res.status(201).json({ peer });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Unauthenticated accept from a joining mothership (token proves invite). */
app.post("/api/peers/accept-remote", (req, res) => {
  const peerId = String(req.body?.peerId || "").trim();
  const inviteToken = String(req.body?.inviteToken || "").trim();
  const remoteSignalingUrl = String(req.body?.signalingUrl || "").trim();
  const remoteInstanceId = String(req.body?.instanceId || "").trim();
  const accepted = acceptInboundPeer(db, {
    peerId,
    inviteToken,
    remoteSignalingUrl,
    remoteInstanceId,
    remotePublicKey: String(req.body?.publicKey || "") || null,
    remoteName: String(req.body?.name || "") || undefined,
  });
  if (!accepted.ok) return res.status(400).json({ error: accepted.error });
  res.json({
    ok: true,
    fromInstanceId: ensureHostInstanceId(DATA_DIR),
    peer: {
      id: accepted.peer.id,
      name: accepted.peer.name,
      trusted: true,
    },
  });
});

app.post("/api/peers/:peerId/signal", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const peer = getTrustedPeer(db, req.params.peerId);
  if (!peer) return res.status(404).json({ error: "Trusted peer not found" });
  const fromLineId = String(req.body?.fromLineId || "").trim();
  const toLineId = String(req.body?.toLineId || "").trim();
  const fromHousehold = db
    .prepare(`SELECT household_id FROM lines WHERE id = ?`)
    .get(fromLineId) as { household_id: string } | undefined;
  if (!fromHousehold) return res.status(400).json({ error: "Unknown from line" });
  const remoteRef = `peer:${peer.id}:${toLineId}`;
  if (
    !localAllowlistAllows(db, fromHousehold.household_id, remoteRef) &&
    !localAllowlistAllows(db, fromHousehold.household_id, toLineId)
  ) {
    return res.status(403).json({ error: "Not on Circle allowlist for this peer line" });
  }
  const forwarded = await forwardSignalToPeer(peer, {
    fromLineId,
    toLineId,
    payload: req.body?.payload ?? req.body,
    fromInstanceId: ensureHostInstanceId(DATA_DIR),
  });
  if (!forwarded.ok) return res.status(502).json({ error: forwarded.error });
  res.json({ ok: true });
});

app.post("/api/peers/inbound-signal", (req, res) => {
  const fromInstance = String(req.headers["x-phonehome-peer-instance"] || "").trim();
  const toLineId = String(req.body?.toLineId || "").trim();
  const fromLineId = String(req.body?.fromLineId || "").trim();
  if (!fromInstance || !toLineId || !fromLineId) {
    return res.status(400).json({ error: "peer instance + line ids required" });
  }
  const peer = listPeerServers(db).find(
    (p) => p.trusted && p.peer_instance_id === fromInstance
  );
  if (!peer) return res.status(403).json({ error: "Untrusted peer instance" });
  const id = enqueuePeerSignal(db, {
    peerId: peer.id,
    fromLineId,
    toLineId,
    payload: req.body?.payload ?? req.body,
  });
  res.status(202).json({ id });
});

app.get("/api/peers/:peerId/signals", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!getTrustedPeer(db, req.params.peerId)) {
    return res.status(404).json({ error: "Trusted peer not found" });
  }
  res.json({ signals: drainPeerSignals(db, req.params.peerId) });
});

app.post("/api/households", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    // One family-name Pod per parent — a repeat submit returns the Pod they already own.
    const owned = db
      .prepare(`SELECT * FROM households WHERE owner_user_id = ? ORDER BY created_at LIMIT 1`)
      .get(user.id);
    if (owned) return res.json({ household: owned, existing: true });
    const { name } = req.body as { name?: string };
    const household = createHousehold(db, user.id, name || "Family");
    res.json({ household });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.patch("/api/households/:id/rules", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdSettings(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  try {
    const household = updateHouseholdRules(db, req.params.id, req.body, {
      actorUserId: user.id,
    });
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
  const { name, type, mode, child_label } = req.body as {
    name?: string;
    type?: LineType;
    mode?: "parent" | "child";
    child_label?: string | null;
  };
  if (mode != null && mode !== "parent" && mode !== "child") {
    return res.status(400).json({ error: "mode must be parent or child" });
  }
  const line = addLine(
    db,
    req.params.id,
    user.id,
    name || (mode === "child" ? "Kid" : "App"),
    type || "softphone",
    { mode, child_label }
  );
  res.json({ line });
});

app.patch("/api/households/:id/lines/:lineId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (
    !canManageChild(db, user.id, req.params.lineId) &&
    !userInHousehold(db, req.params.id, user.id) &&
    !canAdminProvisionedRelativeLine(db, user.id, req.params.lineId)
  ) {
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
    const claimToken = issueGuardianClaimToken(db, invite, user.id);
    const base = publicBaseUrl(req);
    const joinUrl = `${base}/?join=${encodeURIComponent(claimToken)}`;
    const kidRow = db.prepare(`SELECT child_label, name FROM lines WHERE id = ?`).get(invite.line_id) as
      | { child_label: string | null; name: string }
      | undefined;
    const kidLabel = kidRow?.child_label || kidRow?.name || "our kid";
    const given = String(user.display_name || "")
      .trim()
      .split(/\s+/)[0] || "";
    res.json({
      invite,
      claimToken,
      publicBaseUrl: base,
      shareUrl: joinUrl,
      shareText: guardianJoinShareText({
        joinUrl,
        kidLabel,
        inviterGivenName: given,
      }),
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/guardian-invites/redeem", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const checks = inviteAttemptChecks(req, user.id);
  if (rejectIfLimited(res, checks)) return;
  try {
    const { code, householdName } = (req.body || {}) as {
      code?: string;
      householdName?: string;
    };
    const result = redeemGuardianInvite(db, user.id, String(code || ""), {
      householdName: householdName ? String(householdName) : undefined,
    });
    recordAttempt(checks, true);
    res.json(result);
  } catch (e) {
    recordAttempt(checks, false);
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Peek a one-tap `/?join=` invite (no session required). */
app.get("/api/join/peek", (req, res) => {
  try {
    const peek = peekJoinToken(db, String(req.query.token || ""));
    res.json(peek);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Redeem a one-tap join link after sign-in / create account. */
app.post("/api/join/redeem", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { token, householdName } = (req.body || {}) as {
      token?: string;
      householdName?: string;
    };
    const result = redeemJoinToken(db, user.id, String(token || ""), {
      householdName: householdName ? String(householdName) : undefined,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/households/:id/grandparents", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const body = (req.body || {}) as {
      displayName?: string;
      username?: string;
      password?: string;
      householdName?: string;
      label?: string;
      kidNickname?: string;
      kidLineIds?: string[];
    };
    if (!body.displayName || !body.username || !body.password) {
      return res.status(400).json({ error: "Name, username, and password are required" });
    }
    const result = provisionGrandparent(db, user.id, req.params.id, {
      displayName: String(body.displayName),
      username: String(body.username),
      password: String(body.password),
      householdName: body.householdName ? String(body.householdName) : undefined,
      label: body.label ? String(body.label) : undefined,
      kidNickname: body.kidNickname !== undefined ? String(body.kidNickname) : undefined,
      kidLineIds: Array.isArray(body.kidLineIds) ? body.kidLineIds.map(String) : [],
    });
    const base = publicBaseUrl(req);
    const setupUrl = `${base}/?gp=${encodeURIComponent(result.setupToken)}`;
    res.json({
      relative: result.relative,
      username: result.username,
      password: result.password,
      line: result.line,
      household: result.household,
      setupToken: result.setupToken,
      setupExpiresAt: result.setupExpiresAt,
      setupUrl,
      shareText: grandparentSetupShareText(
        result.relative.display_label || result.relative.display_name,
        setupUrl
      ),
      flash: `Login ready for ${result.relative.display_name}`,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Fresh one-tap setup link for an existing grandparent (re-share / expired). */
app.post("/api/households/:id/grandparents/:relativeId/setup-link", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const issued = issueGrandparentSetupToken(db, user.id, req.params.id, req.params.relativeId);
    const base = publicBaseUrl(req);
    const setupUrl = `${base}/?gp=${encodeURIComponent(issued.token)}`;
    res.json({
      relative: issued.relative,
      setupToken: issued.token,
      setupExpiresAt: issued.expiresAt,
      setupUrl,
      shareText: grandparentSetupShareText(issued.displayName, setupUrl),
      flash: `Setup link ready for ${issued.displayName}`,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** One-tap Grandma claim — no prior session; mints theirs. */
app.post("/api/grandparent-setup/redeem", (req, res) => {
  try {
    const { token } = (req.body || {}) as { token?: string };
    const result = redeemGrandparentSetupToken(db, String(token || ""));
    const pub = (u: Parameters<typeof publicUser>[0]) =>
      publicUser(u, { isChildOnly: isChildOnlyAccount(db, u.id) });
    res.cookie("kl_session", result.session.id, sessionCookieOptions(req));
    res.json({
      user: pub(result.user),
      sessionId: result.session.id,
      displayName: result.displayName,
      flash: `Signed in as ${result.displayName}`,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/households/:id/grandparents/:relativeId/reset-password", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { password } = (req.body || {}) as { password?: string };
    if (!password) return res.status(400).json({ error: "password required" });
    const result = resetProvisionedRelativePassword(
      db,
      user.id,
      req.params.id,
      req.params.relativeId,
      String(password)
    );
    res.json({ ...result, password: String(password), flash: result.message });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/households/:id/grandparents/:relativeId/admin", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const admin = provisionedRelativeAdminSnapshot(db, user.id, req.params.id, req.params.relativeId);
    res.json(admin);
  } catch (e) {
    const msg = (e as Error).message;
    const status = /only parents|not found|missing/i.test(msg) ? 403 : 400;
    res.status(status).json({ error: msg });
  }
});

app.patch("/api/households/:id/grandparents/:relativeId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const body = (req.body || {}) as {
      displayName?: string;
      username?: string;
      label?: string;
      password?: string;
      kidNickname?: string;
      kidLineIds?: string[];
    };
    const result = updateProvisionedRelativeLogin(db, user.id, req.params.id, req.params.relativeId, {
      displayName: body.displayName !== undefined ? String(body.displayName) : undefined,
      username: body.username !== undefined ? String(body.username) : undefined,
      label: body.label !== undefined ? String(body.label) : undefined,
      kidNickname: body.kidNickname !== undefined ? String(body.kidNickname) : undefined,
      password: body.password !== undefined ? String(body.password) : undefined,
      kidLineIds: Array.isArray(body.kidLineIds)
        ? body.kidLineIds.map((id) => String(id))
        : undefined,
    });
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
    const body = (req.body || {}) as { kind?: string; targetKidLineId?: string };
    const invite = createInvite(db, req.params.id, user.id, {
      kind: body.kind,
      targetKidLineId: body.targetKidLineId,
    });
    const claimToken = issueInviteClaimToken(db, invite, user.id);
    const base = publicBaseUrl(req);
    const joinUrl = `${base}/?join=${encodeURIComponent(claimToken)}`;
    const peek = peekInvite(db, invite.code);
    const given = String(user.display_name || "")
      .trim()
      .split(/\s+/)[0] || "";
    res.json({
      invite,
      claimToken,
      publicBaseUrl: base,
      shareUrl: joinUrl,
      shareText: familyJoinShareText({
        kind: invite.kind,
        joinUrl,
        fromHouseholdName: peek.fromHouseholdName,
        inviterGivenName: given,
        targetKidLabel: peek.targetKidLabel,
      }),
    });
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

app.get("/api/invites/peek", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const checks = inviteAttemptChecks(req, user.id);
  if (rejectIfLimited(res, checks)) return;
  try {
    const peek = peekInvite(db, String(req.query.code || ""));
    res.json(peek);
  } catch (e) {
    recordAttempt(checks, false);
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/invites/redeem", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const checks = inviteAttemptChecks(req, user.id);
  if (rejectIfLimited(res, checks)) return;
  try {
    const { code, householdName } = req.body as { code?: string; householdName?: string };
    const result = redeemInvite(db, String(code || ""), user.id, householdName || "Family");
    recordAttempt(checks, true);
    res.json(result);
  } catch (e) {
    recordAttempt(checks, false);
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/households/:id/allowlist", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdSettings(db, user.id, req.params.id)) {
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
    assertProvisionedRelativeAllowlistTarget(db, user.id, req.params.id, targetLineId);
    const entry = addAllowlist(db, req.params.id, targetLineId, label || "Contact", {
      speedDial,
      favorite,
      alwaysAllow,
      actorUserId: user.id,
    });
    res.json({ entry });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Rename the signed-in parent’s circle (one sphere per parent). */
app.patch("/api/households/:id/spheres/mine", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  if (isChildOnlyAccount(db, user.id)) {
    return res.status(403).json({ error: "Only parents have a circle" });
  }
  try {
    const { name } = (req.body || {}) as { name?: string };
    const sphere = renameSphere(db, user.id, name || "");
    res.json({ sphere });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/**
 * Link an existing PhoneHome line into this parent’s circle (same identity —
 * no duplicate contact). Also ensure household allowlist row when needed.
 */
app.post("/api/households/:id/spheres/mine/members", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  if (isChildOnlyAccount(db, user.id)) {
    return res.status(403).json({ error: "Only parents can edit their circle" });
  }
  const { targetLineId, label, alwaysAllow } = (req.body || {}) as {
    targetLineId?: string;
    label?: string;
    alwaysAllow?: boolean;
  };
  if (!targetLineId) return res.status(400).json({ error: "targetLineId required" });
  try {
    // Invite-first / already-visible only — never browse Alex’s friends to add.
    const sphere = linkVisibleContactToParentSphere(db, user.id, targetLineId);
    const existing = db
      .prepare(`SELECT * FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(req.params.id, targetLineId);
    let entry = existing;
    if (!existing) {
      entry = addAllowlist(db, req.params.id, targetLineId, label || "Contact", {
        alwaysAllow,
        actorUserId: user.id,
      });
    }
    res.json({
      sphere,
      entry,
      member_line_ids: listSphereMemberLineIds(db, sphere.id),
    });
  } catch (e) {
    const msg = (e as Error).message || "Could not add to circle";
    if (/not found/i.test(msg)) return res.status(404).json({ error: "Contact not found" });
    res.status(400).json({ error: msg });
  }
});

/** Remove a line from *this* parent’s circle only — other circles keep the same identity. */
app.delete("/api/households/:id/spheres/mine/members/:lineId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  if (isChildOnlyAccount(db, user.id)) {
    return res.status(403).json({ error: "Only parents can edit their circle" });
  }
  const sphere = getSphereByOwner(db, user.id) || ensureSphereForParent(db, user.id);
  removeLineFromSphere(db, sphere.id, req.params.lineId);
  res.json({ ok: true, sphere_id: sphere.id, line_id: req.params.lineId });
});

/** Which parent circles appear on a kid line’s speed dial (union; contacts deduped by line id). */
app.put("/api/households/:id/lines/:lineId/sphere-access", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  const { sphereIds } = (req.body || {}) as { sphereIds?: string[] };
  try {
    const ids = setLineSphereAccess(db, req.params.id, req.params.lineId, sphereIds || []);
    res.json({
      line_id: req.params.lineId,
      sphere_access: ids,
      spheres: listHouseholdParentSpheres(db, req.params.id),
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.put("/api/lines/:lineId/aunts-uncles/:adultLineId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { on } = (req.body || {}) as { on?: boolean };
    const options = setKidAuntUncle(db, user.id, req.params.lineId, req.params.adultLineId, Boolean(on));
    res.json({ line_id: req.params.lineId, aunt_uncle_options: options });
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

/** Parent-only: list FamilyRoom candidates + current approvals. */
app.get("/api/households/:id/family-room", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  const always = new Set(listFamilyRoomAlwaysAllowedLineIds(db, req.params.id));
  const approved = new Set([
    ...always,
    ...listFamilyRoomMembers(db, req.params.id).map((m) => m.line_id),
  ]);
  res.json({
    members: listFamilyRoomMembers(db, req.params.id),
    always: [...always],
    talk_pairs: listFamilyRoomTalkPairs(db, req.params.id),
    candidates: familyRoomCandidateLines(db, req.params.id).map((c) => ({
      ...c,
      approved: approved.has(c.line_id),
      always: always.has(c.line_id),
    })),
    max: MAX_FAMILY_ROOM,
  });
});

/** Parent-only: approve a line for FamilyRoom. */
app.post("/api/households/:id/family-room/members", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  if (isChildOnlyAccount(db, user.id)) {
    return res.status(403).json({ error: "Only parents can manage TreeHouse" });
  }
  const { lineId } = (req.body || {}) as { lineId?: string };
  if (!lineId) return res.status(400).json({ error: "lineId required" });
  try {
    const member = addFamilyRoomMember(db, req.params.id, lineId, user.id);
    res.json({
      member,
      members: listFamilyRoomMembers(db, req.params.id),
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Parent-only: revoke FamilyRoom access. */
app.delete("/api/households/:id/family-room/members/:lineId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  if (isChildOnlyAccount(db, user.id)) {
    return res.status(403).json({ error: "Only parents can manage TreeHouse" });
  }
  try {
    removeFamilyRoomMember(db, req.params.id, req.params.lineId, user.id);
    res.json({ ok: true, members: listFamilyRoomMembers(db, req.params.id) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Parent-only: add undirected talk pair (A↔B hear each other). */
app.post("/api/households/:id/family-room/talk-pairs", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  if (isChildOnlyAccount(db, user.id)) {
    return res.status(403).json({ error: "Only parents can manage TreeHouse" });
  }
  const { lineA, lineB } = (req.body || {}) as { lineA?: string; lineB?: string };
  if (!lineA || !lineB) return res.status(400).json({ error: "lineA and lineB required" });
  try {
    const pair = addFamilyRoomTalkPair(db, req.params.id, lineA, lineB, user.id);
    res.json({ pair, talk_pairs: listFamilyRoomTalkPairs(db, req.params.id) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Parent-only: remove undirected talk pair. */
app.delete("/api/households/:id/family-room/talk-pairs/:lineA/:lineB", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this household" });
  }
  if (isChildOnlyAccount(db, user.id)) {
    return res.status(403).json({ error: "Only parents can manage TreeHouse" });
  }
  try {
    removeFamilyRoomTalkPair(db, req.params.id, req.params.lineA, req.params.lineB, user.id);
    res.json({ ok: true, talk_pairs: listFamilyRoomTalkPairs(db, req.params.id) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// TreeHouse HTTP: /tree-house canonical; /play-room + /family-room kept as aliases.
function mountTreeHouseHttpAliases(aliasBase: string) {
  app.get(`/api/households/:id/${aliasBase}`, (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
      return res.status(403).json({ error: "Not authorized for this household" });
    }
    const always = new Set(listFamilyRoomAlwaysAllowedLineIds(db, req.params.id));
    const approved = new Set([
      ...always,
      ...listFamilyRoomMembers(db, req.params.id).map((m) => m.line_id),
    ]);
    res.json({
      members: listFamilyRoomMembers(db, req.params.id),
      always: [...always],
      talk_pairs: listFamilyRoomTalkPairs(db, req.params.id),
      candidates: familyRoomCandidateLines(db, req.params.id).map((c) => ({
        ...c,
        approved: approved.has(c.line_id),
        always: always.has(c.line_id),
      })),
      max: MAX_FAMILY_ROOM,
    });
  });
  app.post(`/api/households/:id/${aliasBase}/members`, (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
      return res.status(403).json({ error: "Not authorized for this household" });
    }
    if (isChildOnlyAccount(db, user.id)) {
      return res.status(403).json({ error: "Only parents can manage TreeHouse" });
    }
    const { lineId } = (req.body || {}) as { lineId?: string };
    if (!lineId) return res.status(400).json({ error: "lineId required" });
    try {
      const member = addFamilyRoomMember(db, req.params.id, lineId, user.id);
      res.json({ member, members: listFamilyRoomMembers(db, req.params.id) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.delete(`/api/households/:id/${aliasBase}/members/:lineId`, (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
      return res.status(403).json({ error: "Not authorized for this household" });
    }
    if (isChildOnlyAccount(db, user.id)) {
      return res.status(403).json({ error: "Only parents can manage TreeHouse" });
    }
    try {
      removeFamilyRoomMember(db, req.params.id, req.params.lineId, user.id);
      res.json({ ok: true, members: listFamilyRoomMembers(db, req.params.id) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.post(`/api/households/:id/${aliasBase}/talk-pairs`, (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
      return res.status(403).json({ error: "Not authorized for this household" });
    }
    if (isChildOnlyAccount(db, user.id)) {
      return res.status(403).json({ error: "Only parents can manage TreeHouse" });
    }
    const { lineA, lineB } = (req.body || {}) as { lineA?: string; lineB?: string };
    if (!lineA || !lineB) return res.status(400).json({ error: "lineA and lineB required" });
    try {
      const pair = addFamilyRoomTalkPair(db, req.params.id, lineA, lineB, user.id);
      res.json({ pair, talk_pairs: listFamilyRoomTalkPairs(db, req.params.id) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.delete(`/api/households/:id/${aliasBase}/talk-pairs/:lineA/:lineB`, (req, res) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!canManageHouseholdChildState(db, user.id, req.params.id)) {
      return res.status(403).json({ error: "Not authorized for this household" });
    }
    if (isChildOnlyAccount(db, user.id)) {
      return res.status(403).json({ error: "Only parents can manage TreeHouse" });
    }
    try {
      removeFamilyRoomTalkPair(db, req.params.id, req.params.lineA, req.params.lineB, user.id);
      res.json({ ok: true, talk_pairs: listFamilyRoomTalkPairs(db, req.params.id) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
}
mountTreeHouseHttpAliases("tree-house");
mountTreeHouseHttpAliases("play-room");

app.patch("/api/user/profile", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { parent_title, profile_role } = (req.body || {}) as {
      parent_title?: string | null;
      profile_role?: string | null;
    };
    const updated = updateUserProfile(db, user.id, {
      parent_title: parent_title as import("./api.js").ParentTitle | "" | null,
      profile_role: profile_role as "parent" | "grandparent" | "" | null | undefined,
    });
    res.json({ user: publicUser(updated, { isChildOnly: isChildOnlyAccount(db, user.id) }) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Set Mom/Dad for the home parent or co-parent on this household’s kid pads. */
app.patch("/api/households/:id/parent-titles", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { user_id, parent_title } = (req.body || {}) as {
      user_id?: string;
      parent_title?: string | null;
    };
    if (!user_id) return res.status(400).json({ error: "user_id required" });
    const updated = setHouseholdParentTitle(
      db,
      user.id,
      req.params.id,
      user_id,
      parent_title as import("./api.js").ParentTitle | "" | null
    );
    res.json({ user: publicUser(updated, { isChildOnly: isChildOnlyAccount(db, updated.id) }) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Household admin: list FamilyRoom candidates + approvals (kids and adults). */
app.get("/api/households/:id/adult-family-room", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isHouseholdOwner(db, req.params.id, user.id)) {
    return res.status(403).json({ error: "Only the household admin can manage FamilyRoom" });
  }
  const approved = new Set(listAdultFamilyRoomMembers(db, req.params.id).map((m) => m.line_id));
  res.json({
    members: listAdultFamilyRoomMembers(db, req.params.id),
    always: [],
    candidates: adultFamilyRoomCandidateLines(db, req.params.id).map((c) => ({
      ...c,
      approved: approved.has(c.line_id),
      always: false,
    })),
    max: MAX_FAMILY_ROOM,
  });
});

app.post("/api/households/:id/adult-family-room/members", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isHouseholdOwner(db, req.params.id, user.id)) {
    return res.status(403).json({ error: "Only the household admin can manage FamilyRoom" });
  }
  const { lineId } = (req.body || {}) as { lineId?: string };
  if (!lineId) return res.status(400).json({ error: "lineId required" });
  try {
    const member = addAdultFamilyRoomMember(db, req.params.id, lineId, user.id);
    res.json({ member, members: listAdultFamilyRoomMembers(db, req.params.id) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/households/:id/adult-family-room/members/:lineId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isHouseholdOwner(db, req.params.id, user.id)) {
    return res.status(403).json({ error: "Only the household admin can manage FamilyRoom" });
  }
  try {
    removeAdultFamilyRoomMember(db, req.params.id, req.params.lineId, user.id);
    res.json({ ok: true, members: listAdultFamilyRoomMembers(db, req.params.id) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.patch("/api/households/:id/allowlist/:entryId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageHouseholdSettings(db, user.id, req.params.id)) {
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
  if (!canManageHouseholdSettings(db, user.id, req.params.id)) {
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
 * Softphone WS online OR ATA SIP-registered OR iOS CallKit (VoIP push), each gated by
 * Quiet Time / scheduled quiet hours. Mutates directory entries in place. SIP status
 * is cached with ata-status (~20s).
 */
async function enrichDirectoryPresence(
  directory: { id: string; household_id: string; online: number }[]
): Promise<void> {
  if (!directory.length) return;
  const atas = listAtaDevices(db);

  const iosLockscreenLines = new Set(
    (
      db
        .prepare(`SELECT DISTINCT line_id FROM push_devices WHERE platform = 'ios'`)
        .all() as { line_id: string }[]
    ).map((r) => r.line_id)
  );

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
        body: withAtaParentFields(ata, {
          status,
          registered,
          sip_extension: ata.sip_extension,
          state: sip.state || null,
          confidence: sip.confidence,
          method: sip.method,
          reason: sip.reason || null,
          checked_at: new Date().toISOString(),
        }),
      });
    })
  );

  const hhCache = new Map<string, Household>();
  for (const row of directory) {
    let hh = hhCache.get(row.household_id);
    if (!hh) {
      hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(row.household_id) as
        | Household
        | undefined;
      if (!hh) continue;
      hhCache.set(row.household_id, hh);
    }
    const lineRow = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(row.id) as Line | undefined;
    const online = linePresenceOnline({
      softphoneOnline: Boolean(row.online),
      ataRegistered: Boolean(registeredByLine.get(row.id)),
      iosLockscreenReady: iosLockscreenLines.has(row.id),
      household: hh,
      line: lineRow || undefined,
      lineMode: lineRow?.mode === "child" ? "child" : "parent",
      db,
    });
    row.online = online ? 1 : 0;
  }
}

/** ATA bind/push/download — guardians or Open-their-phone admins; never Pod siblings. */
function canManageLineAta(userId: string, lineId: string, _householdId?: string): boolean {
  if (canManageChild(db, userId, lineId)) return true;
  if (canAdminProvisionedRelativeLine(db, userId, lineId)) return true;
  return false;
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
  phase?: AtaParentPhase;
  setup_mode?: "lan" | "download";
  config_seen?: boolean;
  lan_push_available?: boolean;
  download_ready?: boolean;
  config_downloaded?: boolean;
  config_pulled?: boolean;
  sip_host_kind?: "public" | "lan";
};
function withAtaParentFields(ata: AtaDevice, body: AtaStatusBody): AtaStatusBody {
  const pub = publicAta(ata, db);
  return {
    ...body,
    phase: deriveAtaParentPhase({
      status: body.status,
      lastProvisionAt: ata.last_provision_at,
      lastDownloadAt: ata.last_config_download_at,
    }),
    setup_mode: pub.setup_mode,
    config_seen: pub.config_seen,
    lan_push_available: pub.lan_push_available,
    download_ready: pub.download_ready,
    config_downloaded: pub.config_downloaded,
    config_pulled: pub.config_pulled,
    sip_host_kind: pub.sip_host_kind,
  };
}
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

/** Batch ATA SIP health for Mothership admin (uses parent status cache). */
async function collectAdminAtaSipHealth(
  force = false
): Promise<Map<string, AdminAtaSipHealth>> {
  const out = new Map<string, AdminAtaSipHealth>();
  const targets = listAdminAtaTargets(db);
  const now = Date.now();

  await Promise.all(
    targets.map(async ({ line_id, sip_extension }) => {
      const cached = ataStatusCache.get(line_id);
      if (!force && cached && now - cached.at < ATA_STATUS_TTL_MS) {
        out.set(line_id, {
          status: (cached.body.phase || cached.body.status) as AdminAtaSipHealth["status"],
          registered: Boolean(cached.body.registered),
          reason: cached.body.reason,
          checked_at: cached.body.checked_at,
          cached: true,
        });
        return;
      }
      const ata = getAtaByLineId(db, line_id);
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
        const full = ata ? withAtaParentFields(ata, body) : body;
        ataStatusCache.set(line_id, { at: Date.now(), body: full });
        out.set(line_id, {
          status: "not_configured",
          registered: false,
          checked_at,
          cached: false,
        });
        return;
      }
      const sip = await fetchBridgeSipStatus(sip_extension);
      const { status, registered } = deriveAtaStatus(sip);
      const body = withAtaParentFields(ata, {
        status,
        registered,
        sip_extension: ata.sip_extension,
        state: sip.state || null,
        confidence: sip.confidence,
        method: sip.method,
        reason: sip.reason || null,
        checked_at,
      });
      ataStatusCache.set(line_id, { at: Date.now(), body });
      out.set(line_id, {
        status: (body.phase || body.status) as AdminAtaSipHealth["status"],
        registered,
        reason: body.reason,
        checked_at,
        cached: false,
      });
    })
  );

  // ATAs without SIP password still show as not_configured
  for (const row of db
    .prepare(
      `SELECT line_id FROM ata_devices
       WHERE sip_extension IS NULL OR TRIM(IFNULL(sip_extension,'')) = ''
          OR sip_password IS NULL OR TRIM(IFNULL(sip_password,'')) = ''`
    )
    .all() as { line_id: string }[]) {
    if (out.has(row.line_id)) continue;
    out.set(row.line_id, {
      status: "not_configured",
      registered: false,
      reason: "No SIP credentials yet",
    });
  }

  return out;
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
    ata: ata ? publicAta(ata, db) : null,
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
    freepbx_sync_configured: freepbxSyncConfigured(),
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
    const pub = ata ? publicAta(ata, db) : null;
    const body: AtaStatusBody = {
      status: "not_configured",
      registered: false,
      sip_extension: ata?.sip_extension || null,
      state: null,
      confidence: null,
      method: null,
      reason: null,
      checked_at,
      phase: "not_configured",
      setup_mode: pub?.setup_mode ?? "download",
      config_seen: pub?.config_seen ?? false,
      lan_push_available: pub?.lan_push_available ?? false,
      download_ready: pub?.download_ready ?? false,
      config_downloaded: pub?.config_downloaded ?? false,
      config_pulled: pub?.config_pulled ?? false,
      sip_host_kind: pub?.sip_host_kind,
    };
    ataStatusCache.set(lineId, { at: Date.now(), body });
    return res.json(body);
  }

  const sip = await fetchBridgeSipStatus(ata.sip_extension);
  const { status, registered } = deriveAtaStatus(sip);

  const body = withAtaParentFields(ata, {
    status,
    registered,
    sip_extension: ata.sip_extension,
    state: sip.state || null,
    confidence: sip.confidence,
    method: sip.method,
    reason: sip.reason || null,
    checked_at,
  });
  ataStatusCache.set(lineId, { at: Date.now(), body });
  res.json(body);
});

/** Parent: create/update ATA binding. */
app.put("/api/households/:id/lines/:lineId/ata", async (req, res) => {
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

    // Await FreePBX create/secret sync so Save is REGISTER-ready for remote parents.
    let freepbx: { ok: boolean; skipped?: boolean; created?: boolean; error?: string } = {
      ok: true,
      skipped: true,
    };
    if (freepbxSyncConfigured()) {
      const sync = await syncAtaSipSecretToFreepbx(ata.sip_extension, ata.sip_password, {
        sipServer: resolveAtaSipServer(ata, db) || "",
        displayName: ata.display_name,
        setupMode: ataSetupModeForDevice(db, ata),
      });
      if (!sync.ok) {
        console.warn(`[freepbx-sync] upsert fail ext=${ata.sip_extension} err=${sync.error}`);
        freepbx = { ok: false, error: sync.error };
      } else {
        freepbx = { ok: true, skipped: sync.skipped, created: sync.created };
        if (!sync.skipped) {
          console.log(
            `[freepbx-sync] ok ext=${ata.sip_extension}${sync.created ? " created" : ""} mode=${sync.mode || "?"}`
          );
        }
      }
    }

    const base = publicBaseUrl(req);
    res.json({
      ata: publicAta(ata, db),
      freepbx_ready: freepbx.ok,
      freepbx_created: Boolean(freepbx.created),
      freepbx_error: freepbx.error || null,
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

/** Parent: SIP-NOTIFY reboot for their own HT801 (works remotely via FreePBX). */
const ataRebootCooldownUntil = new Map<string, number>();
const ATA_REBOOT_COOLDOWN_MS = 60_000;

app.post("/api/households/:id/lines/:lineId/ata/reboot", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!canManageLineAta(user.id, req.params.lineId, req.params.id)) {
    return res.status(403).json({ error: "Not authorized for this line" });
  }
  const ata = getAtaByLineId(db, req.params.lineId);
  if (!ata) return res.status(404).json({ error: "No adapter connected for this kid yet" });
  if (normalizeAtaModel(ata.model) !== "ht801") {
    return res.status(400).json({ error: "Remote reboot is only for Grandstream HT801 right now" });
  }
  if (!ata.sip_extension) {
    return res.status(400).json({ error: "Save connection details first" });
  }
  if (!freepbxSyncConfigured()) {
    return res.status(503).json({
      error: "Remote reboot isn’t available on this Mothership yet (FreePBX sync not configured).",
    });
  }

  const lineId = req.params.lineId;
  const until = ataRebootCooldownUntil.get(lineId) || 0;
  if (Date.now() < until) {
    const waitSec = Math.ceil((until - Date.now()) / 1000);
    return res.status(429).json({
      error: `Adapter reboot already requested — wait about ${waitSec}s, then try again.`,
      cooldown_ms: until - Date.now(),
    });
  }

  const result = await rebootAtaViaFreepbx(ata.sip_extension);
  if (!result.ok) {
    console.warn(`[ata/reboot] fail line=${lineId} ext=${ata.sip_extension} err=${result.error}`);
    return res.status(502).json({
      error:
        result.error ||
        "Couldn’t reach the phone system to reboot the adapter. Try again in a minute.",
    });
  }
  if (result.skipped) {
    return res.status(503).json({
      error: "Remote reboot isn’t available on this Mothership yet (FreePBX sync not configured).",
    });
  }

  ataRebootCooldownUntil.set(lineId, Date.now() + ATA_REBOOT_COOLDOWN_MS);
  ataStatusCache.delete(lineId);
  console.log(`[ata/reboot] ok line=${lineId} ext=${ata.sip_extension}`);
  res.json({
    ok: true,
    sip_extension: ata.sip_extension,
    message:
      "Reboot sent — the house phone will drop for about a minute, then come back. Hang up first if someone’s on a call.",
  });
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
    db,
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
    try {
      recordAtaLanPushResult(db, req.params.lineId, true);
      ataStatusCache.delete(req.params.lineId);
    } catch {
      /* status still works */
    }
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
    if (/can.?t reach|same (home network|Wi)|Download config instead|Mothership|home hub|LAN/i.test(msg)) {
      try {
        recordAtaLanPushResult(db, req.params.lineId, false);
        ataStatusCache.delete(req.params.lineId);
      } catch {
        /* keep going */
      }
    }
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
  // Parent Download records last_config_download_at only — not last_provision_at.
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
      { publicBaseUrl: base, includeConfigServerPath: true, db }
    );
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    try {
      recordAtaConfigDownload(db, ata.line_id);
      ataStatusCache.delete(ata.line_id);
    } catch {
      /* download still succeeds */
    }
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
    const body = ataConfigTxtForDevice(fresh, { publicBaseUrl: base, includeConfigServerPath: true, db });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      recordAtaProvisionHit(db, fresh.line_id);
      ataStatusCache.delete(fresh.line_id);
    } catch {
      /* still serve config */
    }
    res.send(body);
    return;
  }
  const xml = ataConfigXmlForDevice(fresh, { publicBaseUrl: base, includeConfigServerPath: true, db });
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    recordAtaProvisionHit(db, fresh.line_id);
    ataStatusCache.delete(fresh.line_id);
  } catch {
    /* still serve config */
  }
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

/** ATA/softphone no-answer → leave a message (bridge deposits WAV). */
app.post("/api/bridge/voicemails", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { fromLineId, toLineId, audioBase64, audioMime } = (req.body || {}) as {
      fromLineId?: string;
      toLineId?: string;
      audioBase64?: string;
      audioMime?: string;
    };
    if (!fromLineId || !toLineId) return res.status(400).json({ error: "fromLineId and toLineId required" });
    if (!audioBase64) return res.status(400).json({ error: "audioBase64 required" });
    const vm = leaveVoicemailFromBridge(db, fromLineId, toLineId, {
      audioBase64,
      audioMime: audioMime || "audio/wav",
      dataDir: DATA_DIR,
    });
    const unread = db
      .prepare(`SELECT COUNT(*) AS n FROM voicemails WHERE to_line_id = ? AND listened = 0`)
      .get(vm.to_line_id) as { n: number };
    fanoutVoicemailNew(vm.household_id, vm, Number(unread?.n || 1));
    console.log(`[bridge] voicemail deposit ${fromLineId}→${toLineId} id=${vm.id}`);
    res.json({ ok: true, voicemail: { id: vm.id, to_line_id: vm.to_line_id } });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
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

/** Canonical lifecycle for ATA→ATA calls, which otherwise remain entirely in ARI. */
app.post("/api/bridge/calls/begin", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const body = (req.body || {}) as { fromLineId?: string; toLineId?: string };
  const fromLineId = String(body.fromLineId || "").trim();
  const toLineId = String(body.toLineId || "").trim();
  if (!fromLineId || !toLineId || fromLineId === toLineId) {
    return res.status(400).json({ error: "Two distinct line ids are required" });
  }
  try {
    const begin = db.transaction(() => {
      const gate = canCall(db, fromLineId, toLineId);
      if (!gate.ok) throw new Error(gate.reason || "Call not allowed");
      if (lineIsBusy(db, fromLineId)) throw new Error("Caller is already on a call");
      if (lineIsBusy(db, toLineId)) throw new Error("Callee is already on a call");
      const log = logCall(db, fromLineId, toLineId, "ringing");
      beginCallLifecycle(log.id, fromLineId, toLineId);
      markCallLifecycleRinging(log.id);
      return log;
    })();
    publishLiveCall(begin.id, fromLineId, toLineId, "ringing");
    res.json({ ok: true, callId: begin.id, contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION });
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});

app.post("/api/bridge/calls/:callId/event", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const callId = String(req.params.callId || "").trim();
  const body = (req.body || {}) as {
    type?: "ringing" | "connected" | "hold" | "hangup" | "cancel";
    actorLineId?: string;
    idempotencyKey?: string;
    onHold?: boolean;
    reason?: string;
  };
  const state = lifecycleForCall(callId);
  if (!state) return res.status(404).json({ error: "Call not found" });
  const actorLineId = String(body.actorLineId || "").trim();
  const eventKey = String(body.idempotencyKey || `bridge:${body.type || "event"}`).slice(0, 160);
  let event: CallLifecycleEvent;
  switch (body.type) {
    case "ringing":
      event = {
        contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
        type: CallLifecycleEventType.Ringing,
        callId,
        fromLineId: state.fromLineId,
        toLineId: state.toLineId,
        actorLineId: "server",
        idempotencyKey: eventKey,
      };
      break;
    case "connected":
      event = {
        contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
        type: CallLifecycleEventType.FxsPickedUp,
        callId,
        fromLineId: state.fromLineId,
        toLineId: state.toLineId,
        actorLineId: actorLineId || state.toLineId,
        idempotencyKey: eventKey,
      };
      break;
    case "hold":
      event = {
        contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
        type: CallLifecycleEventType.HoldChanged,
        callId,
        fromLineId: state.fromLineId,
        toLineId: state.toLineId,
        actorLineId,
        byLineId: actorLineId,
        onHold: Boolean(body.onHold),
        idempotencyKey: `${eventKey}:${body.onHold ? "on" : "off"}`,
      };
      break;
    case "hangup":
      event = {
        contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
        type: CallLifecycleEventType.Hangup,
        callId,
        fromLineId: state.fromLineId,
        toLineId: state.toLineId,
        actorLineId,
        reason: body.reason || "bridge-hangup",
        idempotencyKey: eventKey,
      };
      break;
    case "cancel":
      event = {
        contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
        type: CallLifecycleEventType.SystemTerminated,
        callId,
        fromLineId: state.fromLineId,
        toLineId: state.toLineId,
        actorLineId: "server",
        reason: body.reason || "no-answer",
        idempotencyKey: eventKey,
      };
      break;
    default:
      return res.status(400).json({ error: "Unknown bridge call event" });
  }
  const result = transitionCallLifecycle(state, event);
  if (!result.accepted) {
    return res.status(409).json({ error: result.rejection, state: result.state });
  }
  if (!result.duplicate) rememberCallLifecycle(result.state);
  if (body.type === "connected") {
    markCallAnswered(db, callId);
    publishLiveCall(callId, state.fromLineId, state.toLineId, "active");
  } else if (body.type === "hangup" || body.type === "cancel") {
    endCallLog(db, callId, body.type === "cancel" && body.reason === "no-answer" ? "missed" : "ended");
    finalizeCallLifecycle(callId);
    endLiveCall(callId, state.fromLineId, state.toLineId);
  }
  res.json({ ok: true, duplicate: result.duplicate, state: result.state });
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
    apnsVoipConfigured: pushDeliveryConfigured(),
    fcmConfigured: fcmConfigured(),
    iosCallKitMode: iosCallKitMode(),
    iosCallKitPush: iosCallKitPushEnabled(),
  });
});

function authorizeLinePushRegistration(
  user: { id: string },
  lineId: string,
  res: import("express").Response
): boolean {
  const line = db.prepare(`SELECT id FROM lines WHERE id = ?`).get(lineId) as { id: string } | undefined;
  if (!line) {
    res.status(404).json({ error: "Line not found" });
    return false;
  }
  // Same gate as softphone claim — Pod peers cannot register push as another parent.
  if (!userCanOperateLine(db, user.id, lineId)) {
    res.status(403).json({ error: "Not allowed for this line" });
    return false;
  }
  return true;
}

/**
 * iOS PushKit token registration.
 *
 * The requested line proves the session can operate PhoneHome, but it is not
 * necessarily this iPhone's receiving identity: parents commonly browse their
 * child's line. Bind the token server-side to the signed-in user's personal
 * parent line(s), or to a child line only when signed in as that child.
 */
app.post("/api/devices/voip-token", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body || {}) as { lineId?: string; voipToken?: string; platform?: string };
  const lineId = String(body.lineId || "").trim();
  const voipToken = String(body.voipToken || "").trim();
  if (!lineId || !voipToken) return res.status(400).json({ error: "lineId and voipToken required" });
  if (!authorizeLinePushRegistration(user, lineId, res)) return;
  try {
    const lineIds = listIosVoipReceivingLineIds(db, user.id);
    const rows = replaceIosVoipTokenLines(db, { userId: user.id, lineIds, voipToken });
    console.log(
      `[push] ios voip token lines=${lineIds.join(",")} requested=${lineId} user=${user.id} …${rows[0]!.voip_token.slice(-8)}`
    );
    res.json({ ok: true, platform: "ios", lineId: lineIds[0], lineIds });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/**
 * Android FCM token. One token covers calls and voicemail.
 * Bound to the signed-in user's receiving lines, same as PushKit.
 */
app.post("/api/devices/fcm-token", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body || {}) as { lineId?: string; fcmToken?: string };
  const lineId = String(body.lineId || "").trim();
  const fcmToken = String(body.fcmToken || "").trim();
  if (!lineId || !fcmToken) return res.status(400).json({ error: "lineId and fcmToken required" });
  if (!authorizeLinePushRegistration(user, lineId, res)) return;
  try {
    const lineIds = listIosVoipReceivingLineIds(db, user.id);
    const rows = replaceAndroidTokenLines(db, { userId: user.id, lineIds, fcmToken });
    console.log(
      `[push] android fcm token lines=${lineIds.join(",")} requested=${lineId} user=${user.id} …${rows[0]!.voip_token.slice(-8)}`
    );
    res.json({ ok: true, platform: "android", lineId: lineIds[0], lineIds });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/devices/fcm-token", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body || {}) as { lineId?: string };
  const lineId = String(body.lineId || req.query.lineId || "").trim();
  if (!lineId) return res.status(400).json({ error: "lineId required" });
  if (!authorizeLinePushRegistration(user, lineId, res)) return;
  const cleared = deleteAndroidTokensForLine(db, lineId);
  console.log(`[push] android fcm tokens cleared line=${lineId} user=${user.id} n=${cleared}`);
  res.json({ ok: true, cleared });
});

/** Drop VoIP tokens when the iPhone turns Lock-screen Answer off. */
app.delete("/api/devices/voip-token", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body || {}) as { lineId?: string };
  const lineId = String(body.lineId || req.query.lineId || "").trim();
  if (!lineId) return res.status(400).json({ error: "lineId required" });
  if (!authorizeLinePushRegistration(user, lineId, res)) return;
  const cleared = deleteIosVoipTokensForLine(db, lineId);
  console.log(`[push] ios voip tokens cleared line=${lineId} user=${user.id} n=${cleared}`);
  res.json({ ok: true, cleared });
});

/**
 * Standard APNs device token (alert notification → open in-app softphone).
 * Preferred when CallKit is tabled (default).
 */
app.post("/api/devices/apns-token", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body || {}) as { lineId?: string; apnsToken?: string; platform?: string };
  const lineId = String(body.lineId || "").trim();
  const apnsToken = String(body.apnsToken || "").trim();
  if (!lineId || !apnsToken) return res.status(400).json({ error: "lineId and apnsToken required" });
  if (!authorizeLinePushRegistration(user, lineId, res)) return;
  try {
    const lineIds = listIosVoipReceivingLineIds(db, user.id);
    const rows = replaceIosAlertTokenLines(db, { userId: user.id, lineIds, apnsToken });
    console.log(
      `[push] ios alert token lines=${lineIds.join(",")} requested=${lineId} user=${user.id} …${rows[0]!.voip_token.slice(-8)}`
    );
    res.json({ ok: true, platform: "ios-alert", lineId: lineIds[0], lineIds });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Pending softphone offer after VoIP wake (SDP held briefly while CallKit answers).
 * Peek only — never take. CallKit WebView remounts must still see the offer on WS hello;
 * destructive take here raced remounts and left ICE-only reconnects with no SDP. */
app.get("/api/calls/pending", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const lineId = String(req.query.lineId || "").trim();
  if (!lineId) return res.status(400).json({ error: "lineId required" });
  const pending = peekPendingOffer(lineId);
  if (!pending) return res.json({ offer: null });
  console.log(`[call] pending offer peek ${pending.callId} → ${lineId}`);
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

function sendAppHtml(req: express.Request, res: express.Response) {
  const indexPath = path.join(WEB_DIR, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  const base = publicBaseUrl(req);
  const query = req.query as Record<string, unknown>;
  const inviteCode = familyInviteCodeFromRequest(req.path, query);
  const joinToken = joinClaimTokenFromRequest(req.path, query);
  const gpToken = gpClaimTokenFromRequest(req.path, query);
  const isInvite = Boolean(inviteCode || joinToken);
  const isSetup = Boolean(gpToken);
  const parentGiven = inviteCode
    ? lookupInviterPreviewName(db, inviteCode)
    : joinToken
      ? lookupInviterPreviewNameFromJoinToken(db, joinToken)
      : "";
  const inviteCopy = isInvite ? invitePreviewCopy(parentGiven) : undefined;
  const canonicalUrl = gpToken
    ? gpShareCanonicalUrl(base, gpToken)
    : joinToken
      ? joinShareCanonicalUrl(base, joinToken)
      : inviteCode
        ? inviteShareCanonicalUrl(base, inviteCode)
        : homeCanonicalUrl(base);
  const useInviteArt = isInvite || isSetup;
  const imageSize = useInviteArt ? INVITE_OG_IMAGE_SIZE : HOME_OG_IMAGE_SIZE;
  html = applyLinkPreviewMeta(html, {
    variant: isSetup ? "setup" : isInvite ? "invite" : "home",
    canonicalUrl,
    imageUrl: previewImageUrl(base, useInviteArt ? INVITE_OG_IMAGE_PATH : HOME_OG_IMAGE_PATH),
    imageWidth: imageSize.width,
    imageHeight: imageSize.height,
    ...(inviteCopy || {}),
  });
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.type("html").send(html);
}

app.get(["/", "/invite/:code", "/join/:code"], sendAppHtml);

app.use(express.static(WEB_DIR, {
  index: false,
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
  sendAppHtml(req, res);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

type Client = {
  ws: WebSocket;
  userId?: string;
  lineId?: string;
  /** True when this socket was minted via /api/bridge/session (FXS claim). */
  isBridge?: boolean;
  /** Login session: the same device across WS reconnects. Never log it. */
  sessionId?: string;
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

type PendingIce = {
  callId: string;
  fromLineId: string;
  toLineId: string;
  candidate: unknown;
  expires: number;
};
/** Offline peer lineId → trickle ICE held until CallKit/WS comes up. */
const pendingIceByLine = new Map<string, PendingIce[]>();
const PENDING_ICE_TTL_MS = 90_000;
const PENDING_ICE_MAX = 64;

type PendingAnswer = {
  callId: string;
  fromLineId: string;
  toLineId: string;
  sdp: unknown;
  early?: boolean;
  expires: number;
};
/** Caller briefly offline while callee answers — hold answer SDP until caller WS hello. */
const pendingAnswerByLine = new Map<string, PendingAnswer>();
const PENDING_ANSWER_TTL_MS = 90_000;

type TerminalCallRow = {
  id: string;
  outcome: string;
  ended_at: string | null;
  from_line_id: string;
  to_line_id: string;
};

/** Brief softphone disconnects must not strand web UI or native CallKit. */
const pendingTerminalSignals = new TerminalSignalBuffer();

function terminalCallRow(callId: string): TerminalCallRow | undefined {
  return db
    .prepare(
      `SELECT id, outcome, ended_at, from_line_id, to_line_id
       FROM call_logs WHERE id = ?`
    )
    .get(callId) as TerminalCallRow | undefined;
}

type CallLifecycleEntry = {
  state: CallLifecycleState;
  touchedAt: number;
};

/** Canonical v1 ownership for WebRTC/FXS calls that cross the hub WS. */
const callLifecyclesById = new Map<string, CallLifecycleEntry>();
const CALL_LIFECYCLE_TERMINAL_TTL_MS = 20 * 60_000;
const CALL_LIFECYCLE_OPEN_TTL_MS = 4 * 60 * 60_000;

function pruneCallLifecycles(): void {
  const now = Date.now();
  for (const [callId, entry] of callLifecyclesById) {
    const terminal =
      entry.state.phase === CallPhase.Terminating || entry.state.phase === CallPhase.Terminal;
    const ttl = terminal ? CALL_LIFECYCLE_TERMINAL_TTL_MS : CALL_LIFECYCLE_OPEN_TTL_MS;
    if (now - entry.touchedAt > ttl) callLifecyclesById.delete(callId);
  }
}

function rememberCallLifecycle(state: CallLifecycleState): CallLifecycleState {
  pruneCallLifecycles();
  callLifecyclesById.set(state.callId, { state, touchedAt: Date.now() });
  db.prepare(
    `INSERT INTO call_lifecycle (call_id, revision, phase, state_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(call_id) DO UPDATE SET
       revision = excluded.revision,
       phase = excluded.phase,
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`
  ).run(
    state.callId,
    state.revision,
    state.phase,
    JSON.stringify(state),
    new Date().toISOString()
  );
  return state;
}

function beginCallLifecycle(callId: string, fromLineId: string, toLineId: string): void {
  let state = createCallLifecycle({ callId, fromLineId, toLineId });
  const routed = transitionCallLifecycle(state, {
    contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
    type: CallLifecycleEventType.RouteStarted,
    callId,
    fromLineId,
    toLineId,
    actorLineId: "server",
  });
  if (routed.accepted) state = routed.state;
  rememberCallLifecycle(state);
}

function markCallLifecycleRinging(callId: string): void {
  const entry = callLifecyclesById.get(callId);
  if (!entry) return;
  const state = entry.state;
  const result = transitionCallLifecycle(state, {
    contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
    type: CallLifecycleEventType.Ringing,
    callId: state.callId,
    fromLineId: state.fromLineId,
    toLineId: state.toLineId,
    actorLineId: "server",
  });
  if (result.accepted) rememberCallLifecycle(result.state);
}

function lifecycleForCall(callId: string): CallLifecycleState | undefined {
  const row = terminalCallRow(callId);
  if (!row) return undefined;
  let entry = callLifecyclesById.get(callId);
  if (!entry) {
    const stored = db
      .prepare(`SELECT state_json FROM call_lifecycle WHERE call_id = ?`)
      .get(callId) as { state_json: string } | undefined;
    if (stored) {
      try {
        const state = JSON.parse(stored.state_json) as CallLifecycleState;
        if (
          state.contractVersion === CALL_LIFECYCLE_CONTRACT_VERSION &&
          state.callId === row.id &&
          state.fromLineId === row.from_line_id &&
          state.toLineId === row.to_line_id
        ) {
          callLifecyclesById.set(callId, { state, touchedAt: Date.now() });
          entry = callLifecyclesById.get(callId);
        }
      } catch {
        // Corrupt lifecycle metadata must not block conservative call-log recovery.
      }
    }
  }
  const dbTerminal =
    Boolean(row.ended_at) || (row.outcome !== "ringing" && row.outcome !== "answered");
  if (
    !entry ||
    entry.state.fromLineId !== row.from_line_id ||
    entry.state.toLineId !== row.to_line_id ||
    (dbTerminal &&
      entry.state.phase !== CallPhase.Terminating &&
      entry.state.phase !== CallPhase.Terminal)
  ) {
    return rememberCallLifecycle(
      restoreLegacyCallLifecycle({
        callId: row.id,
        fromLineId: row.from_line_id,
        toLineId: row.to_line_id,
        outcome: row.outcome,
        endedAt: row.ended_at,
      })
    );
  }
  entry.touchedAt = Date.now();
  return entry.state;
}

function finalizeCallLifecycle(callId: string): void {
  const state = callLifecyclesById.get(callId)?.state;
  if (!state) return;
  const result = transitionCallLifecycle(state, {
    contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
    type: CallLifecycleEventType.Finalized,
    callId: state.callId,
    fromLineId: state.fromLineId,
    toLineId: state.toLineId,
    actorLineId: "server",
  });
  if (result.accepted) rememberCallLifecycle(result.state);
}

function callLifecycleIsOpen(callId: string): boolean {
  const state = lifecycleForCall(callId);
  return Boolean(
    state && state.phase !== CallPhase.Terminating && state.phase !== CallPhase.Terminal
  );
}

function signalFingerprint(value: unknown): string {
  let serialized = "";
  try {
    serialized = JSON.stringify(value ?? null);
  } catch {
    serialized = String(value ?? "");
  }
  return createHash("sha256").update(serialized).digest("hex").slice(0, 24);
}

const CONTRACT_SIGNAL_TYPES = new Set([
  "call.answer",
  "call.accepted",
  "call.ice",
  "call.hold",
  "call.hangup",
  "call.fxs-up",
]);

function lifecycleEventTypeForSignal(type: string): CallLifecycleEvent["type"] | null {
  switch (type) {
    case "call.answer":
      return CallLifecycleEventType.SdpAnswered;
    case "call.accepted":
      return CallLifecycleEventType.UserAccepted;
    case "call.ice":
      return CallLifecycleEventType.Ice;
    case "call.hold":
      return CallLifecycleEventType.HoldChanged;
    case "call.hangup":
      return CallLifecycleEventType.Hangup;
    case "call.fxs-up":
      return CallLifecycleEventType.FxsPickedUp;
    default:
      return null;
  }
}

type CheckedLifecycleSignal = {
  state: CallLifecycleState;
  result: CallTransitionResult;
  message: Record<string, unknown>;
};

/**
 * Legacy clients used sender-relative participants for ICE/hold and omitted
 * canonical participants on hangup. Adapt only those known v0 shapes; v1 is strict.
 */
function canonicalSignalParticipants(
  type: string,
  msg: Record<string, unknown>,
  state: CallLifecycleState,
  actorLineId: string
): { fromLineId: string; toLineId: string } {
  const fromLineId = String(msg.fromLineId || "");
  const toLineId = String(msg.toLineId || "");
  const version = Number(msg.contractVersion || 0);
  if (fromLineId === state.fromLineId && toLineId === state.toLineId) {
    return { fromLineId, toLineId };
  }
  if (
    version === 0 &&
    (type === "call.ice" || type === "call.hold") &&
    fromLineId === state.toLineId &&
    toLineId === state.fromLineId
  ) {
    return { fromLineId: state.fromLineId, toLineId: state.toLineId };
  }
  if (
    version === 0 &&
    (type === "call.hold" || type === "call.hangup") &&
    (actorLineId === state.fromLineId || actorLineId === state.toLineId)
  ) {
    return { fromLineId: state.fromLineId, toLineId: state.toLineId };
  }
  return { fromLineId, toLineId };
}

function checkLifecycleSignal(
  type: string,
  msg: Record<string, unknown>,
  client: Client
): CheckedLifecycleSignal | null {
  if (!CONTRACT_SIGNAL_TYPES.has(type)) return null;
  const callId = String(msg.callId || "").trim();
  const actorLineId = String(client.lineId || "").trim();
  if (!callId || !actorLineId) {
    console.log(`[call] ignored ${type} without canonical call/actor`);
    return null;
  }
  const state = lifecycleForCall(callId);
  if (!state) {
    console.log(`[call] ignored ${type} for unknown call ${callId}`);
    return null;
  }
  const eventType = lifecycleEventTypeForSignal(type);
  if (!eventType) return null;
  const participants = canonicalSignalParticipants(type, msg, state, actorLineId);
  const event: CallLifecycleEvent = {
    contractVersion: Number(msg.contractVersion || 0),
    type: eventType,
    callId,
    fromLineId: participants.fromLineId,
    toLineId: participants.toLineId,
    actorLineId,
    ...(type === "call.answer"
      ? { early: Boolean(msg.early), idempotencyKey: "answer" }
      : {}),
    ...(type === "call.accepted" ? { idempotencyKey: "accepted" } : {}),
    ...(type === "call.ice"
      ? { idempotencyKey: `ice:${signalFingerprint(msg.candidate)}` }
      : {}),
    ...(type === "call.hold"
      ? {
          onHold: Boolean(msg.onHold),
          byLineId: String(msg.byLineId || actorLineId),
        }
      : {}),
    ...(type === "call.hangup" ? { reason: msg.reason } : {}),
  };
  const result = transitionCallLifecycle(state, event);
  if (!result.accepted) {
    console.log(`[call] ignored ${type} ${callId} (${result.rejection})`);
    return null;
  }
  if (!result.duplicate) rememberCallLifecycle(result.state);
  return {
    state: result.state,
    result,
    message: {
      ...msg,
      contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
      callId,
      fromLineId: state.fromLineId,
      toLineId: state.toLineId,
    },
  };
}

function flushPendingTerminalSignals(lineId: string, ws: WebSocket): number {
  return pendingTerminalSignals.flush(lineId, (signal) => {
    const row = terminalCallRow(signal.callId);
    // Only replay a terminal result that the database has finalized for this
    // exact participant. This rejects expired/reused/malformed routing safely.
    if (
      !row?.ended_at ||
      (lineId !== row.from_line_id && lineId !== row.to_line_id) ||
      signal.fromLineId !== row.from_line_id ||
      signal.toLineId !== row.to_line_id
    ) {
      return false;
    }
    send(ws, signal);
    return true;
  });
}

/**
 * Sticky signaling peers for an active call.
 * findByLine() prefers FXS bridge over softphone — that steals answer/ICE when the
 * child line has HT801 claimed. Route answer/ICE/hangup via these sockets instead.
 */
type CallPeers = {
  callId: string;
  fromLineId: string;
  toLineId: string;
  caller: Client;
  callee: Client | null;
  /** First callee-line socket that accepted or answered. See callDevices.ts. */
  answeredBy?: Client | null;
  createdAt: number;
};
const callPeersById = new Map<string, CallPeers>();
const CALL_PEERS_TTL_MS = 15 * 60_000;

function pruneCallPeers(): void {
  const now = Date.now();
  for (const [id, p] of callPeersById) {
    if (now - p.createdAt > CALL_PEERS_TTL_MS) callPeersById.delete(id);
  }
}

function rememberCallPeers(opts: {
  callId: string;
  fromLineId: string;
  toLineId: string;
  caller: Client;
  callee: Client | null;
}): void {
  pruneCallPeers();
  callPeersById.set(opts.callId, { ...opts, createdAt: Date.now() });
}

function updateCallCallee(callId: string, callee: Client): void {
  const p = callPeersById.get(callId);
  if (!p) return;
  p.callee = callee;
}

function clearCallPeers(callId?: string): void {
  if (callId) callPeersById.delete(callId);
}

function socketOpen(c: Client | null | undefined): c is Client {
  return Boolean(c && c.ws?.readyState === c.ws.OPEN);
}

/** Connected socket that took this call, or null. */
function liveCallAnswerer(callId: string): Client | null {
  const owner = callPeersById.get(callId)?.answeredBy;
  return socketOpen(owner) ? owner : null;
}

function sendAnsweredElsewhere(target: Client, callId: string): void {
  const peers = callPeersById.get(callId);
  send(target.ws, {
    type: "call.answered-elsewhere",
    contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
    callId,
    ...(peers ? { fromLineId: peers.fromLineId, toLineId: peers.toLineId } : {}),
  });
}

/** First callee-line accept/answer owns the call; other devices on the line stop ringing. */
function claimCallAnswer(callId: string, client: Client): void {
  if (client.isBridge) return;
  const peers = callPeersById.get(callId);
  if (!peers || client.lineId !== peers.toLineId) return;
  if (isSecondDevice(liveCallAnswerer(callId), client)) return;
  peers.answeredBy = client;
  peers.callee = client;
  for (const other of devicesToStopRinging(client, clients)) {
    if (!socketOpen(other)) continue;
    sendAnsweredElsewhere(other, callId);
    console.log(`[call] ${callId} answered on another device → stop ringing ${other.lineId}`);
  }
}

function softphoneInOpenCall(c: Client): boolean {
  if (c.isBridge || !socketOpen(c)) return false;
  for (const [callId, peers] of callPeersById) {
    if (!callLifecycleIsOpen(callId)) continue;
    if (peers.caller === c || peers.callee === c || peers.answeredBy === c) return true;
  }
  return false;
}

/** Other party for answer / ICE / hangup — prefer sticky peer sockets over findByLine. */
function peerClientForSignal(
  callId: string | undefined,
  sender: Client,
  fromLineId: string,
  toLineId: string
): Client | undefined {
  const otherId = sender.lineId === fromLineId ? toLineId : fromLineId;
  if (callId) {
    const peers = callPeersById.get(callId);
    if (peers) {
      if (sender === peers.caller || sender.lineId === peers.fromLineId) {
        const cal = peers.callee;
        if (cal && cal.ws.readyState === cal.ws.OPEN) return cal;
      }
      if (sender === peers.callee || sender.lineId === peers.toLineId) {
        const clr = peers.caller;
        if (clr && clr.ws.readyState === clr.ws.OPEN) return clr;
      }
    }
  }
  // Fallback: softphone before bridge so leftover FXS claims don't swallow softphone media.
  // Exception: FXS-first lines — prefer the bridge claim so soft→ATA ICE isn't eaten by a
  // softphone still sitting on the kid line during the claim race.
  let soft: Client | undefined;
  let bridge: Client | undefined;
  for (const c of clients) {
    if (c.lineId !== otherId) continue;
    if (c.ws?.readyState !== c.ws.OPEN) continue;
    if (c.isBridge) bridge = c;
    else soft = c;
  }
  if (bridge && getAtaByLineId(db, otherId)) return bridge;
  return soft || bridge;
}

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

/** Push buffered SDP to a live softphone socket (peek — keep until answer/hangup). */
function deliverPendingOfferToClient(client: Client, reason: string): boolean {
  if (!client.lineId || client.isBridge) return false;
  if (!client.ws || client.ws.readyState !== client.ws.OPEN) return false;
  const pending = peekPendingOffer(client.lineId);
  if (!pending) return false;
  // Hangup may race WS remount — never re-ring an already finished call.
  try {
    const row = db
      .prepare(`SELECT outcome, ended_at FROM call_logs WHERE id = ?`)
      .get(pending.callId) as { outcome?: string; ended_at?: string } | undefined;
    if (row?.ended_at || (row?.outcome && row.outcome !== "ringing" && row.outcome !== "answered")) {
      pendingOffers.delete(client.lineId);
      pendingOfferRepushArmed.delete(client.lineId);
      console.log(`[call] skip stale pending offer ${pending.callId} → ${client.lineId} (${row?.outcome || "ended"})`);
      return false;
    }
  } catch {
    /* db may be unavailable in tests — still deliver */
  }
  send(client.ws, {
    type: "call.offer",
    contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
    callId: pending.callId,
    fromLineId: pending.fromLineId,
    toLineId: pending.toLineId,
    sdp: pending.sdp,
  });
  updateCallCallee(pending.callId, client);
  console.log(`[call] delivered pending offer ${pending.callId} → ${client.lineId} (${reason})`);
  return true;
}

/**
 * CallKit / WebView often connects before the JS handler is ready, or remounts
 * mid-ring. Re-push the same peeked offer a few times while still pending.
 * Deduped per line so offer + wake paths don't double-schedule.
 */
const pendingOfferRepushArmed = new Set<string>();
function schedulePendingOfferRepush(lineId: string): void {
  if (!lineId || pendingOfferRepushArmed.has(lineId)) return;
  pendingOfferRepushArmed.add(lineId);
  for (const delayMs of [400, 1200, 2500, 5000]) {
    setTimeout(() => {
      const pending = peekPendingOffer(lineId);
      if (!pending) {
        pendingOfferRepushArmed.delete(lineId);
        return;
      }
      const client = [...clients].find((c) => c.lineId === lineId && !c.isBridge);
      if (!client) return;
      deliverPendingOfferToClient(client, `repush-${delayMs}ms`);
      if (delayMs >= 5000) pendingOfferRepushArmed.delete(lineId);
    }, delayMs);
  }
}

function bufferPendingIce(toLineId: string, entry: Omit<PendingIce, "expires">): void {
  if (!toLineId) return;
  const now = Date.now();
  const list = (pendingIceByLine.get(toLineId) || []).filter((c) => c.expires >= now);
  list.push({ ...entry, expires: now + PENDING_ICE_TTL_MS });
  pendingIceByLine.set(toLineId, list.slice(-PENDING_ICE_MAX));
}

function flushPendingIce(lineId: string, ws: WebSocket): number {
  const list = pendingIceByLine.get(lineId);
  if (!list?.length) return 0;
  pendingIceByLine.delete(lineId);
  const now = Date.now();
  let n = 0;
  for (const ice of list) {
    if (ice.expires < now) continue;
    const lifecycle = lifecycleForCall(ice.callId);
    if (
      !lifecycle ||
      !callEnvelopeMatches(lifecycle, {
        callId: ice.callId,
        fromLineId: ice.fromLineId,
        toLineId: ice.toLineId,
        targetLineId: lineId,
      })
    ) {
      continue;
    }
    send(ws, {
      type: "call.ice",
      contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
      callId: ice.callId,
      fromLineId: ice.fromLineId,
      toLineId: ice.toLineId,
      candidate: ice.candidate,
    });
    n += 1;
  }
  return n;
}

function bufferPendingAnswer(toLineId: string, entry: Omit<PendingAnswer, "expires">): void {
  if (!toLineId) return;
  pendingAnswerByLine.set(toLineId, { ...entry, expires: Date.now() + PENDING_ANSWER_TTL_MS });
}

function flushPendingAnswer(lineId: string, ws: WebSocket): boolean {
  const a = pendingAnswerByLine.get(lineId);
  if (!a) return false;
  pendingAnswerByLine.delete(lineId);
  if (a.expires < Date.now()) return false;
  const lifecycle = lifecycleForCall(a.callId);
  if (
    !lifecycle ||
    !callEnvelopeMatches(lifecycle, {
      callId: a.callId,
      fromLineId: a.fromLineId,
      toLineId: a.toLineId,
      targetLineId: lineId,
    })
  ) {
    return false;
  }
  send(ws, {
    type: "call.answer",
    contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
    callId: a.callId,
    fromLineId: a.fromLineId,
    toLineId: a.toLineId,
    sdp: a.sdp,
    ...(a.early ? { early: true } : {}),
  });
  console.log(`[call] flushed buffered answer ${a.callId || "?"} → ${lineId}${a.early ? " early" : ""}`);
  return true;
}

function clearPendingSignaling(
  callId: string,
  fromLineId?: string,
  toLineId?: string,
  options: { keepAnswer?: boolean } = {}
): void {
  if (!callId) return;
  for (const lineId of [fromLineId, toLineId]) {
    if (!lineId) continue;
    if (pendingOffers.get(lineId)?.callId === callId) {
      pendingOffers.delete(lineId);
      pendingOfferRepushArmed.delete(lineId);
    }
    const ice = pendingIceByLine.get(lineId);
    if (ice) {
      const keep = ice.filter((entry) => entry.callId !== callId);
      if (keep.length) pendingIceByLine.set(lineId, keep);
      else pendingIceByLine.delete(lineId);
    }
    if (!options.keepAnswer && pendingAnswerByLine.get(lineId)?.callId === callId) {
      pendingAnswerByLine.delete(lineId);
    }
  }
}

async function wakeIosCallee(opts: {
  toLineId: string;
  fromLineId: string;
  callId: string;
  callerName: string;
}): Promise<void> {
  const payload = {
    callId: opts.callId,
    handle: opts.fromLineId,
    callerName: opts.callerName,
    fromLineId: opts.fromLineId,
    toLineId: opts.toLineId,
  };
  // VoIP if this line registered a CallKit token; otherwise alert APNs.
  // IOS_CALLKIT=0 is a hub kill switch (alert only).
  const voipTokens = filterIosWakeTokensExcludingCallerLine(
    db,
    listIosVoipTokensForLine(db, opts.toLineId),
    opts.fromLineId
  );
  if (shouldSendVoipPush(voipTokens.length > 0)) {
    for (const t of voipTokens.slice(0, 3)) {
      const result = await sendIosVoipPush(t.voip_token, payload, t.apns_env);
      rememberApnsTokenResult(t, result);
    }
    return;
  }
  const alertTokens = filterIosWakeTokensExcludingCallerLine(
    db,
    listIosAlertTokensForLine(db, opts.toLineId),
    opts.fromLineId
  );
  if (!alertTokens.length) {
    console.log(`[push] no ios wake tokens for line=${opts.toLineId} callId=${opts.callId}`);
    return;
  }
  for (const t of alertTokens.slice(0, 3)) {
    const result = await sendIosAlertPush(
      t.voip_token,
      {
        ...payload,
        title: "PhoneHome",
        body: `Call from ${opts.callerName}`,
      },
      t.apns_env
    );
    rememberApnsTokenResult(t, result);
  }
}

async function wakeAndroidCallee(opts: {
  toLineId: string;
  fromLineId: string;
  callId: string;
  callerName: string;
}): Promise<void> {
  const tokens = filterIosWakeTokensExcludingCallerLine(
    db,
    listAndroidTokensForLine(db, opts.toLineId),
    opts.fromLineId
  );
  if (!tokens.length) return;
  const payload = {
    callId: opts.callId,
    handle: opts.fromLineId,
    callerName: opts.callerName,
    fromLineId: opts.fromLineId,
    toLineId: opts.toLineId,
  };
  for (const t of tokens.slice(0, 3)) {
    const result = await sendFcmCall(t.voip_token, payload);
    if (result.skipped) return;
    if (result.drop) {
      deletePushDevice(db, t.id);
      console.warn(`[push] dropped dead android line=${t.line_id} token=…${String(t.voip_token).slice(-8)}`);
    }
  }
}

function rememberApnsTokenResult(
  row: { id: string; voip_token: string; apns_env: string | null; line_id: string },
  result: { ok: boolean; status?: number; reason?: string; production?: boolean }
): void {
  if (result.ok && result.production !== undefined) {
    const env = apnsEnvName(result.production);
    if (row.apns_env !== env) setPushDeviceApnsEnv(db, row.id, env);
    return;
  }
  if (isApnsBadDeviceToken(result.status, result.reason)) {
    deletePushDevice(db, row.id);
    console.warn(
      `[push] dropped dead ${row.line_id} token=…${String(row.voip_token).slice(-8)} (BadDeviceToken both APNs hosts)`
    );
  }
}

type GroupRoom = {
  id: string;
  hostLineId: string;
  /** Accepted participants (talk/presence members) */
  members: Set<string>;
  /** Still ringing */
  invited: Set<string>;
  createdAt: number;
  /**
   * TreeHouse (pad 0): mothership-wide kid hangout.
   * When set to MOTHERSHIP_TREEHOUSE_KEY, Circles filter who hears whom.
   * (Legacy per-household rooms also used this field.)
   */
  familyRoomHouseholdId?: string;
  /** FamilyRoom (# IVR): full mesh talk among admin-approved family (kids + adults). */
  adultFamilyRoomHouseholdId?: string;
  /**
   * Parent listen-only: parentLineId → child they're mirroring.
   * Parents are not in `members`; they receive the child's filtered mix.
   */
  listeners?: Map<string, { childLineId: string; startedAt: number }>;
  /** FXS / house-phone members — Asterisk mix, no WebRTC mesh. */
  analogMembers?: Set<string>;
};

const groupRooms = new Map<string, GroupRoom>();
/**
 * TreeHouse is one mothership-wide room (not per-Pod).
 * Map keeps a single entry under MOTHERSHIP_TREEHOUSE_KEY for lookup/compat.
 */
const familyRoomByHousehold = new Map<string, string>();
/** Sentinel household key for the mothership TreeHouse room. */
const MOTHERSHIP_TREEHOUSE_KEY = "__mothership__";
const TREEHOUSE_ROOM_ID = "treehouse";
/** householdId → active FamilyRoom (# pad) group room id */
const adultFamilyRoomByHousehold = new Map<string, string>();
const MAX_GROUP = 4;

function familyRoomIdForHousehold(_householdId: string): string {
  return TREEHOUSE_ROOM_ID;
}

function activeTreeHouseRoom(): GroupRoom | undefined {
  const roomId = familyRoomByHousehold.get(MOTHERSHIP_TREEHOUSE_KEY);
  return roomId ? groupRooms.get(roomId) : undefined;
}

function adultFamilyRoomIdForHousehold(householdId: string): string {
  return `afr_${householdId}`;
}

function linePublicLabel(lineId: string): string {
  const row = db
    .prepare(`SELECT name, child_label, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`)
    .get(lineId) as { name: string; child_label: string | null; mode: string } | undefined;
  if (!row) return "Someone";
  if (row.mode !== "child") return parentDisplayLabel(db, lineId);
  const label = (row.child_label || row.name || "").trim();
  return label || "Someone";
}

function familyRoomPresencePayload(_householdId?: string) {
  const room = activeTreeHouseRoom();
  const listeners = room?.listeners
    ? [...room.listeners.entries()].map(([parentLineId, meta]) => ({
        parentLineId,
        childLineId: meta.childLineId,
        childName: linePublicLabel(meta.childLineId),
      }))
    : [];
  return {
    type: "treehouse.presence" as const,
    householdId: MOTHERSHIP_TREEHOUSE_KEY,
    roomId: room?.id || null,
    members: room ? [...room.members] : [],
    listeners,
    talkPairs: [],
    analogMembers: room?.analogMembers ? [...room.analogMembers] : [],
    playRoom: true,
    familyRoom: true,
    treeHouse: true,
    mothership: true,
  };
}

function treeHousePresenceRecipients(room?: GroupRoom): Set<string> {
  const recipients = new Set<string>(listTreeHouseKidLineIds(db));
  // Parents / softphones in every Pod see pad chrome; listeners always get updates.
  const parentRows = db
    .prepare(
      `SELECT id FROM lines WHERE IFNULL(mode, 'parent') != 'child'`
    )
    .all() as { id: string }[];
  for (const row of parentRows) recipients.add(row.id);
  if (room?.listeners) {
    for (const parentId of room.listeners.keys()) recipients.add(parentId);
  }
  if (room) {
    for (const m of room.members) recipients.add(m);
  }
  return recipients;
}

function fanoutFamilyRoomPresence(_householdId?: string) {
  const msg = familyRoomPresencePayload();
  const room = activeTreeHouseRoom();
  for (const lineId of treeHousePresenceRecipients(room)) {
    const c = findByLine(lineId);
    if (!c || c.isBridge) continue;
    // Dual/triple emit so cached clients on familyroom.* / playroom.* keep working.
    send(c.ws, msg);
    send(c.ws, { ...msg, type: "playroom.presence" });
    send(c.ws, { ...msg, type: "familyroom.presence" });
  }
}

function fanoutAdultFamilyRoomPresence(householdId: string) {
  const roomId = adultFamilyRoomByHousehold.get(householdId);
  const room = roomId ? groupRooms.get(roomId) : undefined;
  const members = room ? roomMemberList(room) : [];
  const msg = {
    type: "adultfamily.presence" as const,
    householdId,
    roomId: room?.id || null,
    members,
    adultFamilyRoom: true,
  };
  const recipients = new Set<string>();
  const hhLines = db
    .prepare(`SELECT id FROM lines WHERE household_id = ?`)
    .all(householdId) as { id: string }[];
  for (const row of hhLines) recipients.add(row.id);
  for (const m of listAdultFamilyRoomMembers(db, householdId)) recipients.add(m.line_id);
  for (const lineId of recipients) {
    const c = findByLine(lineId);
    if (!c || c.isBridge) continue;
    send(c.ws, msg);
  }
}

/** Softphone TTS cue — never logs call content. */
function sendFamilyRoomAnnounce(lineId: string, text: string, roomId: string, kind: string) {
  const c = findByLine(lineId);
  if (!c || c.isBridge) return;
  const payload = {
    type: "treehouse.announce" as const,
    roomId,
    kind,
    text,
    playRoom: true,
    familyRoom: true,
    treeHouse: true,
  };
  send(c.ws, payload);
  send(c.ws, { ...payload, type: "playroom.announce" });
  send(c.ws, { ...payload, type: "familyroom.announce" });
}

function fanoutFamilyRoomAnnounce(
  room: GroupRoom,
  text: string,
  kind: string,
  recipientIds: Iterable<string>
) {
  const seen = new Set<string>();
  for (const lineId of recipientIds) {
    if (!lineId || seen.has(lineId)) continue;
    seen.add(lineId);
    sendFamilyRoomAnnounce(lineId, text, room.id, kind);
  }
}

function enterAnnounceRecipients(room: GroupRoom, entrantId: string): string[] {
  const out: string[] = [];
  for (const m of room.members) {
    if (m === entrantId) continue;
    if (canTalkInTreeHouse(db, entrantId, m)) out.push(m);
  }
  // Parent listeners mirroring a talk-peer of the entrant hear the same enter cue.
  if (room.listeners) {
    for (const [parentId, meta] of room.listeners) {
      if (out.includes(meta.childLineId)) out.push(parentId);
    }
  }
  return out;
}

function familyRoomListenerTargets(room: GroupRoom, childLineId: string): string[] {
  const members = [...room.members];
  const peers = treeHouseTalkPeers(db, childLineId, members);
  const targets = new Set<string>([childLineId, ...peers]);
  return [...targets];
}

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

function findSoftphoneByLine(lineId: string): Client | undefined {
  for (const c of clients) {
    if (c.lineId === lineId && !c.isBridge) return c;
  }
  return undefined;
}

function findBridgeByLine(lineId: string): Client | undefined {
  for (const c of clients) {
    if (c.lineId === lineId && c.isBridge) return c;
  }
  return undefined;
}

/** TreeHouse / group mesh SDP. Never steal listen-in or kid mesh to an ATA claim. */
function findGroupSignalingClient(lineId: string, room?: GroupRoom | null): Client | undefined {
  const role = groupSignalingRole({
    destIsListener: Boolean(room?.listeners?.has(lineId)),
    destIsAnalogMember: Boolean(room?.analogMembers?.has(lineId)),
  });
  return role === "bridge" ? findBridgeByLine(lineId) : findSoftphoneByLine(lineId);
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

    if (keepSocketOnClaim(c, client, softphoneInOpenCall(c))) {
      console.log(`[ws] second device on ${lineId} — keeping the socket in an open call`);
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
    const c = findGroupSignalingClient(lineId, room) || findByLine(lineId);
    if (c) send(c.ws, msg);
  }
}

function endGroupRoom(roomId: string, reason: string) {
  const room = groupRooms.get(roomId);
  if (!room) return;
  const frHh = room.familyRoomHouseholdId;
  const afrHh = room.adultFamilyRoomHouseholdId;
  fanoutGroup(room, {
    type: "group.ended",
    roomId,
    reason,
    familyRoom: Boolean(frHh),
    playRoom: Boolean(frHh),
    adultFamilyRoom: Boolean(afrHh),
  });
  // Notify parent listeners separately (they are not in members).
  if (room.listeners) {
    for (const parentId of room.listeners.keys()) {
      const c = findByLine(parentId);
      if (c) {
        send(c.ws, {
          type: "group.ended",
          roomId,
          reason,
          familyRoom: true,
          playRoom: true,
        });
      }
    }
  }
  groupRooms.delete(roomId);
  if (frHh && (frHh === MOTHERSHIP_TREEHOUSE_KEY || familyRoomByHousehold.get(frHh) === roomId)) {
    familyRoomByHousehold.delete(MOTHERSHIP_TREEHOUSE_KEY);
    if (frHh !== MOTHERSHIP_TREEHOUSE_KEY) familyRoomByHousehold.delete(frHh);
    fanoutFamilyRoomPresence();
  }
  if (afrHh && adultFamilyRoomByHousehold.get(afrHh) === roomId) {
    adultFamilyRoomByHousehold.delete(afrHh);
    fanoutAdultFamilyRoomPresence(afrHh);
  }
  console.log(`[group] ended ${roomId}: ${reason}`);
}

function householdIdForLine(lineId: string): string | null {
  const row = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(lineId) as
    | { household_id: string }
    | undefined;
  return row?.household_id || null;
}

/**
 * Join TreeHouse for a line (softphone WS or analog bridge).
 * Softphone mesh signaling is skipped when `opts.analog` — FXS uses Asterisk mixing;
 * softphones still get presence + enter announce.
 * TreeHouse is mothership-wide; talkPeers are Circle-filtered.
 */
function joinTreeHouseLine(
  lineId: string,
  opts: { analog?: boolean; notifyJoiner?: (payload: Record<string, unknown>) => void } = {}
):
  | {
      ok: true;
      roomId: string;
      householdId: string;
      hostLineId: string;
      members: string[];
      talkPeers: string[];
      /** Circle talk peers among all members (softphone + analog). */
      circleTalkPeers: string[];
      /** Circle talk peers that are currently on FXS / Asterisk. */
      analogTalkPeers: string[];
      alreadyIn?: boolean;
      analog?: boolean;
    }
  | { ok: false; error: string } {
  const householdId = householdIdForLine(lineId);
  if (!householdId) return { ok: false, error: "Unknown line" };
  if (!canJoinTreeHouse(db, lineId)) {
    return { ok: false, error: "TreeHouse is for kids — parents use Listen only" };
  }
  const hh = db.prepare(`SELECT kill_switch FROM households WHERE id = ?`).get(householdId) as
    | { kill_switch: number }
    | undefined;
  if (hh?.kill_switch) return { ok: false, error: "Timeout is on" };

  let roomId = familyRoomByHousehold.get(MOTHERSHIP_TREEHOUSE_KEY);
  let room = roomId ? groupRooms.get(roomId) : undefined;
  if (!room) {
    roomId = TREEHOUSE_ROOM_ID;
    room = {
      id: roomId,
      hostLineId: lineId,
      members: new Set(),
      invited: new Set(),
      createdAt: Date.now(),
      familyRoomHouseholdId: MOTHERSHIP_TREEHOUSE_KEY,
      listeners: new Map(),
      analogMembers: new Set(),
    };
    groupRooms.set(roomId, room);
    familyRoomByHousehold.set(MOTHERSHIP_TREEHOUSE_KEY, roomId);
  }
  if (!room.listeners) room.listeners = new Map();
  if (!room.analogMembers) room.analogMembers = new Set();
  if (opts.analog) room.analogMembers.add(lineId);

  const listenersPayload = () =>
    [...room!.listeners!.entries()].map(([parentLineId, meta]) => ({
      parentLineId,
      childLineId: meta.childLineId,
      childName: linePublicLabel(meta.childLineId),
    }));

  if (room.members.has(lineId)) {
    const members = roomMemberList(room);
    const circleTalkPeers = treeHouseTalkPeers(db, lineId, members);
    const talkPeers = meshTalkPeerIds(circleTalkPeers, room.analogMembers, {
      joinerIsAnalog: Boolean(opts.analog),
    });
    const analogTalkPeers = analogCircleTalkPeers(
      members,
      lineId,
      room.analogMembers || [],
      (a, b) => canTalkInTreeHouse(db, a, b)
    );
    const payload = {
      roomId: room.id,
      householdId: MOTHERSHIP_TREEHOUSE_KEY,
      hostLineId: room.hostLineId,
      members,
      talkPeers,
      circleTalkPeers,
      analogTalkPeers,
      analogMembers: [...(room.analogMembers || [])],
      listeners: listenersPayload(),
      alreadyIn: true,
      analog: Boolean(opts.analog),
      mothership: true,
    };
    opts.notifyJoiner?.(payload);
    fanoutFamilyRoomPresence();
    return { ok: true, ...payload };
  }
  if (room.members.size >= MAX_FAMILY_ROOM) {
    return { ok: false, error: `TreeHouse is full (${MAX_FAMILY_ROOM} max)` };
  }
  room.members.add(lineId);
  const members = roomMemberList(room);
  const circleTalkPeers = treeHouseTalkPeers(db, lineId, members);
  const talkPeers = meshTalkPeerIds(circleTalkPeers, room.analogMembers, {
    joinerIsAnalog: Boolean(opts.analog),
  });
  const analogTalkPeers = analogCircleTalkPeers(
    members,
    lineId,
    room.analogMembers || [],
    (a, b) => canTalkInTreeHouse(db, a, b)
  );
  const joinedPayload = {
    roomId: room.id,
    householdId: MOTHERSHIP_TREEHOUSE_KEY,
    hostLineId: room.hostLineId,
    members,
    talkPeers,
    circleTalkPeers,
    analogTalkPeers,
    analogMembers: [...(room.analogMembers || [])],
    listeners: listenersPayload(),
    analog: Boolean(opts.analog),
    mothership: true,
  };
  opts.notifyJoiner?.(joinedPayload);

  const peerJoined = {
    type: "group.peer-joined" as const,
    roomId: room.id,
    lineId,
    hostLineId: room.hostLineId,
    members,
    invited: [],
    talkPeers,
    analogMembers: [...(room.analogMembers || [])],
    familyRoom: true,
    playRoom: true,
    mothership: true,
    analog: Boolean(opts.analog),
  };
  // Softphone mesh: only Circle talk peers get SDP. Analog FXS is Asterisk-only.
  if (!opts.analog) {
    for (const peerId of talkPeers) {
      const c = findSoftphoneByLine(peerId);
      if (c) {
        // Each peer gets *their* filtered talkPeers list so they don't offer to strangers.
        const peerTalk = meshTalkPeerIds(
          treeHouseTalkPeers(db, peerId, members),
          room.analogMembers
        );
        send(c.ws, { ...peerJoined, talkPeers: peerTalk });
      }
    }
  }
  const enterName = linePublicLabel(lineId);
  fanoutFamilyRoomAnnounce(
    room,
    opts.analog
      ? `${enterName} has joined the TreeHouse on the house phone`
      : `${enterName} has joined the TreeHouse`,
    "enter",
    enterAnnounceRecipients(room, lineId)
  );
  fanoutFamilyRoomPresence();
  console.log(
    `[treehouse] join ${room.id} ${lineId} members=${members.length} talkPeers=${talkPeers.length}${
      opts.analog ? " analog" : ""
    }`
  );
  return { ok: true, ...joinedPayload };
}

function leaveTreeHouseLine(lineId: string): { ok: true; left: boolean } | { ok: false; error: string } {
  let room: GroupRoom | undefined;
  for (const r of groupRooms.values()) {
    if (r.adultFamilyRoomHouseholdId) continue;
    if (!r.familyRoomHouseholdId) continue;
    if (r.members.has(lineId) || r.listeners?.has(lineId)) {
      room = r;
      break;
    }
  }
  if (!room) {
    fanoutFamilyRoomPresence();
    return { ok: true, left: false };
  }
  if (room.listeners?.has(lineId)) {
    room.listeners.delete(lineId);
    fanoutGroup(room, {
      type: "group.peer-left",
      roomId: room.id,
      lineId,
      members: roomMemberList(room),
      invited: [],
      listener: true,
      familyRoom: true,
      playRoom: true,
    });
    fanoutFamilyRoomPresence();
    return { ok: true, left: true };
  }
  if (!room.members.has(lineId)) {
    fanoutFamilyRoomPresence();
    return { ok: true, left: false };
  }
  room.members.delete(lineId);
  room.analogMembers?.delete(lineId);
  if (room.listeners) {
    for (const [parentId, meta] of [...room.listeners.entries()]) {
      if (meta.childLineId === lineId) {
        room.listeners.delete(parentId);
        const pc = findSoftphoneByLine(parentId) || findByLine(parentId);
        if (pc && !pc.isBridge) {
          const stop = {
            type: "treehouse.listen.stopped" as const,
            roomId: room.id,
            reason: "child-left",
            playRoom: true,
            familyRoom: true,
            treeHouse: true,
          };
          send(pc.ws, stop);
          send(pc.ws, { ...stop, type: "playroom.listen.stopped" });
          send(pc.ws, { ...stop, type: "familyroom.listen.stopped" });
        }
      }
    }
  }
  if (room.members.size === 0) {
    endGroupRoom(room.id, "TreeHouse empty");
    return { ok: true, left: true };
  }
  if (lineId === room.hostLineId) {
    room.hostLineId = [...room.members][0];
  }
  fanoutGroup(room, {
    type: "group.peer-left",
    roomId: room.id,
    lineId,
    members: roomMemberList(room),
    invited: [],
    familyRoom: true,
    playRoom: true,
  });
  fanoutFamilyRoomPresence();
  console.log(`[treehouse] leave ${room.id} ${lineId}`);
  return { ok: true, left: true };
}

function joinAdultFamilyRoomLine(
  lineId: string,
  householdId: string
):
  | {
      ok: true;
      roomId: string;
      householdId: string;
      hostLineId: string;
      members: string[];
      talkPeers: string[];
      alreadyIn?: boolean;
    }
  | { ok: false; error: string } {
  const lineHh = householdIdForLine(lineId);
  if (!lineHh) return { ok: false, error: "Unknown line" };
  if (householdId !== lineHh) {
    const approved = canJoinAdultFamilyRoom(db, householdId, lineId);
    if (!approved) {
      return { ok: false, error: "Ask the household admin to approve you for FamilyRoom" };
    }
  } else if (!canJoinAdultFamilyRoom(db, householdId, lineId)) {
    return { ok: false, error: "Ask the household admin to approve you for FamilyRoom" };
  }
  const hh = db.prepare(`SELECT kill_switch FROM households WHERE id = ?`).get(householdId) as
    | { kill_switch: number }
    | undefined;
  if (hh?.kill_switch) return { ok: false, error: "Timeout is on" };

  let roomId = adultFamilyRoomByHousehold.get(householdId);
  let room = roomId ? groupRooms.get(roomId) : undefined;
  if (!room) {
    roomId = adultFamilyRoomIdForHousehold(householdId);
    room = {
      id: roomId,
      hostLineId: lineId,
      members: new Set(),
      invited: new Set(),
      createdAt: Date.now(),
      adultFamilyRoomHouseholdId: householdId,
    };
    groupRooms.set(roomId, room);
    adultFamilyRoomByHousehold.set(householdId, roomId);
  }

  if (room.members.has(lineId)) {
    const members = roomMemberList(room);
    return {
      ok: true,
      roomId: room.id,
      householdId,
      hostLineId: room.hostLineId,
      members,
      talkPeers: members.filter((m) => m !== lineId),
      alreadyIn: true,
    };
  }
  if (room.members.size >= MAX_FAMILY_ROOM) {
    return { ok: false, error: `FamilyRoom is full (${MAX_FAMILY_ROOM} max)` };
  }
  room.members.add(lineId);
  const members = roomMemberList(room);
  const talkPeers = members.filter((m) => m !== lineId);
  const peerJoined = {
    type: "group.peer-joined" as const,
    roomId: room.id,
    lineId,
    hostLineId: room.hostLineId,
    members,
    invited: [],
    talkPeers,
    adultFamilyRoom: true,
  };
  for (const peerId of talkPeers) {
    const c = findByLine(peerId);
    if (c) send(c.ws, peerJoined);
  }
  console.log(`[adultfamily] join ${room.id} ${lineId} members=${members.length}`);
  fanoutAdultFamilyRoomPresence(householdId);
  return {
    ok: true,
    roomId: room.id,
    householdId,
    hostLineId: room.hostLineId,
    members,
    talkPeers,
  };
}

function leaveAdultFamilyRoomLine(lineId: string): { ok: true; left: boolean } | { ok: false; error: string } {
  let room: GroupRoom | undefined;
  for (const r of groupRooms.values()) {
    if (r.adultFamilyRoomHouseholdId && r.members.has(lineId)) {
      room = r;
      break;
    }
  }
  const householdId = room?.adultFamilyRoomHouseholdId || householdIdForLine(lineId);
  if (!room || !householdId) {
    if (householdId) fanoutAdultFamilyRoomPresence(householdId);
    return { ok: true, left: false };
  }
  room.members.delete(lineId);
  if (room.members.size === 0) {
    endGroupRoom(room.id, "FamilyRoom empty");
    return { ok: true, left: true };
  }
  if (lineId === room.hostLineId) {
    room.hostLineId = [...room.members][0];
  }
  fanoutGroup(room, {
    type: "group.peer-left",
    roomId: room.id,
    lineId,
    members: roomMemberList(room),
    invited: [],
    adultFamilyRoom: true,
  });
  fanoutAdultFamilyRoomPresence(householdId);
  console.log(`[adultfamily] leave ${room.id} ${lineId}`);
  return { ok: true, left: true };
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
  // Background / lock-screen: “Alex left a message” (alert APNs, not VoIP/CallKit).
  if (toLineId && voicemail?.id) {
    void notifyIosVoicemailLeft({
      toLineId,
      fromLineId: fromLineId || undefined,
      fromLabel: String(voicemail.from_label || "Someone"),
      voicemailId: String(voicemail.id),
      unreadCount,
    });
    void notifyAndroidVoicemailLeft({
      toLineId,
      fromLineId: fromLineId || undefined,
      fromLabel: String(voicemail.from_label || "Someone"),
      voicemailId: String(voicemail.id),
      unreadCount,
    });
  }
}

/** Alert push when someone deposits a voicemail for this line. */
async function notifyIosVoicemailLeft(opts: {
  toLineId: string;
  fromLineId?: string;
  fromLabel: string;
  voicemailId: string;
  unreadCount: number;
}): Promise<void> {
  const who = (opts.fromLabel || "Someone").trim().slice(0, 40) || "Someone";
  const tokens = listIosAlertTokensForLine(db, opts.toLineId);
  if (!tokens.length) {
    console.log(`[push] no ios alert tokens for voicemail line=${opts.toLineId}`);
    return;
  }
  for (const t of tokens.slice(0, 3)) {
    const result = await sendIosAlertPush(
      t.voip_token,
      {
        callId: opts.voicemailId,
        handle: opts.fromLineId || opts.toLineId,
        callerName: who,
        fromLineId: opts.fromLineId || "",
        toLineId: opts.toLineId,
        title: "PhoneHome",
        body: `${who} left a message`,
        type: "voicemail",
        badge: Math.max(0, Number(opts.unreadCount) || 0),
      },
      t.apns_env
    );
    rememberApnsTokenResult(t, result);
  }
}

async function notifyAndroidVoicemailLeft(opts: {
  toLineId: string;
  fromLineId?: string;
  fromLabel: string;
  voicemailId: string;
  unreadCount: number;
}): Promise<void> {
  const tokens = filterIosWakeTokensExcludingCallerLine(
    db,
    listAndroidTokensForLine(db, opts.toLineId),
    opts.fromLineId || ""
  );
  if (!tokens.length) return;
  for (const t of tokens.slice(0, 3)) {
    const result = await sendFcmVoicemail(t.voip_token, {
      voicemailId: opts.voicemailId,
      fromLabel: opts.fromLabel,
      fromLineId: opts.fromLineId || "",
      toLineId: opts.toLineId,
      unreadCount: opts.unreadCount,
    });
    if (result.skipped) return;
    if (result.drop) {
      deletePushDevice(db, t.id);
      console.warn(`[push] dropped dead android line=${t.line_id} token=…${String(t.voip_token).slice(-8)}`);
    }
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
      client.sessionId = sid;
      const lineId = String(msg.lineId || "");
      if (lineId) {
        if (
          !client.isBridge &&
          !userCanOperateLine(db, user.id, lineId)
        ) {
          send(ws, {
            type: "error",
            error: "Not allowed to use this line",
            lineId,
          });
          return;
        }
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
      // After CallKit wake, deliver any SDP + buffered trickle ICE from while suspended.
      // Server-driven push — do not rely on client polling alone.
      if (client.lineId && !client.isBridge) {
        const terminal = flushPendingTerminalSignals(client.lineId, ws);
        if (terminal) {
          console.log(`[call] flushed ${terminal} buffered hangup(s) → ${client.lineId}`);
        }
        const hadOffer = deliverPendingOfferToClient(client, "ws-hello");
        if (hadOffer) schedulePendingOfferRepush(client.lineId);
        const iced = flushPendingIce(client.lineId, ws);
        if (iced) {
          console.log(
            `[call] flushed ${iced} buffered ICE → ${client.lineId}${hadOffer ? "" : " (WARNING: no pending SDP)"}`
          );
        }
        // Same device reconnected — refresh sticky peer + deliver buffered answer.
        // A second device on the line must not take the slot from a connected one.
        for (const [cid, peers] of callPeersById) {
          if (peers.fromLineId === client.lineId) {
            const prev = peers.caller;
            if (!socketOpen(prev) || prev === client || sameDevice(prev, client)) {
              peers.caller = client;
            }
          }
          if (peers.toLineId === client.lineId) {
            if (isSecondDevice(liveCallAnswerer(cid), client)) {
              if (callLifecycleIsOpen(cid)) sendAnsweredElsewhere(client, cid);
              continue;
            }
            if (sameDevice(peers.answeredBy, client)) peers.answeredBy = client;
            peers.callee = client;
          }
        }
        flushPendingAnswer(client.lineId, ws);
      } else if (client.lineId && client.isBridge) {
        // Soft→ATA: early trickle often buffers before /claim WS hello — deliver to bridge.
        const iced = flushPendingIce(client.lineId, ws);
        if (iced) {
          console.log(`[call] flushed ${iced} buffered ICE → bridge ${client.lineId}`);
        }
      }
      if (client.lineId && !client.isBridge) {
        const hid = householdIdForLine(client.lineId);
        if (hid) send(ws, familyRoomPresencePayload(hid));
      }
      return;
    }

    if (type === "call.offer") {
      const fromLineId = String(msg.fromLineId || client.lineId || "");
      const toLineId = String(msg.toLineId || "");
      if (
        client.userId &&
        !client.isBridge &&
        !userCanOperateLine(db, client.userId, fromLineId)
      ) {
        console.log(`[call] rejected ${fromLineId}→${toLineId}: cannot operate from line`);
        send(ws, {
          type: "call.rejected",
          reason: "Not allowed to place calls from that line",
        });
        return;
      }
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
      // Callee already ringing / talking — tell the new caller they're busy.
      if (lineIsBusy(db, toLineId)) {
        const busy = busyCallRejection("callee");
        console.log(`[call] rejected ${fromLineId}→${toLineId}: busy`);
        logCall(db, fromLineId, toLineId, "blocked");
        send(ws, {
          type: "call.rejected",
          reason: busy.reason,
          voice: busy.voice,
          spoken: busy.spoken,
          side: busy.side,
        });
        return;
      }
      if (lineIsBusy(db, fromLineId)) {
        const busy = busyCallRejection("caller");
        console.log(`[call] rejected ${fromLineId}→${toLineId}: caller already in call`);
        send(ws, {
          type: "call.rejected",
          reason: busy.reason,
          voice: busy.voice,
          spoken: busy.spoken,
          side: busy.side,
        });
        return;
      }
      const call = logCall(db, fromLineId, toLineId, "ringing");
      beginCallLifecycle(call.id, fromLineId, toLineId);
      const ata = getAtaByLineId(db, toLineId);

      // Store SDP immediately — before ATA await — so CallKit WS hello during the
      // SIP status round-trip still peeks a real offer (ICE-only reconnects otherwise).
      storePendingOffer({
        callId: call.id,
        fromLineId,
        toLineId,
        sdp: msg.sdp,
      });
      // Pending offer can reach a CallKit reconnect while ATA status is still
      // resolving; make acceptance valid before that delivery race.
      markCallLifecycleRinging(call.id);

      // Same line has softphone + analog: default inbound to the FXS unless we
      // are sure the ATA is offline. Inconclusive checks (reload blip) must still
      // try FXS — skipping to VoIP-only leaves the landline silent.
      void (async () => {
        try {
          let usedAta = false;
          if (ata) {
            const sip = await fetchBridgeSipStatus(ata.sip_extension);
            if (shouldAttemptFxsInbound(sip)) {
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
                `[call] ATA ${ata.sip_extension} confirmed offline (${sip.state || sip.reason || "offline"}); ringing softphone`
              );
              await releaseBridgeCallee(toLineId);
              // Outbound soft→ATA: caller already has the app open — don't fall back
              // to callee softphone / iOS wake (parent iPhone showed child incoming UI).
              if (!client.isBridge && client.lineId === fromLineId) {
                if (!callLifecycleIsOpen(call.id)) return;
                clearPendingSignaling(call.id, fromLineId, toLineId);
                endCallLog(db, call.id, "offline");
                send(ws, {
                  type: "call.rejected",
                  reason: "Kid landline is offline right now. Try again in a moment.",
                  voice: "offline",
                  spoken: spokenFor("offline", "caller"),
                  side: "callee",
                });
                return;
              }
            }
          }

          // ATA status/claim is asynchronous. A may have ended and B may now own
          // these lines; never let delayed routing work for A touch B.
          if (!callLifecycleIsOpen(call.id)) return;
          const target = findByLine(toLineId);
          const voipTokens = !usedAta
            ? filterIosWakeTokensExcludingCallerLine(
                db,
                listIosVoipTokensForLine(db, toLineId),
                fromLineId
              )
            : [];
          const useVoipWake = shouldSendVoipPush(voipTokens.length > 0);
          const iosWakeTokens = !usedAta
            ? useVoipWake
              ? voipTokens
              : filterIosWakeTokensExcludingCallerLine(
                  db,
                  listIosAlertTokensForLine(db, toLineId),
                  fromLineId
                )
            : [];
          const androidTokens = !usedAta
            ? filterIosWakeTokensExcludingCallerLine(
                db,
                listAndroidTokensForLine(db, toLineId),
                fromLineId
              )
            : [];
          if (!target && !iosWakeTokens.length && !androidTokens.length) {
            clearPendingSignaling(call.id, fromLineId, toLineId);
            endCallLog(db, call.id, "offline");
            console.log(`[call] offline ${call.id} ${fromLineId}→${toLineId}`);
            const offlineReason = ata
              ? "Kid landline is offline, and their PhoneHome app isn’t open."
              : "Their phone isn’t reachable right now. Ask them to open PhoneHome.";
            send(ws, {
              type: "call.rejected",
              reason: offlineReason,
              voice: "offline",
              spoken: spokenFor("offline", "caller"),
              side: "callee",
            });
            return;
          }

          if (target) {
            // If we claimed FXS but findByLine somehow returned a softphone, re-prefer bridge.
            if (usedAta && !target.isBridge) {
              const bridge = [...clients].find((c) => c.isBridge && c.lineId === toLineId);
              if (bridge) {
                rememberCallPeers({
                  callId: call.id,
                  fromLineId,
                  toLineId,
                  caller: client,
                  callee: bridge,
                });
                send(bridge.ws, {
                  type: "call.offer",
                  contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
                  callId: call.id,
                  fromLineId,
                  toLineId,
                  sdp: msg.sdp,
                });
              } else {
                clearPendingSignaling(call.id, fromLineId, toLineId);
                endCallLog(db, call.id, "offline");
                send(ws, {
                  type: "call.rejected",
                  reason: "Analog phone didn’t connect. Try again in a moment.",
                  voice: "offline",
                  spoken: spokenFor("offline", "caller"),
                  side: "callee",
                });
                return;
              }
            } else {
              rememberCallPeers({
                callId: call.id,
                fromLineId,
                toLineId,
                caller: client,
                callee: target,
              });
              send(target.ws, {
                type: "call.offer",
                contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
                callId: call.id,
                fromLineId,
                toLineId,
                sdp: msg.sdp,
              });
              if (!target.isBridge) schedulePendingOfferRepush(toLineId);
            }
          } else {
            // CallKit wake — caller known; callee attaches on WS hello / pending deliver.
            rememberCallPeers({
              callId: call.id,
              fromLineId,
              toLineId,
              caller: client,
              callee: null,
            });
          }

          // Softphone / iOS CallKit path — FXS-first skips wake so the wall phone owns the ring.
          if (!usedAta) {
            const callerName = peerLabelForCall(db, fromLineId, toLineId).slice(0, 64) || "Family";
            void wakeIosCallee({
              toLineId,
              fromLineId,
              callId: call.id,
              callerName,
            });
            void wakeAndroidCallee({
              toLineId,
              fromLineId,
              callId: call.id,
              callerName,
            });
            schedulePendingOfferRepush(toLineId);
          } else {
            // Analog owns inbound — don't leave softphone CallKit with a peeked offer.
            if (pendingOffers.get(toLineId)?.callId === call.id) {
              pendingOffers.delete(toLineId);
              pendingOfferRepushArmed.delete(toLineId);
            }
          }
          send(ws, {
            type: "call.ringing",
            contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
            callId: call.id,
          });
          publishLiveCall(call.id, fromLineId, toLineId, "ringing");
          console.log(
            `[call] ringing ${call.id} ${fromLineId}→${toLineId}${usedAta ? ` (FXS ${ata?.sip_extension})` : ""}${
              !target && iosWakeTokens.length
                ? useVoipWake
                  ? " (iOS VoIP wake)"
                  : " (iOS alert wake)"
                : ""
            }`
          );
        } catch (e) {
          clearPendingSignaling(call.id, fromLineId, toLineId);
          if (!callLifecycleIsOpen(call.id)) return;
          endCallLog(db, call.id, "offline");
          console.error(`[call] offer failed ${call.id}:`, e);
          send(ws, { type: "call.rejected", reason: "Call failed to connect" });
        }
      })();
      return;
    }

    if (
      type === "call.answer" ||
      type === "call.ice" ||
      type === "call.hangup" ||
      type === "call.hold" ||
      type === "call.accepted" ||
      type === "call.ringing" ||
      type === "call.fxs-up"
    ) {
      const requestedCallId = msg.callId ? String(msg.callId) : "";
      if (requestedCallId && isSecondDevice(liveCallAnswerer(requestedCallId), client)) {
        if (type === "call.accepted" || type === "call.answer" || type === "call.ringing") {
          sendAnsweredElsewhere(client, requestedCallId);
        }
        if (type !== "call.ice") {
          console.log(`[call] ${type} ${requestedCallId} from a second device ignored (answered elsewhere)`);
        }
        return;
      }
      // Callee decline / End while still ringing → preserve current no-answer /
      // voicemail behavior before the canonical terminal transition is recorded.
      if (type === "call.hangup" && requestedCallId) {
        const row = terminalCallRow(requestedCallId);
        let reason = String(msg.reason || "").trim().slice(0, 80);
        if (
          row &&
          client.lineId === row.to_line_id &&
          row.outcome === "ringing" &&
          reason !== "no-answer"
        ) {
          reason = "no-answer";
          console.log(`[call] callee declined while ringing → no-answer ${requestedCallId}`);
        }
        if (reason) msg.reason = reason;
      }
      const checked = CONTRACT_SIGNAL_TYPES.has(type)
        ? checkLifecycleSignal(type, msg, client)
        : null;
      if (CONTRACT_SIGNAL_TYPES.has(type) && !checked) return;
      if (checked?.result.duplicate) {
        console.log(`[call] duplicate ${type} ${requestedCallId} ignored`);
        return;
      }
      if (checked) msg = checked.message;
      const fromLineId = String(msg.fromLineId || "");
      const toLineId = String(msg.toLineId || "");
      const callId = msg.callId ? String(msg.callId) : undefined;
      if (callId && (type === "call.accepted" || (type === "call.answer" && !msg.early))) {
        claimCallAnswer(callId, client);
      }
      const otherId = client.lineId === fromLineId ? toLineId : fromLineId;
      let terminalSignal: TerminalHangupSignal | null = null;
      let terminalTargetLineId = "";
      let terminalCanBuffer = false;
      // Soft→ATA race: caller trickle ICE can arrive before the FXS claim.
      // The v1 contract requires its canonical call id before buffering or relay.
      if (type === "call.ice" && otherId && getAtaByLineId(db, otherId)) {
        const bridge = [...clients].find(
          (c) => c.isBridge && c.lineId === otherId && c.ws?.readyState === c.ws.OPEN
        );
        if (bridge) {
          send(bridge.ws, msg);
          console.log(`[call] relay call.ice ${callId} → ${otherId} (bridge)`);
        } else {
          bufferPendingIce(otherId, {
            callId: callId!,
            fromLineId,
            toLineId,
            candidate: msg.candidate,
          });
          console.log(`[call] buffered ICE → ${otherId} (awaiting FXS claim)`);
        }
        return;
      }
      // Build the backward-compatible terminal frame from canonical ownership.
      if (type === "call.hangup" && callId) {
        const reason = String(msg.reason || "").trim().slice(0, 80);
        const row = terminalCallRow(callId);
        if (
          !row ||
          !client.lineId ||
          (client.lineId !== row.from_line_id && client.lineId !== row.to_line_id)
        ) {
          console.log(`[call] ignored stale hangup ${callId}`);
          return;
        }
        terminalTargetLineId =
          client.lineId === row.from_line_id ? row.to_line_id : row.from_line_id;
        terminalCanBuffer =
          !row.ended_at && (row.outcome === "ringing" || row.outcome === "answered");
        terminalSignal = {
          type: "call.hangup",
          contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
          callId,
          fromLineId: row.from_line_id,
          toLineId: row.to_line_id,
          ...(checked?.state.terminal
            ? {
                terminalOutcome: checked.state.terminal.outcome,
                terminalReason: checked.state.terminal.reason,
              }
            : {}),
          ...(reason ? { reason: reason.slice(0, 80) } : {}),
        };
      }
      const signalFromLineId = terminalSignal?.fromLineId || fromLineId;
      const signalToLineId = terminalSignal?.toLineId || toLineId;
      // A bridge-originated terminal signal must reach the softphone, never a
      // second FXS claim selected by findByLine's analog-first fallback.
      const target =
        terminalSignal && client.isBridge && terminalTargetLineId
          ? [...clients].find(
              (candidate) =>
                candidate.lineId === terminalTargetLineId &&
                !candidate.isBridge &&
                candidate.ws?.readyState === candidate.ws.OPEN
            )
          : peerClientForSignal(
              callId,
              client,
              signalFromLineId,
              signalToLineId
            );
      if (!target) {
        console.log(
          `[call] ${type} no peer for ${terminalTargetLineId || otherId} (from ${client.lineId})`
        );
        if (terminalSignal && terminalTargetLineId && terminalCanBuffer) {
          if (pendingTerminalSignals.buffer(terminalTargetLineId, terminalSignal)) {
            console.log(
              `[call] buffered hangup ${terminalSignal.callId} → ${terminalTargetLineId}`
            );
          }
        }
        if (type === "call.ice") {
          // CallKit wake / brief offline: hold trickle until the peer's WS is up.
          bufferPendingIce(otherId, {
            callId: callId!,
            fromLineId,
            toLineId,
            candidate: msg.candidate,
          });
        }
        if (type === "call.answer") {
          // Don't reject — caller may reconnect a moment later (same as ICE buffer).
          bufferPendingAnswer(otherId, {
            callId: callId!,
            fromLineId,
            toLineId,
            sdp: msg.sdp,
            early: Boolean(msg.early),
          });
          console.log(`[call] buffered answer ${msg.callId || "?"} → ${otherId}`);
        }
        // call.accepted without a peer: bridge usually already holds the offer WS;
        // real call.answer will still stop FXS ringback via answerFxsEarly.
      } else {
        send(target.ws, terminalSignal || msg);
        if (
          type === "call.answer" ||
          type === "call.ice" ||
          type === "call.accepted" ||
          type === "call.fxs-up" ||
          type === "call.ringing" ||
          type === "call.hold"
        ) {
          console.log(
            `[call] relay ${type} ${callId || "?"} → ${target.lineId}${target.isBridge ? " (bridge)" : " (soft)"}${
              type === "call.answer" && msg.early ? " early" : ""
            }${type === "call.hold" ? ` onHold=${Boolean(msg.onHold)}` : ""}`
          );
        }
      }
      if (type === "call.hangup" && msg.callId) {
        const reason = String(msg.reason || "");
        const hangupFromLineId = terminalSignal?.fromLineId || fromLineId;
        const hangupToLineId = terminalSignal?.toLineId || toLineId;
        const endingCallId = String(msg.callId);
        // Keep legacy call_logs values stable while lifecycle state carries the
        // typed terminal outcome/reason.
        const terminalOutcome = checked?.state.terminal?.outcome;
        endCallLog(
          db,
          endingCallId,
          terminalOutcome === CallTerminalOutcome.Missed ? "missed" : "ended"
        );
        finalizeCallLifecycle(endingCallId);
        endLiveCall(endingCallId, hangupFromLineId, hangupToLineId);
        clearPendingSignaling(endingCallId, hangupFromLineId, hangupToLineId);
        clearCallPeers(endingCallId);
        console.log(`[call] hangup ${msg.callId}${reason ? ` (${reason})` : ""}`);
        // Drop FXS claim so a softphone on the same line can take inbound again if the ATA goes away.
        if (hangupToLineId && getAtaByLineId(db, hangupToLineId)) {
          void releaseBridgeCallee(hangupToLineId);
        }
        if (hangupFromLineId && getAtaByLineId(db, hangupFromLineId)) {
          void releaseBridgeCallee(hangupFromLineId);
        }
      }
      if (type === "call.answer" && msg.callId) {
        const hasPeer = Boolean(target);
        const answeredCallId = String(msg.callId);
        // Soft→ATA early answer is SDP/ICE only — landline still ringing.
        if (!msg.early) {
          markCallAnswered(db, answeredCallId);
          publishLiveCall(answeredCallId, fromLineId, toLineId, "active");
        } else {
          publishLiveCall(answeredCallId, fromLineId, toLineId, "ringing");
        }
        // Drop buffered offer/ICE so a later WS hello doesn't re-ring.
        // Keep buffered answer when the caller is briefly offline (flushed on their hello).
        clearPendingSignaling(answeredCallId, fromLineId, toLineId, {
          keepAnswer: !hasPeer,
        });
        console.log(
          `[call] answered ${msg.callId} peer=${hasPeer ? otherId : "NONE"} sdp=${msg.sdp ? "yes" : "no"} via=${
            target?.isBridge ? "bridge" : target ? "soft" : "none"
          }${msg.early ? " early" : ""}`
        );
      }
      if (type === "call.fxs-up" && msg.callId) {
        markCallAnswered(db, String(msg.callId));
        publishLiveCall(String(msg.callId), fromLineId, toLineId, "active");
        console.log(`[call] fxs-up ${msg.callId}`);
      }
      return;
    }

    // Softphone → hub media diagnostics (no SDP / keys / candidates).
    if (type === "call.media") {
      const callId = msg.callId ? String(msg.callId) : "?";
      const ice = String(msg.ice || "");
      const conn = String(msg.conn || "");
      const senders = Number(msg.senders || 0);
      const receivers = Number(msg.receivers || 0);
      const remoteTracks = Number(msg.remoteTracks || 0);
      const dirs = typeof msg.dirs === "string" ? msg.dirs.slice(0, 80) : "";
      if (
        callId !== "?" &&
        client.lineId &&
        (conn === "connected" || ice === "connected" || ice === "completed")
      ) {
        const lifecycle = lifecycleForCall(callId);
        if (lifecycle) {
          const active = transitionCallLifecycle(lifecycle, {
            contractVersion: Number(msg.contractVersion || 0),
            type: CallLifecycleEventType.MediaActive,
            callId,
            fromLineId: lifecycle.fromLineId,
            toLineId: lifecycle.toLineId,
            actorLineId: client.lineId,
            idempotencyKey: `media-active:${client.lineId}`,
          });
          if (active.accepted && !active.duplicate) rememberCallLifecycle(active.state);
        }
      }
      console.log(
        `[media] ${callId} line=${client.lineId || "?"} ice=${ice} conn=${conn} send=${senders} recv=${receivers} remoteTracks=${remoteTracks}${
          dirs ? ` dirs=${dirs}` : ""
        }${msg.reason ? ` reason=${String(msg.reason).slice(0, 40)}` : ""}`
      );
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

    // —— TreeHouse (pad 0; aliases playroom.* / familyroom.* for older clients) ——
    const playRoomWsType =
      typeof type === "string" && type.startsWith("familyroom.")
        ? `treehouse.${type.slice("familyroom.".length)}`
        : typeof type === "string" && type.startsWith("playroom.")
          ? `treehouse.${type.slice("playroom.".length)}`
          : type;
    if (
      playRoomWsType === "treehouse.join" ||
      playRoomWsType === "treehouse.leave" ||
      playRoomWsType === "treehouse.listen.start" ||
      playRoomWsType === "treehouse.listen.stop"
    ) {
      const sendPlayErr = (error: string) => {
        const payload = { error, playRoom: true, familyRoom: true, treeHouse: true };
        send(ws, { type: "treehouse.error", ...payload });
        send(ws, { type: "playroom.error", ...payload });
        send(ws, { type: "familyroom.error", ...payload });
      };
      const sendPlayJoined = (payload: Record<string, unknown>) => {
        const body = { ...payload, playRoom: true, familyRoom: true, treeHouse: true };
        send(ws, { type: "treehouse.joined", ...body });
        send(ws, { type: "playroom.joined", ...body });
        send(ws, { type: "familyroom.joined", ...body });
      };

      if (playRoomWsType === "treehouse.join") {
        const lineId = String(msg.lineId || client.lineId || "");
        if (!lineId || lineId !== client.lineId) {
          sendPlayErr("Bad line");
          return;
        }
        const householdId = householdIdForLine(lineId);
        if (!householdId) {
          sendPlayErr("Unknown line");
          return;
        }
        if (!canJoinTreeHouse(db, lineId)) {
          const joinLine = db.prepare(`SELECT IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`).get(
            lineId
          ) as { mode: string } | undefined;
          const uid = client.userId;
          const parentOfHouse =
            typeof uid === "string" &&
            uid.length > 0 &&
            !isChildOnlyAccount(db, uid) &&
            canManageHouseholdChildState(db, uid, householdId) &&
            (joinLine?.mode || "parent") !== "child";
          sendPlayErr(
            parentOfHouse
              ? "Parents use Listen only — tap TreeHouse or Parent → TreeHouse (no join approve needed)"
              : "TreeHouse is for kid lines"
          );
          return;
        }
        const result = joinTreeHouseLine(lineId, {
          notifyJoiner: (payload) => {
            sendPlayJoined(payload);
            if (!payload.alreadyIn) {
              send(ws, {
                type: "group.peer-joined",
                roomId: payload.roomId,
                lineId,
                hostLineId: payload.hostLineId,
                members: payload.members,
                invited: [],
                talkPeers: payload.talkPeers,
                analogMembers: payload.analogMembers || [],
                familyRoom: true,
                playRoom: true,
                mothership: true,
              });
            }
          },
        });
        if (!result.ok) {
          sendPlayErr(result.error);
          return;
        }
        return;
      }

      if (playRoomWsType === "treehouse.leave") {
        const lineId = String(msg.lineId || client.lineId || "");
        if (!lineId || lineId !== client.lineId) return;
        leaveTreeHouseLine(lineId);
        return;
      }

      if (playRoomWsType === "treehouse.listen.start") {
        const parentLineId = String(msg.parentLineId || client.lineId || "");
        const childLineId = String(msg.childLineId || "");
        if (!parentLineId || parentLineId !== client.lineId || !childLineId) {
          sendPlayErr("Bad listen session");
          return;
        }
        if (!client.userId || isChildOnlyAccount(db, client.userId)) {
          sendPlayErr("Only parents can listen");
          return;
        }
        const childHouseholdId = householdIdForLine(childLineId);
        if (
          !childHouseholdId ||
          !canManageHouseholdChildState(db, client.userId, childHouseholdId)
        ) {
          sendPlayErr("Not authorized for this household");
          return;
        }
        const childLine = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(childLineId) as
          | { household_id: string; mode?: string }
          | undefined;
        if (!childLine || childLine.household_id !== childHouseholdId) {
          sendPlayErr("Unknown child line");
          return;
        }
        if ((childLine.mode || "parent") !== "child") {
          sendPlayErr("Listen-only mirrors a kid line");
          return;
        }
        const room = activeTreeHouseRoom();
        if (!room || !room.members.has(childLineId)) {
          sendPlayErr("That kid isn’t in TreeHouse right now");
          return;
        }
        if (!room.listeners) room.listeners = new Map();
        if (room.members.has(parentLineId)) {
          sendPlayErr("Leave TreeHouse talk before listening");
          return;
        }
        room.listeners.set(parentLineId, { childLineId, startedAt: Date.now() });
        const listenTargets = familyRoomListenerTargets(room, childLineId);
        const analogTargets = listenTargets.filter((id) => room.analogMembers?.has(id));
        const childName = linePublicLabel(childLineId);
        const announceText = `${childName}’s parent is listening`;
        // Honesty cue only to kids who share Circles with this child (not every kid on the mothership).
        const announceTo = new Set<string>([
          childLineId,
          ...treeHouseTalkPeers(db, childLineId, [...room.members]),
        ]);
        fanoutFamilyRoomAnnounce(room, announceText, "parent-listen", announceTo);
        const listenPayload = {
          roomId: room.id,
          householdId: MOTHERSHIP_TREEHOUSE_KEY,
          parentLineId,
          childLineId,
          childName,
          listenTargets,
          analogTargets,
          members: roomMemberList(room),
          playRoom: true,
          familyRoom: true,
          treeHouse: true,
          mothership: true,
        };
        send(ws, { type: "treehouse.listen.started", ...listenPayload });
        send(ws, { type: "playroom.listen.started", ...listenPayload });
        send(ws, { type: "familyroom.listen.started", ...listenPayload });
        for (const targetId of listenTargets) {
          if (room.analogMembers?.has(targetId)) continue;
          const c = findSoftphoneByLine(targetId);
          if (!c) continue;
          send(c.ws, {
            type: "group.peer-joined",
            roomId: room.id,
            lineId: parentLineId,
            hostLineId: room.hostLineId,
            members: roomMemberList(room),
            invited: [],
            listener: true,
            listenForChildLineId: childLineId,
            familyRoom: true,
            playRoom: true,
          });
        }
        fanoutFamilyRoomPresence();
        console.log(
          `[treehouse] listen start room=${room.id} parent=${parentLineId} child=${childLineId}`
        );
        return;
      }

      if (playRoomWsType === "treehouse.listen.stop") {
        const parentLineId = String(msg.parentLineId || client.lineId || "");
        if (!parentLineId || parentLineId !== client.lineId) return;
        const room =
          activeTreeHouseRoom() ||
          [...groupRooms.values()].find((r) => r.listeners?.has(parentLineId));
        if (!room?.listeners?.has(parentLineId)) return;
        room.listeners.delete(parentLineId);
        fanoutGroup(room, {
          type: "group.peer-left",
          roomId: room.id,
          lineId: parentLineId,
          members: roomMemberList(room),
          invited: [],
          listener: true,
          familyRoom: true,
          playRoom: true,
        });
        send(ws, {
          type: "treehouse.listen.stopped",
          roomId: room.id,
          playRoom: true,
          familyRoom: true,
          treeHouse: true,
        });
        send(ws, {
          type: "playroom.listen.stopped",
          roomId: room.id,
          playRoom: true,
          familyRoom: true,
          treeHouse: true,
        });
        send(ws, {
          type: "familyroom.listen.stopped",
          roomId: room.id,
          playRoom: true,
          familyRoom: true,
          treeHouse: true,
        });
        fanoutFamilyRoomPresence();
        console.log(`[treehouse] listen stop ${room.id} ${parentLineId}`);
        return;
      }
      return;
    }

    // —— FamilyRoom (# IVR; full mesh of admin-approved family) ——
    if (type === "adultfamily.join" || type === "adultfamily.leave") {
      const lineId = String(msg.lineId || client.lineId || "");
      if (!lineId || lineId !== client.lineId) {
        send(ws, { type: "adultfamily.error", error: "Bad line" });
        return;
      }
      if (type === "adultfamily.leave") {
        leaveAdultFamilyRoomLine(lineId);
        send(ws, { type: "adultfamily.left", lineId });
        return;
      }
      const householdId = String(msg.householdId || householdIdForLine(lineId) || "");
      if (!householdId) {
        send(ws, { type: "adultfamily.error", error: "Unknown household" });
        return;
      }
      const result = joinAdultFamilyRoomLine(lineId, householdId);
      if (!result.ok) {
        send(ws, { type: "adultfamily.error", error: result.error });
        return;
      }
      send(ws, {
        type: "adultfamily.joined",
        roomId: result.roomId,
        householdId: result.householdId,
        hostLineId: result.hostLineId,
        members: result.members,
        talkPeers: result.talkPeers,
        adultFamilyRoom: true,
        alreadyIn: Boolean(result.alreadyIn),
      });
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
      if (lineId !== client.lineId) return;
      const room = roomId ? groupRooms.get(roomId) : undefined;
      // Hangup before joined ack still has to drop occupancy (line id, not room id).
      if (!room) {
        leaveAdultFamilyRoomLine(lineId);
        leaveTreeHouseLine(lineId);
        return;
      }
      if (room.adultFamilyRoomHouseholdId) {
        leaveAdultFamilyRoomLine(lineId);
        return;
      }
      if (room.familyRoomHouseholdId) {
        leaveTreeHouseLine(lineId);
        return;
      }
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
      const fromLineId = String(msg.fromLineId || client.lineId || "");
      const toLineId = String(msg.toLineId || "");
      if (!fromLineId || !toLineId) return;
      // TreeHouse: only relay mesh signaling on symmetric talk edges (or parent listen path).
      // FamilyRoom: full mesh between all admin-approved members (kids + adults).
      const room =
        [...groupRooms.values()].find(
          (r) =>
            r.id === String(msg.roomId || "") &&
            (Boolean(r.familyRoomHouseholdId) || Boolean(r.adultFamilyRoomHouseholdId)) &&
            (r.members.has(fromLineId) ||
              r.listeners?.has(fromLineId) ||
              r.members.has(toLineId) ||
              r.listeners?.has(toLineId))
        ) || null;
      if (room?.familyRoomHouseholdId && !room.adultFamilyRoomHouseholdId) {
        const fromListener = room.listeners?.get(fromLineId);
        const toListener = room.listeners?.get(toLineId);
        let allowed = canTalkInTreeHouse(db, fromLineId, toLineId);
        if (!allowed && fromListener) {
          const targets = familyRoomListenerTargets(room, fromListener.childLineId);
          allowed = targets.includes(toLineId);
        }
        if (!allowed && toListener) {
          const targets = familyRoomListenerTargets(room, toListener.childLineId);
          allowed = targets.includes(fromLineId);
        }
        if (!allowed) {
          console.log(`[treehouse] drop ${type} ${fromLineId}→${toLineId} (no talk edge)`);
          return;
        }
      }
      const target = findGroupSignalingClient(toLineId, room) || findByLine(toLineId);
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
          clearPendingSignaling(row.id, row.from_line_id, row.to_line_id);
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
        leaveTreeHouseLine(client.lineId);
        leaveAdultFamilyRoomLine(client.lineId);
        for (const room of [...groupRooms.values()]) {
          if (!room.members.has(client.lineId) && !room.invited.has(client.lineId)) continue;
          if (room.familyRoomHouseholdId || room.adultFamilyRoomHouseholdId) continue;
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
      clearPendingSignaling(row.id, row.from_line_id, row.to_line_id);
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

/** Analog FXS: join / leave TreeHouse (pad 0) without WebRTC mesh. */
app.post("/api/bridge/treehouse/join", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const { lineId, sipExtension } = (req.body || {}) as { lineId?: string; sipExtension?: string };
  let id = String(lineId || "").trim();
  if (!id && sipExtension) {
    const ata = getAtaBySipExtension(db, String(sipExtension));
    id = ata?.line_id || "";
  }
  if (!id) return res.status(400).json({ ok: false, error: "lineId or sipExtension required" });
  const result = joinTreeHouseLine(id, { analog: true });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post("/api/bridge/treehouse/leave", (req, res) => {
  if (!bridgeSecretOk(req)) return res.status(401).json({ error: "Unauthorized" });
  const { lineId, sipExtension } = (req.body || {}) as { lineId?: string; sipExtension?: string };
  let id = String(lineId || "").trim();
  if (!id && sipExtension) {
    const ata = getAtaBySipExtension(db, String(sipExtension));
    id = ata?.line_id || "";
  }
  if (!id) return res.status(400).json({ ok: false, error: "lineId or sipExtension required" });
  const result = leaveTreeHouseLine(id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

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

  // Automagic: push media_address / lan|remote mode for every ATA on boot so
  // cousins never stay on a silent ring/no-audio FreePBX endpoint after a deploy.
  if (freepbxSyncConfigured()) {
    void (async () => {
      const atas = listAtaDevices(db);
      if (!atas.length) return;
      let ok = 0;
      let fail = 0;
      for (const ata of atas) {
        const sync = await syncAtaSipSecretToFreepbx(ata.sip_extension, ata.sip_password, {
          sipServer: resolveAtaSipServer(ata, db) || "",
          displayName: ata.display_name,
          setupMode: ataSetupModeForDevice(db, ata),
        });
        if (sync.ok && !sync.skipped) ok += 1;
        else if (!sync.ok) {
          fail += 1;
          console.warn(`[freepbx-sync] boot reconcile fail ext=${ata.sip_extension} err=${sync.error}`);
        }
      }
      if (ok || fail) {
        console.log(`[freepbx-sync] boot reconcile: ${ok} ok, ${fail} failed (${atas.length} ATA(s))`);
      }
    })().catch((e) => console.warn("[freepbx-sync] boot reconcile error:", (e as Error).message || e));
  }
});
