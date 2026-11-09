/**
 * PhoneHome bridged — FreePBX ARI (Stasis) ↔ PhoneHome WebRTC softphones / HT801 FXS.
 *
 * Paths:
 *   ATA → softphone: Stasis → resolve → WS call.offer → ExternalMedia ↔ WebRTC
 *   ATA → ATA:       Stasis → resolve (toSipExtension) → originate PJSIP → mixing bridge
 *   ATA → TreeHouse: Stasis → resolve treeHouse → Circle hear-bridges + presence (pad 0)
 *   softphone → ATA: HTTP /claim → WS as callee → answer WebRTC → originate FXS + ExternalMedia
 */
import ari from "ari-client";
import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import WebSocket from "ws";
import OpusScript from "opusscript";
import {
  MediaStreamTrack,
  RTCPeerConnection,
  RtpHeader,
  RtpPacket,
  useOPUS,
  usePCMU,
} from "werift";
import { createVmIvr } from "./vm-ivr.mjs";
import { createVoicePrompts } from "./voicePrompts.mjs";
import { amiConfigFromEnv, fetchAmiContactEvidence } from "./amiContacts.mjs";
import { analogAnnounceTargets, analogEdgesToLink } from "./treehouseAtaMix.mjs";
import { sanitizeIvrText } from "./ivrText.mjs";
import { isIvrBargeInDigit, normalizeIvrIntKeys } from "./ivrBargeIn.mjs";
import { createMediaReadinessGate } from "./mediaReadiness.mjs";
import { resolveExternalMediaRtpEndpoint } from "./externalMediaRtp.mjs";
import {
  createOneToOneBridge,
  addLegsToBridge,
  answerChannelsAfterBridgeJoin,
  EXTERNAL_MEDIA_ENCAPSULATION,
  EXTERNAL_MEDIA_TRANSPORT,
} from "./analogMedia.mjs";
import { originateFxsPeerWaitPickup } from "./fxsOriginate.mjs";
import { sweepOrphanedExternalMedia } from "./orphanSweep.mjs";
import {
  handsetPromptEnabled,
  handsetPromptFrames,
  nextPacerFrame,
  wavPcm16,
} from "./handsetPrompt.mjs";
import {
  createAudioEvidence,
  directionalMediaDelta,
  directionalMediaSnapshot,
  observePcmActivity,
  rtpQosCounters,
  ataLegDelta,
  gapAdjustedRtpAdvance,
} from "./mediaDiagnostics.mjs";

const execFileAsync = promisify(execFile);
const PH_URL = (process.env.PHONEHOME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const PH_WS = process.env.PHONEHOME_WS || PH_URL.replace(/^http/, "ws") + "/ws";
const BRIDGE_SECRET = (process.env.BRIDGE_SECRET || "").trim();
const ARI_URL = process.env.ARI_URL || "http://127.0.0.1:8088";
const ARI_USER = process.env.ARI_USER || "phonehome";
const ARI_PASS = process.env.ARI_PASS || "";
const ARI_APP = process.env.ARI_APP || "phonehome";
const EXT_MEDIA_HOST = process.env.EXT_MEDIA_HOST || "127.0.0.1";
const EXT_MEDIA_PORT_BASE = Number(process.env.EXT_MEDIA_PORT_BASE || 14000);
const BRIDGE_HTTP_PORT = Number(process.env.BRIDGE_HTTP_PORT || 8790);
/** Bind for claim + *98 media URLs Asterisk downloads (lab FreePBX on LAN). */
const BRIDGE_HTTP_BIND = process.env.BRIDGE_HTTP_BIND || "0.0.0.0";
const MEDIA_BASE_URL =
  process.env.MEDIA_BASE_URL || `http://${EXT_MEDIA_HOST}:${BRIDGE_HTTP_PORT}`;
const SIP_ENDPOINT_PREFIX = process.env.SIP_ENDPOINT_PREFIX || "PJSIP";
/** Local Piper (amy) for in-Stasis FXS announce — no dialplan leave / SRTP break. */
const PIPER_DIR = process.env.PIPER_DIR || "/opt/piper";
const PIPER_BIN = process.env.PIPER_BIN || path.join(PIPER_DIR, "piper", "piper");
const PIPER_MODEL =
  process.env.PIPER_MODEL || path.join(PIPER_DIR, "voices", "en_US-amy-medium.onnx");
/** Match softphone RING_TIMEOUT_MS — unanswered ATA/soft ring → leave-a-message. */
const RING_TIMEOUT_MS = Math.max(15_000, Number(process.env.RING_TIMEOUT_MS || 40_000));
/** Softphone→ATA "Call from {name}" on the handset: "all" (default), "off", or extensions. */
const HANDSET_CALLER_ANNOUNCE = process.env.HANDSET_CALLER_ANNOUNCE || "all";
/** A prompt not rendered this soon after pickup is skipped, not played late. */
const HANDSET_PROMPT_WAIT_MS = 1000;
/**
 * Optional AMI login used only to read AOR contacts (registration truth).
 * Unset by default → /sip-status falls back to coarse ARI endpoint state and
 * says so via `confidence: "low"`.
 */
const amiConfig = amiConfigFromEnv();
const AMI_HOST = amiConfig?.host || safeHostname(ARI_URL);

/** Host part of a URL, for defaulting AMI to the same PBX as ARI. */
function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "127.0.0.1";
  }
}

if (!BRIDGE_SECRET) {
  console.error("[bridged] BRIDGE_SECRET is required");
  process.exit(1);
}

/** @type {Map<string, CallSession>} */
const sessions = new Map();
/** @type {Map<string, InboundClaim>} lineId → softphone→ATA claim */
const inboundClaims = new Map();
/** @type {Map<string, { resolve: Function, reject: Function }>} channelId → waiters for sip-leg */
const pendingSipLegs = new Map();
/** @type {Map<string, { resolve: Function, reject: Function }>} channelId → waiters after Flite announce */
const pendingAnnounce = new Map();
/** @type {Map<string, { resolve: Function, reject: Function }>} channelId → waiters after Flite IVR say */
const pendingIvrSay = new Map();
/** Channels temporarily leaving Stasis for phonehome-announce / phonehome-ivr-say dialplan. */
const announceInProgress = new Set();
const ivrSayInProgress = new Set();
/**
 * Circle-filtered analog TreeHouse legs (pad 0).
 * Each FXS has a personal hear-bridge: own channel + ChannelSnoop of Circle
 * talk peers only (not a household-wide mix). Parent listen taps the child's bridge.
 * @type {Map<string, {
 *   session: CallSession,
 *   channel: import("ari-client").Channel,
 *   hearBridge: import("ari-client").Bridge,
 *   snoops: Map<string, import("ari-client").Channel>,
 * }>}
 */
const treeHouseAtaLegs = new Map();
/** Parent listen-only ExternalMedia on a child's Circle hear-bridge. parentLineId → session */
const treeHouseListenSessions = new Map();

let nextMediaPort = EXT_MEDIA_PORT_BASE;
/** @type {import("ari-client").Client | null} */
let ariClient = null;
/** Short-lived WAV tokens for Asterisk Playback(http://…) during *98 IVR. */
const mediaTokens = new Map();
/**
 * When softphone→ATA originate fails (stale Unavail contact), ARI may still
 * report endpoint "online". Negative-cache so /sip-status and /claim stay honest.
 * @type {Map<string, number>} extension → epoch ms until treated offline
 */
const sipUnreachableUntil = new Map();
const SIP_UNREACHABLE_TTL_MS = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of mediaTokens) {
    if (v.expires < now) mediaTokens.delete(k);
  }
}, 30_000);

async function phFetch(path, opts = {}) {
  const res = await fetch(`${PH_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BRIDGE_SECRET}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body?.reason || body?.error || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * Leave Stasis for [phonehome-ivr-say]. The dialplan re-enters with
 * post-ivr-say,<digit> when Read captured a key.
 * @returns {Promise<string|null>}
 */
function leaveStasisForIvrSay(channel) {
  ivrSayInProgress.add(channel.id);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pendingIvrSay.delete(channel.id);
      ivrSayInProgress.delete(channel.id);
      reject(new Error("ivr say timeout"));
    }, 90_000);
    pendingIvrSay.set(channel.id, {
      resolve: (d) => {
        clearTimeout(t);
        pendingIvrSay.delete(channel.id);
        ivrSayInProgress.delete(channel.id);
        resolve(d || null);
      },
      reject: (err) => {
        clearTimeout(t);
        pendingIvrSay.delete(channel.id);
        ivrSayInProgress.delete(channel.id);
        reject(err);
      },
    });
    channel
      .continueInDialplan({
        context: "phonehome-ivr-say",
        extension: "s",
        priority: 1,
      })
      .catch((e) => {
        clearTimeout(t);
        pendingIvrSay.delete(channel.id);
        ivrSayInProgress.delete(channel.id);
        reject(e);
      });
  });
}

/**
 * Speak an IVR phrase on the FXS channel.
 * Prefer in-Stasis Piper (amy) — same voice as Call-from screening / TreeHouse.
 * Flite dialplan is fallback only (must quote PH_IVR_TEXT: commas = intkeys otherwise).
 *
 * Barge-in (Grandparents menu) must not use channel.play. Asterisk's Stasis
 * streamer is called with no stop keys, so it frees the DTMF frame and ARI
 * never emits ChannelDtmfReceived. Dialplan Read() returns that digit.
 *
 * @param {string|null|boolean} [intKeys]  Digits that barge-in (stop TTS). true → 123456789.
 * @returns {Promise<string|null>} interrupting digit, or null if the prompt finished.
 */
async function sayIvrText(channel, text, intKeys = null) {
  const phrase = sanitizeIvrText(text);
  const keys = normalizeIvrIntKeys(intKeys);
  console.log(
    `[bridged] IVR say "${phrase}" ch=${channel.id}${keys ? ` barge-in=${keys}` : ""}`
  );
  try {
    await channel.answer();
  } catch {}
  // Stale media URL would make the next dialplan entry replay the menu file.
  try {
    await channel.setChannelVar({ variable: "PH_IVR_MEDIA", value: "" });
  } catch {}

  let wav = null;
  try {
    wav = await renderPiperTelephonyWav(phrase);
    const url = registerMediaFile(wav, 120_000);
    if (keys) {
      await channel.setChannelVar({ variable: "PH_IVR_MEDIA", value: url });
      await channel.setChannelVar({ variable: "PH_IVR_TEXT", value: phrase });
      await channel.setChannelVar({ variable: "PH_IVR_INTKEYS", value: keys });
      const digit = await leaveStasisForIvrSay(channel);
      console.log(
        `[bridged] IVR Read ch=${channel.id}${digit ? ` digit=${digit}` : " none"}`
      );
      return digit;
    }
    const timeoutMs = Math.min(90_000, 12_000 + phrase.length * 100);
    await playMediaUri(channel, `sound:${url}`, timeoutMs);
    console.log(`[bridged] IVR Piper ok ch=${channel.id}`);
    return null;
  } catch (e) {
    console.warn(`[bridged] IVR Piper failed (${e.message || e}); flite fallback`);
    try {
      await channel.setChannelVar({ variable: "PH_IVR_MEDIA", value: "" });
    } catch {}
  } finally {
    if (wav) {
      try {
        fs.unlinkSync(wav);
      } catch {}
    }
  }

  try {
    await channel.setChannelVar({ variable: "PH_IVR_TEXT", value: phrase });
    await channel.setChannelVar({ variable: "PH_IVR_INTKEYS", value: keys });
    await channel.setChannelVar({ variable: "PH_IVR_MEDIA", value: "" });
    return await leaveStasisForIvrSay(channel);
  } catch (e) {
    ivrSayInProgress.delete(channel.id);
    pendingIvrSay.delete(channel.id);
    throw e;
  }
}

const SOUNDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sounds");

function registerMediaFile(filePath, ttlMs = 120_000) {
  const token = randomBytes(12).toString("hex");
  mediaTokens.set(token, { filePath, expires: Date.now() + ttlMs });
  return `${MEDIA_BASE_URL.replace(/\/$/, "")}/media/${token}.wav`;
}

function playFinished(playback, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      cleanup();
      resolve("timeout");
    }, timeoutMs);
    const onFin = () => {
      cleanup();
      resolve("finished");
    };
    const onFail = () => {
      cleanup();
      resolve("failed");
    };
    function cleanup() {
      clearTimeout(t);
      try {
        playback.removeListener("PlaybackFinished", onFin);
      } catch {}
      try {
        playback.removeListener("PlaybackFailed", onFail);
      } catch {}
    }
    playback.once("PlaybackFinished", onFin);
    playback.once("PlaybackFailed", onFail);
  });
}

/**
 * Play media on a channel. intKeys stops playback on that DTMF and returns it.
 * Grandparents menu does not use this — Stasis playback discards the digit.
 * @returns {Promise<string|null>}
 */
/** Piper/static WAV playback success check for *98 menus (Flite fallback when false). */
async function playMediaUriOk(channel, media, timeoutMs = 20_000) {
  try {
    const playback = await channel.play({ media });
    const result = await playFinished(playback, timeoutMs);
    return result === "finished";
  } catch (e) {
    console.warn(`[bridged] media playback failed:`, e?.message || e);
    return false;
  }
}

async function playMediaUri(channel, media, timeoutMs = 20000, intKeys = null) {
  const keys = normalizeIvrIntKeys(intKeys);
  const playback = await channel.play({ media });
  if (!keys) {
    await playFinished(playback, timeoutMs);
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (digit) => {
      if (settled) return;
      settled = true;
      try {
        channel.removeListener("ChannelDtmfReceived", onDigit);
      } catch {}
      resolve(digit);
    };
    function onDigit(event) {
      const d = String(event.digit || "");
      if (!isIvrBargeInDigit(d, keys)) return;
      try {
        playback.stop();
      } catch {}
      finish(d);
    }
    channel.on("ChannelDtmfReceived", onDigit);
    playFinished(playback, timeoutMs).then(() => finish(null));
  });
}

/**
 * Softphone hung up on an ATA↔WebRTC call — tell the handset, then BYE.
 *
 * Do NOT channel.play on the SRTP FXS leg before hangup. That path left HT801s
 * in a silent "still in call" state (no dialtone on the next off-hook) until
 * power-cycle. "Call ended" is bridge playback while the handset is still in
 * the bridge; BYE immediately after restores idle dialtone.
 */
function detachWebRtcWaiter(session) {
  const ws = session?.ws;
  const handler = session?._webrtcMsgHandler;
  if (ws && handler) {
    try {
      ws.off("message", handler);
    } catch {}
  }
  if (session) session._webrtcMsgHandler = null;
}

/**
 * Drop WebRTC / ExternalMedia mix state but keep the FXS Stasis channel alive for
 * no-answer voicemail IVR (channel.play / channel.record on a bridged leg wedges).
 */
async function releaseMediaForVoicemail(session) {
  if (!session) return;
  session.mediaMixLive = false;
  session.sendPcmu = null;
  if (session._pcmuPacer) {
    clearInterval(session._pcmuPacer);
    session._pcmuPacer = null;
  }
  session._pcmuQueue = null;
  session._handsetPrompt = null;
  detachWebRtcWaiter(session);
  try {
    session.ws?.close();
  } catch {}
  session.ws = null;
  try {
    await session.pc?.close();
  } catch {}
  session.pc = null;
  try {
    if (session.extChannel) await session.extChannel.hangup();
  } catch {}
  session.extChannel = null;
  try {
    if (session.destChannel && session.destChannel.id !== session.channelId) {
      await session.destChannel.hangup();
    }
  } catch {}
  session.destChannel = null;
  try {
    if (session.bridge) await session.bridge.destroy();
  } catch {}
  session.bridge = null;
  session._extMediaJoin = null;
  session._rtpTargetLocked = false;
  session.remoteRtp = null;
  try {
    session.rtpSock?.close();
  } catch {}
  session.rtpSock = null;
}

/** Tell the control plane + softphone WS that the call ended (FXS hangup, deploy, etc.). */
async function emitCallHangup(session, reason = "bridge-hangup") {
  if (!session?.callId) return;
  session.hangupReason = reason;
  try {
    if (!session.hangupNotified && session.ws?.readyState === WebSocket.OPEN) {
      session.hangupNotified = true;
      const payload = JSON.stringify({
        type: "call.hangup",
        callId: session.callId,
        fromLineId: session.fromLineId,
        toLineId: session.toLineId,
        reason,
      });
      await new Promise((resolve) => {
        try {
          session.ws.send(payload, () => resolve());
        } catch {
          resolve();
        }
        setTimeout(resolve, 500);
      });
    }
  } catch {}
  if (session.lifecycleHangupSent) return;
  session.lifecycleHangupSent = true;
  try {
    await phFetch(`/api/bridge/calls/${encodeURIComponent(session.callId)}/event`, {
      method: "POST",
      body: JSON.stringify({
        type: "hangup",
        actorLineId: session.fromLineId,
        reason,
        idempotencyKey: `ari-hangup:${session.channelId}`,
      }),
    });
  } catch (e) {
    console.warn(`[bridged] lifecycle hangup failed call=${session.callId}:`, e.message || e);
  }
}

async function endAtaCallFromSoftphoneHangup(session, reason = "softphone-hangup") {
  if (!session || session.closed) return;
  const fxs = session.fxsChannel;
  console.log(`[bridged] ${reason} call=${session.callId || "?"} — drop FXS`);
  await finalizeMediaDiagnostics(session, "pre-hangup");
  try {
    await sayCallEnded(session);
  } catch (e) {
    console.warn(`[bridged] Call ended skipped:`, e.message || e);
  }
  try {
    if (session.bridge && fxs?.id) {
      try {
        await session.bridge.removeChannel({ channel: fxs.id });
      } catch {}
    }
  } catch (e) {
    console.warn(`[bridged] FXS unbridge skipped:`, e?.message || e);
  }
  // Prefer a direct channel hangup so BYE reaches the ATA even if session.close races.
  if (fxs) {
    try {
      await fxs.hangup();
    } catch {}
  }
  await session.close(ariClient);
}

const voicePrompts = createVoicePrompts({
  soundsDir: SOUNDS_DIR,
  mediaBaseUrl: MEDIA_BASE_URL,
  mediaTokens,
  playMediaUri: playMediaUriOk,
});

const vmIvr = createVmIvr({
  phFetch,
  phUrl: PH_URL,
  bridgeSecret: BRIDGE_SECRET,
  ariUrl: ARI_URL,
  ariUser: ARI_USER,
  ariPass: ARI_PASS,
  mediaBaseUrl: MEDIA_BASE_URL,
  mediaTokens,
  playPrompt: voicePrompts.playPrompt,
  countPromptKey: voicePrompts.countPromptKey,
  countPromptFlite: voicePrompts.countPromptFlite,
  sayText: sayIvrText,
});

/** Callee-oriented policy prompts (WAV under bridged/sounds/). */
function unavailableSoundPath(voice) {
  const map = {
    timeout: "unavailable-timeout.wav",
    bedtime: "unavailable-bedtime.wav",
    school: "unavailable-school.wav",
    quiet: "unavailable-quiet.wav",
    paused: "unavailable-paused.wav",
    cap: "unavailable-cap.wav",
  };
  const name = map[String(voice || "")];
  if (!name) return null;
  const full = path.join(SOUNDS_DIR, name);
  return fs.existsSync(full) ? full : null;
}

async function playUnavailablePrompt(channel, body) {
  try {
    await channel.answer();
  } catch {}
  const wav = unavailableSoundPath(body?.voice);
  try {
    if (wav) {
      const url = registerMediaFile(wav);
      await playMediaUri(channel, `sound:${url}`);
      return;
    }
  } catch (e) {
    console.warn("[bridged] unavailable wav failed:", e.message || e);
  }
  // Offline / allowlist / unknown — speak the hub phrase (do not play
  // Asterisk "cannot be completed as dialed", which misleads parents).
  const phrase = sanitizeIvrText(body?.spoken || body?.reason || "");
  if (phrase) {
    try {
      await sayIvrText(channel, phrase);
      return;
    } catch (e) {
      console.warn("[bridged] unavailable TTS failed:", e.message || e);
    }
  }
  try {
    await playMediaUri(channel, "sound:cannot-complete-as-dialed");
  } catch {}
}

function sipEndpoint(ext) {
  return `${SIP_ENDPOINT_PREFIX}/${String(ext).replace(/\D/g, "")}`;
}

class CallSession {
  constructor(channelId) {
    this.channelId = channelId;
    this.bridge = null;
    this.extChannel = null;
    this.destChannel = null;
    this.rtpSock = null;
    this.rtpPort = 0;
    this.remoteRtp = null;
    this._rtpTargetLocked = false;
    this.sendPcmu = null;
    this._pcmuQueue = null;
    this._pcmuPacer = null;
    this._handsetPrompt = null;
    this.externalMediaTransport = "none";
    this.ws = null;
    this.pc = null;
    this.audioTrack = null;
    this.callId = null;
    this.fromLineId = null;
    this.toLineId = null;
    /** ATA→ATA calls use the hub bridge lifecycle API instead of WebSocket signaling. */
    this.ataToAta = false;
    this.ataLifecycleEnded = false;
    /** ARI channel for the FXS caller (ATA→soft). */
    this.fxsChannel = null;
    /** True after channel.answer() — stops analog ringback before WebRTC SDP. */
    this.fxsAnswered = false;
    /** Bidirectional ExternalMedia RTP armed only after FXS answer (prevents HT801 buzz). */
    this.mediaMixLive = false;
    this.closed = false;
    this.opusEnc = new OpusScript(48000, 1, OpusScript.Application.VOIP);
    this.opusDec = new OpusScript(48000, 1, OpusScript.Application.VOIP);
    /** 1 or 2 — must match the remote Opus stream (iOS often sends stereo). */
    this.opusChannels = 1;
    /** 1 or 2 — outbound Opus to softphone (werift advertises stereo). */
    this.opusEncChannels = 1;
    this._opusDecodeFails = 0;
    /** WebRTC Opus received and PCMU RTP handed to Asterisk. */
    this._webrtcRtpIn = 0;
    this._sipRtpOut = 0;
    /** ATA callers keep ringback until the accepted softphone actually emits RTP. */
    this.softphoneUplinkReady = createMediaReadinessGate();
    /** Packet counters alone can be digital silence; retain decoded PCM evidence too. */
    this.audioEvidence = createAudioEvidence();
    this.mediaDiagTimer = null;
    this.mediaDiagPrevious = null;
    this.mediaDiagFinalLogged = false;
    /** FXS→WebRTC RTP packets forwarded (diagnostics for silent analog→iPhone). */
    this._fxsRtpIn = 0;
    this._webrtcRtpOut = 0;
    this.webrtcSeq = randomBytes(2).readUInt16BE(0);
    this.webrtcTs = randomBytes(4).readUInt32BE(0);
    this.webrtcSsrc = randomBytes(4).readUInt32BE(0);
    this.sipSeq = randomBytes(2).readUInt16BE(0);
    this.sipTs = randomBytes(4).readUInt32BE(0);
    this.sipSsrc = randomBytes(4).readUInt32BE(0);
    this.opusPt = 111;
    /** FXS # hold toggle — peer hears MOH, handset is muted both ways. */
    this.onHold = false;
    /** Extra session map keys (dest / ExternalMedia channel ids). */
    this._sessionKeys = new Set([channelId].filter(Boolean));
    this.hangupNotified = false;
    this.lifecycleHangupSent = false;
    this.hangupReason = null;
  }

  bindChannel(ch) {
    if (!ch?.id) return;
    this._sessionKeys.add(ch.id);
    sessions.set(ch.id, this);
  }

  async close(client) {
    if (this.closed) return;
    if (this._endPrompt) {
      try {
        await this._endPrompt;
      } catch {}
      if (this.closed) return;
    }
    if (this.ataToAta && this.callConnected && !this._saidCallEnded && this.bridge) {
      try {
        await sayCallEnded(this);
      } catch {}
      if (this.closed) return;
    }
    await finalizeMediaDiagnostics(this, "final");
    if (this.ataDiagTimer) {
      clearInterval(this.ataDiagTimer);
      this.ataDiagTimer = null;
      try {
        await logAtaMediaDiagnostics(this, "final");
      } catch {}
    }
    this.closed = true;
    if (this.mediaDiagTimer) clearInterval(this.mediaDiagTimer);
    this.mediaDiagTimer = null;
    for (const id of this._sessionKeys) sessions.delete(id);
    this._sessionKeys.clear();
    if (this.treeHouseListen) {
      if (this.fromLineId) treeHouseListenSessions.delete(this.fromLineId);
      try {
        await this.pc?.close();
      } catch {}
      try {
        this.rtpSock?.close();
      } catch {}
      try {
        this.opusEnc?.delete?.();
        this.opusDec?.delete?.();
      } catch {}
      try {
        if (this.extChannel) await this.extChannel.hangup();
      } catch {}
      return;
    }
    if (this.ataToAta) this.ataLifecycleEnded = true;
    await emitCallHangup(this, this.hangupReason || "bridge-hangup");
    try {
      this.ws?.close();
    } catch {}
    try {
      await this.pc?.close();
    } catch {}
    try {
      this.rtpSock?.close();
    } catch {}
    if (this._pcmuPacer) {
      clearInterval(this._pcmuPacer);
      this._pcmuPacer = null;
    }
    this._pcmuQueue = null;
    this._handsetPrompt = null;
    this.sendPcmu = null;
    this._rtpTargetLocked = false;
    try {
      this.opusEnc?.delete?.();
      this.opusDec?.delete?.();
    } catch {}
    try {
      if (this.extChannel) await this.extChannel.hangup();
    } catch {}
    try {
      if (this.destChannel) await this.destChannel.hangup();
    } catch {}
    // TreeHouse uses a per-leg Circle hear-bridge — leaveTreeHouseAta owns teardown.
    if (!this.treeHouse) {
      try {
        if (this.bridge) await this.bridge.destroy();
      } catch {}
    }
    try {
      if (this.channelId && client) await client.channels.hangup({ channelId: this.channelId });
    } catch {}
  }
}

/**
 * Live Asterisk RTP counters for one PJSIP leg. RTPAUDIOQOS is only populated
 * at hangup; CHANNEL(rtcp,all,audio) is the PJSIP mid-call equivalent
 * (CHANNEL(rtpqos,...) is chan_sip-only and just logs a WARNING on PJSIP).
 * rxcount = decrypted packets received from the ATA, txcount = packets sent to it.
 */
async function channelRtpQos(channel) {
  if (!channel?.getChannelVar) return "";
  for (const variable of ["CHANNEL(rtcp,all,audio)", "RTPAUDIOQOS"]) {
    try {
      const result = await channel.getChannelVar({ variable });
      const value = String(result?.value || "")
        .replace(/[\r\n]+/g, " ")
        .trim()
        .slice(0, 500);
      if (value) return value;
    } catch {
      /* channel gone or no RTP yet */
    }
  }
  return "";
}

/**
 * Where Asterisk actually sends/expects RTP for one PJSIP leg: local socket
 * (CHANNEL(rtp,src,audio)) and the remote address learned from SDP / symmetric
 * RTP (CHANNEL(rtp,dest,audio)). Addresses only — never SDP crypto lines.
 */
async function channelRtpAddresses(channel) {
  if (!channel?.getChannelVar) return "";
  const parts = [];
  for (const [label, variable] of [
    ["local", "CHANNEL(rtp,src,audio)"],
    ["remote", "CHANNEL(rtp,dest,audio)"],
  ]) {
    try {
      const result = await channel.getChannelVar({ variable });
      const value = String(result?.value || "").trim().slice(0, 80);
      if (value) parts.push(`${label}=${value}`);
    } catch {
      /* channel gone or no RTP yet */
    }
  }
  return parts.join(" ");
}

async function logAtaRtpAddresses(session, channel, label) {
  const addresses = await channelRtpAddresses(channel);
  if (addresses) {
    console.log(`[bridged] ATA RTP path ${label} call=${session?.callId || "?"} ${addresses}`);
  }
}

async function asteriskRtpQos(session) {
  return channelRtpQos(session?.fxsChannel || session?.destChannel);
}

async function logAtaMediaDiagnostics(session, label = "5s") {
  const caller = session.fxsChannel;
  const callee = session.destChannel;
  const [callerQos, calleeQos] = await Promise.all([
    channelRtpQos(caller),
    channelRtpQos(callee),
  ]);
  if (!callerQos && !calleeQos) {
    if (label !== "final") {
      console.warn(`[bridged] ATA↔ATA RTP summary ${label} call=${session.callId || "?"} no QoS from either leg`);
    }
    return;
  }
  const current = {
    caller: rtpQosCounters(callerQos),
    callee: rtpQosCounters(calleeQos),
  };
  const delta = ataLegDelta(session.ataDiagPrevious, current);
  session.ataDiagPrevious = current;
  const sustained =
    delta.callerRx >= 100 && delta.callerTx >= 100 && delta.calleeRx >= 100 && delta.calleeTx >= 100;
  console.log(
    `[bridged] ATA↔ATA RTP summary ${label} call=${session.callId || "?"} sustained=${
      sustained ? "yes" : "no"
    } callerRx=${current.caller.rx}(+${delta.callerRx}) callerTx=${current.caller.tx}(+${delta.callerTx}) ` +
      `calleeRx=${current.callee.rx}(+${delta.calleeRx}) calleeTx=${current.callee.tx}(+${delta.calleeTx}) ` +
      `callerLoss=${current.caller.lp}/${current.caller.rlp} calleeLoss=${current.callee.lp}/${current.callee.rlp} ` +
      `callerJitter=${current.caller.rxjitter} calleeJitter=${current.callee.rxjitter}`
  );
}

function startAtaMediaDiagnostics(session) {
  if (session.ataDiagTimer) return;
  session.ataDiagPrevious = null;
  session.ataDiagTimer = setInterval(() => {
    if (session.closed) return;
    void logAtaMediaDiagnostics(session, "5s").catch(() => {});
  }, 5000);
  session.ataDiagTimer.unref?.();
}

async function logMediaDiagnostics(session, label = "periodic") {
  const current = directionalMediaSnapshot(session);
  const delta = directionalMediaDelta(session.mediaDiagPrevious, current);
  session.mediaDiagPrevious = current;
  const sustained = delta.webToFxs >= 100 && delta.fxsToWeb >= 100;
  const qos = await asteriskRtpQos(session);
  console.log(
    `[bridged] RTP summary ${label} call=${session.callId || "?"} sustained=${
      sustained ? "yes" : "no"
    } deltaWebToFxs=${delta.webToFxs} deltaFxsToWeb=${delta.fxsToWeb} ` +
      `webrtcIn=${current.webrtcIn} sipOut=${current.sipOut} ` +
      `fxsIn=${current.fxsIn} webrtcOut=${current.webrtcOut} ` +
      `webActive=${current.webrtcActive} webPeak=${current.webrtcPeak} ` +
      `fxsActive=${current.fxsActive} fxsPeak=${current.fxsPeak}` +
      (qos ? ` asteriskQos="${qos}"` : "")
  );
}

async function finalizeMediaDiagnostics(session, label) {
  if (
    !session ||
    session.mediaDiagFinalLogged ||
    !session.callId ||
    (!session._webrtcRtpIn && !session._fxsRtpIn)
  ) {
    return;
  }
  session.mediaDiagFinalLogged = true;
  await logMediaDiagnostics(session, label);
}

function startMediaDiagnostics(session) {
  if (session.mediaDiagTimer) return;
  session.mediaDiagPrevious = directionalMediaSnapshot(session);
  session.mediaDiagTimer = setInterval(() => {
    if (session.closed) return;
    void logMediaDiagnostics(session, "5s");
  }, 5000);
  session.mediaDiagTimer.unref?.();
}

function ulawToPcm16(ulawBuf) {
  const out = new Int16Array(ulawBuf.length);
  for (let i = 0; i < ulawBuf.length; i++) {
    let u = ~ulawBuf[i] & 0xff;
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    out[i] = sign ? -sample : sample;
  }
  return out;
}

function pcm16ToUlaw(pcm) {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let sample = pcm[i];
    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) sample = -sample;
    if (sample > 32635) sample = 32635;
    sample += 0x84;
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    out[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return out;
}

/** Linear 8k→48k — sample-and-hold sounded harsh/buzzy on softphone speakers. */
function upsample8kTo48k(pcm8) {
  if (!pcm8.length) return new Int16Array(0);
  const out = new Int16Array(pcm8.length * 6);
  for (let i = 0; i < pcm8.length; i++) {
    const a = pcm8[i];
    const b = pcm8[i + 1] ?? a;
    for (let j = 0; j < 6; j++) {
      out[i * 6 + j] = (a + ((b - a) * j) / 6) | 0;
    }
  }
  return out;
}

/** Average each 6-sample group — drops less energy than taking every 6th sample. */
function downsample48kTo8k(pcm48) {
  const out = new Int16Array(Math.floor(pcm48.length / 6));
  for (let i = 0; i < out.length; i++) {
    const base = i * 6;
    out[i] =
      ((pcm48[base] +
        pcm48[base + 1] +
        pcm48[base + 2] +
        pcm48[base + 3] +
        pcm48[base + 4] +
        pcm48[base + 5]) /
        6) |
      0;
  }
  return out;
}

function parseRtpPayload(msg) {
  if (msg.length < 12) return null;
  const cc = msg[0] & 0x0f;
  const headerLen = 12 + cc * 4;
  const pt = msg[1] & 0x7f;
  // ExternalMedia is ulaw (PT 0). Accepting alaw PT 8 and decoding as µ-law
  // produces immediate harsh full-scale buzz on the softphone.
  if (pt !== 0) return null;
  return { payload: msg.subarray(headerLen), pt };
}

function buildPcmuRtp({ payload, seq, timestamp, ssrc }) {
  const hdr = Buffer.alloc(12);
  hdr[0] = 0x80;
  hdr[1] = 0;
  hdr.writeUInt16BE(seq & 0xffff, 2);
  hdr.writeUInt32BE(timestamp >>> 0, 4);
  hdr.writeUInt32BE(ssrc >>> 0, 8);
  return Buffer.concat([hdr, payload]);
}

function int16ToBuffer(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], i * 2);
  return buf;
}

function bufferToInt16(buf) {
  const out = new Int16Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

/**
 * Outbound Opus channel layout from SDP.
 * Only fmtp stereo=1 means stereo (RFC 7587). rtpmap opus/48000/2 is NOT stereo —
 * Chrome/Android always advertise /2, and encoding stereo into a mono session
 * plays as silence on the softphone (Avery/cellular heard nothing while
 * FXS→WebRTC packets still flowed with encCh=2).
 */
function opusChannelsFromSdp(sdp) {
  const s = String(sdp || "");
  if (/a=fmtp:\d+[^\r\n]*stereo=1/i.test(s)) return 2;
  return 1;
}

function downmixStereoToMono(pcmStereo) {
  const frames = Math.floor(pcmStereo.length / 2);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = (pcmStereo[i * 2] + pcmStereo[i * 2 + 1]) >> 1;
  }
  return out;
}

function upmixMonoToStereo(pcmMono) {
  const out = new Int16Array(pcmMono.length * 2);
  for (let i = 0; i < pcmMono.length; i++) {
    out[i * 2] = pcmMono[i];
    out[i * 2 + 1] = pcmMono[i];
  }
  return out;
}

function setOpusDecoderChannels(session, channels) {
  const ch = channels === 2 ? 2 : 1;
  if (session.opusChannels === ch && session.opusDec) return;
  try {
    session.opusDec?.delete?.();
  } catch {}
  session.opusDec = new OpusScript(48000, ch, OpusScript.Application.VOIP);
  session.opusChannels = ch;
  console.log(`[bridged] opus decoder channels=${ch}`);
}

function setOpusEncoderChannels(session, channels) {
  const ch = channels === 2 ? 2 : 1;
  if (session.opusEncChannels === ch && session.opusEnc) return;
  try {
    session.opusEnc?.delete?.();
  } catch {}
  session.opusEnc = new OpusScript(48000, ch, OpusScript.Application.VOIP);
  session.opusEncChannels = ch;
  console.log(`[bridged] opus encoder channels=${ch}`);
}

/**
 * Apply outbound Opus PT + channel layout from SDP.
 * Encode stereo only when fmtp stereo=1; otherwise mono (safe for opus/48000/2
 * without stereo=1). Linear 8k↔48k resample avoids sample-and-hold buzz.
 */
function applyOutboundOpusFromSdp(session, sdp) {
  const s = String(sdp || "");
  const m = s.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (m) session.opusPt = Number(m[1]);
  setOpusEncoderChannels(session, opusChannelsFromSdp(s) === 2 ? 2 : 1);
}

/** Encode 20ms mono PCM48 → Opus (upmix when the softphone negotiated stereo). */
function encodeMonoPcm48ToOpus(session, pcm48mono) {
  const frame =
    session.opusEncChannels === 2 ? upmixMonoToStereo(pcm48mono) : pcm48mono;
  return session.opusEnc.encode(int16ToBuffer(frame), 960);
}

function decodeOpusToMonoPcm48(session, payload) {
  const decoded = session.opusDec.decode(Buffer.from(payload));
  let pcm = bufferToInt16(decoded);
  if (session.opusChannels === 2) pcm = downmixStereoToMono(pcm);
  return pcm;
}

/**
 * Same TURN/STUN set as PhoneHome `/api/ice`. Without TURN, ATA↔remote softphone
 * ICE dies on private host candidates (ring / media-up, silent call).
 */
function buildIceServers() {
  const servers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const turnUrls = (process.env.TURN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Coturn on lab PVE is 192.168.2.31 — not the PhoneHome CT IP.
  const turnLanUrls = (process.env.TURN_LAN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allTurn = [...new Set([...turnUrls, ...turnLanUrls])];
  const withTransport = [];
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

const ICE_SERVERS = buildIceServers();
const HAS_TURN = ICE_SERVERS.some((s) => {
  const u = s.urls;
  const list = Array.isArray(u) ? u : [u];
  return list.some((x) => String(x).startsWith("turn:"));
});
/** TURN allocate needs more than STUN-only gathering. */
const ICE_GATHER_MS = HAS_TURN ? 8000 : 2500;

function waitIceGathering(pc, ms = ICE_GATHER_MS) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      if (pc.iceGatheringState === "complete") {
        try {
          pc.iceGatheringStateChange.unsubscribe(done);
        } catch {}
        resolve();
      }
    };
    try {
      pc.iceGatheringStateChange.subscribe(done);
    } catch {
      setTimeout(resolve, Math.min(ms, 2000));
      return;
    }
    setTimeout(resolve, ms);
  });
}

function wireIceStateLogs(session, pc, label) {
  const tag = () => `[bridged] ICE ${label} call=${session.callId || "?"}`;
  try {
    pc.iceConnectionStateChange?.subscribe?.((s) => {
      console.log(`${tag()} iceConnectionState=${s || pc.iceConnectionState}`);
    });
  } catch {}
  try {
    pc.connectionStateChange?.subscribe?.((s) => {
      console.log(`${tag()} connectionState=${s || pc.connectionState}`);
    });
  } catch {}
  // werift also exposes onIceConnectionStateChange on some builds
  const prevIce = pc.onIceConnectionStateChange;
  pc.onIceConnectionStateChange = (s) => {
    try {
      prevIce?.(s);
    } catch {}
    console.log(`${tag()} iceConnectionState=${s || pc.iceConnectionState}`);
  };
}

function createPeerConnection(session) {
  const audioTrack = new MediaStreamTrack({ kind: "audio" });
  session.audioTrack = audioTrack;
  // Match browser softphones: default werift OPUS is stereo (audio/OPUS).
  // Restricting to mono opus/48000 caused "negotiate codecs failed" on call.answer
  // (ATA→softphone), which crashed bridged and dropped the call on parent answer.
  const pc = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    codecs: {
      audio: [useOPUS({ payloadType: 111 }), usePCMU()],
    },
  });
  session.pc = pc;
  pc.addTrack(audioTrack);
  wireIceStateLogs(session, pc, session.treeHouseListen ? "listen" : "call");

  pc.ontrack = (ev) => {
    const track = ev.track;
    if (!track || track.kind !== "audio") return;
    // Parent listen-only: never inject parent RTP into the analog mix.
    if (session.treeHouseListen) return;
    track.onReceiveRtp.subscribe((rtp) => {
      if (session.closed) return;
      session._webrtcRtpIn = (session._webrtcRtpIn || 0) + 1;
      // Gate FXS answer on softphone mic RTP, not on sendPcmu — mix arms after answer.
      if (session._webrtcRtpIn === 1) session.softphoneUplinkReady?.markReady();
      if (!session.sendPcmu) return;
      try {
        const pcm48 = decodeOpusToMonoPcm48(session, rtp.payload);
        observePcmActivity(session.audioEvidence.webrtc, pcm48);
        const pcm8 = downsample48kTo8k(pcm48);
        const ulaw = pcm16ToUlaw(pcm8);
        for (let off = 0; off + 160 <= ulaw.length; off += 160) {
          if (session.sendPcmu(ulaw.subarray(off, off + 160))) {
            session._sipRtpOut = (session._sipRtpOut || 0) + 1;
          }
        }
        if (session._webrtcRtpIn === 1 || session._webrtcRtpIn % 250 === 0) {
          console.log(
            `[bridged] WebRTC→FXS media in=${session._webrtcRtpIn} out=${session._sipRtpOut} transport=${session.externalMediaTransport}`
          );
        }
      } catch {
        // iOS/Safari often sends stereo Opus while we initially decode mono — flip once.
        session._opusDecodeFails = (session._opusDecodeFails || 0) + 1;
        if (session.opusChannels !== 2 && session._opusDecodeFails <= 3) {
          setOpusDecoderChannels(session, 2);
          try {
            const pcm48 = decodeOpusToMonoPcm48(session, rtp.payload);
            observePcmActivity(session.audioEvidence.webrtc, pcm48);
            const pcm8 = downsample48kTo8k(pcm48);
            const ulaw = pcm16ToUlaw(pcm8);
            for (let off = 0; off + 160 <= ulaw.length; off += 160) {
              if (session.sendPcmu(ulaw.subarray(off, off + 160))) {
                session._sipRtpOut = (session._sipRtpOut || 0) + 1;
              }
            }
            if (session._webrtcRtpIn === 1 || session._webrtcRtpIn % 250 === 0) {
              console.log(
                `[bridged] WebRTC→FXS media in=${session._webrtcRtpIn} out=${session._sipRtpOut} transport=${session.externalMediaTransport}`
              );
            }
            return;
          } catch {
            /* still failing */
          }
        }
        if (session._opusDecodeFails === 1 || session._opusDecodeFails % 100 === 0) {
          console.warn(
            `[bridged] opus→ulaw decode fail x${session._opusDecodeFails} (channels=${session.opusChannels})`
          );
        }
      }
    });
  };
  return pc;
}

/**
 * Stop FXS ringback only when the accepted softphone has started sending RTP.
 * CallKit can accept and exchange SDP several seconds before didActivate starts
 * its audio unit. Answering before that point gives the analog caller dead air.
 */
async function answerFxsWhenMediaReady(session, reason = "accepted") {
  if (!session?.fxsChannel || session.fxsAnswered || session.closed) return;
  if (session._fxsAnswerGate) return session._fxsAnswerGate;
  session._fxsAnswerGate = (async () => {
    const rtpReady = await session.softphoneUplinkReady.wait(8000);
    if (session.fxsAnswered || session.closed) return;
    if (!rtpReady) {
      console.warn(
        `[bridged] FXS answer RTP gate timed out (${reason}) ch=${session.channelId}`
      );
    }
    try {
      await session.fxsChannel.answer();
      session.fxsAnswered = true;
      console.log(
        `[bridged] FXS answered (${reason}) ch=${session.channelId} media=${
          session.extChannel ? "yes" : "no"
        } uplink=${rtpReady ? "ready" : "timeout"}`
      );
    } catch (e) {
      console.warn(`[bridged] FXS answer failed:`, e?.message || e);
    }
  })();
  try {
    return await session._fxsAnswerGate;
  } finally {
    if (!session.fxsAnswered) session._fxsAnswerGate = null;
  }
}

async function startWebRtcLeg(session, resolved) {
  const { sessionId } = await phFetch("/api/bridge/session", {
    method: "POST",
    body: JSON.stringify({ lineId: resolved.fromLineId }),
  });

  session.fromLineId = resolved.fromLineId;
  session.toLineId = resolved.toLineId;

  const pc = createPeerConnection(session);

  const ws = new WebSocket(PH_WS);
  session.ws = ws;
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "hello", sessionId, lineId: resolved.fromLineId }));

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("WS welcome timeout")), 8000);
    const onMsg = (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve();
      }
      if (msg.type === "error") {
        clearTimeout(t);
        ws.off("message", onMsg);
        reject(new Error(msg.error || "ws error"));
      }
    };
    ws.on("message", onMsg);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // VoIP push must not wait on full TURN gather — trickle via call.ice (softphone→ATA path).
  await waitIceGathering(pc, Math.min(ICE_GATHER_MS, 2500));

  const local = pc.localDescription;
  // Outbound PT + stereo from OUR offer. Do not later overwrite PT from the
  // answer — wrong PT → iPhone drops FXS audio (i0.00).
  applyOutboundOpusFromSdp(session, local?.sdp);
  ws.send(
    JSON.stringify({
      type: "call.offer",
      fromLineId: resolved.fromLineId,
      toLineId: resolved.toLineId,
      sdp: { type: local.type, sdp: local.sdp },
    })
  );

  await new Promise((resolve, reject) => {
    let settled = false;
    const onMsg = async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        if (msg.type === "call.ringing" && msg.callId) session.callId = msg.callId;
        if (msg.type === "call.accepted") {
          session.callId = msg.callId || session.callId;
          return;
        }
        if (msg.type === "call.rejected") {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          ws.off("message", onMsg);
          session._webrtcMsgHandler = null;
          const reason = msg.reason || "rejected";
          reject(
            Object.assign(new Error(reason), {
              body: {
                reason,
                voice: msg.voice || null,
                spoken: msg.spoken || null,
                side: msg.side || null,
              },
            })
          );
          return;
        }
        if (msg.type === "call.answer" && msg.sdp) {
          session.callId = msg.callId || session.callId;
          const remote = msg.sdp?.type ? msg.sdp : { type: "answer", sdp: msg.sdp };
          await pc.setRemoteDescription(remote);
          const sdp = String(remote.sdp || "");
          // Decoder only — outbound PT/channels already set from local offer.
          setOpusDecoderChannels(session, opusChannelsFromSdp(sdp));
          if (!settled) {
            settled = true;
            clearTimeout(t);
            // Keep onMsg attached — ATA→soft call.hold/hangup arrive on this WS after
            // answer (e7fdf6a detached here and MOH stopped working).
            resolve();
          }
          return;
        }
        if (msg.type === "call.ice" && msg.candidate) {
          try {
            await pc.addIceCandidate(msg.candidate);
          } catch {}
          return;
        }
        if (msg.type === "call.hold") {
          if (msg.callId && session.callId && msg.callId !== session.callId) return;
          void applySoftphoneHold(session, msg.onHold).catch((e) =>
            console.warn(`[bridged] softphone hold (ATA→soft) failed:`, e.message || e)
          );
          return;
        }
        if (msg.type === "call.hangup") {
          if (!settled) {
            settled = true;
            clearTimeout(t);
            ws.off("message", onMsg);
            session._webrtcMsgHandler = null;
            reject(new Error("remote hangup"));
            return;
          }
          // Already connected — must tear down FXS (was a no-op before → silent handset).
          try {
            ws.off("message", onMsg);
          } catch {}
          session._webrtcMsgHandler = null;
          void endAtaCallFromSoftphoneHangup(session, "softphone-hangup");
        }
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        ws.off("message", onMsg);
        session._webrtcMsgHandler = null;
        const detail = e?.message || String(e);
        // Log codec lines only — never SDP crypto / ICE passwords.
        if (/negotiate codecs/i.test(detail)) {
          const sdp = String(msg?.sdp?.sdp || msg?.sdp || "");
          const lines = sdp
            .split(/\r?\n/)
            .filter((l) => /^(m=audio|a=rtpmap:|a=fmtp:)/i.test(l))
            .slice(0, 12);
          console.error(`[bridged] answer codec negotiate failed:`, detail, lines.join(" | "));
        }
        reject(e instanceof Error ? e : new Error(detail));
      }
    };
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.off("message", onMsg);
      } catch {}
      session._webrtcMsgHandler = null;
      reject(new Error("No answer from softphone"));
    }, RING_TIMEOUT_MS);
    ws.on("message", onMsg);
    session._webrtcMsgHandler = onMsg;
  });

  pc.onIceCandidate?.subscribe?.((candidate) => {
    if (!candidate || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "call.ice",
        callId: session.callId,
        fromLineId: resolved.fromLineId,
        toLineId: resolved.toLineId,
        candidate: candidate.toJSON?.() || candidate,
      })
    );
  });
}

function forwardPcmuToWebRtc(session, payload) {
  if (session.closed || !session.audioTrack || payload.length !== 160) return;
  session._fxsRtpIn = (session._fxsRtpIn || 0) + 1;
  try {
    const pcm8 = ulawToPcm16(payload);
    observePcmActivity(session.audioEvidence.fxs, pcm8);
    const pcm48 = upsample8kTo48k(pcm8);
    const encoded = encodeMonoPcm48ToOpus(session, pcm48);
    const now = Date.now();
    const gap = session._fxsLastFrameAt ? now - session._fxsLastFrameAt : 0;
    session._fxsLastFrameAt = now;
    const { slots, marker } = gapAdjustedRtpAdvance(gap);
    if (marker) {
      console.log(
        `[bridged] FXS→WebRTC resumed after ${gap}ms gap call=${session.callId || "?"} in=${session._fxsRtpIn}`
      );
    }
    session.webrtcSeq = (session.webrtcSeq + 1) & 0xffff;
    session.webrtcTs = (session.webrtcTs + 960 * slots) >>> 0;
    const header = new RtpHeader({
      padding: false,
      extension: false,
      marker,
      payloadOffset: 12,
      payloadType: session.opusPt,
      sequenceNumber: session.webrtcSeq,
      timestamp: session.webrtcTs,
      ssrc: session.webrtcSsrc,
    });
    session.audioTrack.writeRtp(new RtpPacket(header, encoded));
    session._webrtcRtpOut = (session._webrtcRtpOut || 0) + 1;
    if (session._fxsRtpIn === 1 || session._fxsRtpIn % 250 === 0) {
      const sent = session.pc?.getSenders?.()?.[0]?.packetCount;
      console.log(
        `[bridged] FXS→WebRTC media in=${session._fxsRtpIn} out=${session._webrtcRtpOut} transport=${session.externalMediaTransport} pt=${session.opusPt} encCh=${session.opusEncChannels} dtlsSent=${sent ?? "?"}`
      );
    }
  } catch {
    // Ignore isolated codec errors; sustained counters expose a broken direction.
  }
}

/**
 * Bind a UnicastRTP ExternalMedia leg (UDP PCMU). Does not bridge and does not
 * arm WebRTC→PCMU injection yet — softphone→ATA preps this while the handset
 * rings so pickup only needs an atomic bridge join.
 *
 * chan_websocket ExternalMedia was reverted: live lab showed Alex uplink die
 * after ~25 RTP packets (call_yQ83rk8e45 / call_FqkVTQWrZ6) while Asterisk kept
 * sending to her. UDP UnicastRTP was the path that worked for weeks.
 */
async function prepareExternalMediaRtp(client, session) {
  if (session._extMediaPrep) return session._extMediaPrep;
  if (session.extChannel && session.rtpSock) {
    return { ext: session.extChannel };
  }

  session._extMediaPrep = (async () => {
    const port = nextMediaPort;
    nextMediaPort += 2;
    if (nextMediaPort > EXT_MEDIA_PORT_BASE + 2000) nextMediaPort = EXT_MEDIA_PORT_BASE;

    const sock = dgram.createSocket("udp4");
    session.rtpSock = sock;
    session.rtpPort = port;
    await new Promise((resolve) => sock.bind(port, "0.0.0.0", resolve));

    sock.on("message", (msg, _rinfo) => {
      // Never learn send target from inbound RTP — use UNICASTRTP_* only (wrong
      // port → immediate full-scale buzz on the HT801).
      if (!session.mediaMixLive || session.closed || !session.audioTrack) return;
      const parsed = parseRtpPayload(msg);
      if (!parsed || parsed.payload.length !== 160) return;
      forwardPcmuToWebRtc(session, parsed.payload);
    });

    const ext = await client.channels.externalMedia({
      app: ARI_APP,
      external_host: `${EXT_MEDIA_HOST}:${port}`,
      format: "ulaw",
      encapsulation: EXTERNAL_MEDIA_ENCAPSULATION,
      transport: EXTERNAL_MEDIA_TRANSPORT,
      connection_type: "client",
      direction: "both",
    });
    session.extChannel = ext;
    session.bindChannel(ext);
    try {
      session.remoteRtp = await resolveExternalMediaRtpEndpoint(ext, {
        fallbackAddress: safeHostname(ARI_URL),
      });
      session._rtpTargetLocked = true;
      console.log(
        `[bridged] ExternalMedia RTP target ready ${session.remoteRtp.address}:${session.remoteRtp.port}`
      );
    } catch (error) {
      console.warn(
        `[bridged] ExternalMedia RTP target unavailable; waiting for inbound RTP:`,
        error?.message || error
      );
    }
    session.externalMediaTransport = "udp";
    return { ext };
  })();

  try {
    return await session._extMediaPrep;
  } catch (e) {
    session._extMediaPrep = null;
    const stale = session.extChannel;
    session.extChannel = null;
    session.sendPcmu = null;
    session.remoteRtp = null;
    session._rtpTargetLocked = false;
    try {
      session.rtpSock?.close();
    } catch {}
    session.rtpSock = null;
    session.rtpPort = 0;
    if (stale) stale.hangup().catch(() => {});
    throw e;
  }
}

/**
 * Enable ExternalMedia RTP after FXS is in the mix bridge.
 * Injecting PCMU while the HT801 is still ringing wedges SDES → buzz + dead uplink.
 * Keep armReceive false during in-bridge Piper — mediaMixLive forwards the whole mix
 * (announce + garbage) to the softphone at full scale (call_MK9NgOq057).
 * @param {{ armReceive?: boolean, armSend?: boolean }} [opts]
 */
function armExternalMediaMix(session, { armReceive = true, armSend = true } = {}) {
  if (armReceive && !session.mediaMixLive) {
    session.mediaMixLive = true;
    console.log(
      `[bridged] ExternalMedia mix live call=${session.callId || "?"} transport=${session.externalMediaTransport}`
    );
  }
  if (armSend) armExternalMediaSend(session);
}

/** Pace WebRTC→Asterisk PCMU at 20ms (HT801 buzz if unpaced). */
function armExternalMediaSend(session) {
  if (session.sendPcmu) return;
  session._pcmuQueue = [];
  session._pcmuPacer = null;
  session._handsetPrompt = null;
  const flushOne = () => {
    if (session.closed || !session.rtpSock || !session.remoteRtp) {
      session._pcmuQueue = [];
      session._handsetPrompt = null;
      return;
    }
    const { frame, prompt } = nextPacerFrame(session);
    if (!frame) return;
    if (prompt) session._sipRtpOut = (session._sipRtpOut || 0) + 1;
    session.sipSeq = (session.sipSeq + 1) & 0xffff;
    session.sipTs = (session.sipTs + 160) >>> 0;
    const pkt = buildPcmuRtp({
      payload: frame,
      seq: session.sipSeq,
      timestamp: session.sipTs,
      ssrc: session.sipSsrc,
    });
    session.rtpSock.send(pkt, session.remoteRtp.port, session.remoteRtp.address);
  };
  const ensurePacer = () => {
    if (session._pcmuPacer) return;
    session._pcmuPacer = setInterval(() => {
      if (session.closed) {
        clearInterval(session._pcmuPacer);
        session._pcmuPacer = null;
        session._pcmuQueue = [];
        session._handsetPrompt = null;
        return;
      }
      if (!session._pcmuQueue.length && !session._handsetPrompt) {
        clearInterval(session._pcmuPacer);
        session._pcmuPacer = null;
        return;
      }
      // Cap backlog so a stalled sock cannot turn a pause into a multi-second blast.
      if (session._pcmuQueue.length > 50) {
        session._pcmuQueue.splice(0, session._pcmuQueue.length - 25);
      }
      flushOne();
    }, 20);
    session._pcmuPacer.unref?.();
  };
  session.sendPcmu = (frame) => {
    if (!session.rtpSock || !session.remoteRtp || frame.length !== 160) return false;
    if (session._handsetPrompt) return false;
    session._pcmuQueue.push(Buffer.from(frame));
    ensurePacer();
    return true;
  };
  session.sendHandsetPrompt = (frames) => {
    if (session.closed || !session.sendPcmu || !frames?.length) return false;
    session._pcmuQueue = [];
    session._handsetPrompt = { frames, next: 0 };
    ensurePacer();
    return true;
  };
}

/**
 * Bridge FXS + ExternalMedia together. Arm WebRTC→PCMU only after the join so an
 * unbridged prep leg cannot age (call_POrefnnuZq).
 */
async function joinFxsExternalMediaBridge(client, session, sipChannel, { armSend = false } = {}) {
  if (!sipChannel) throw new Error("joinFxsExternalMediaBridge requires sipChannel");
  await prepareExternalMediaRtp(client, session);
  if (session.bridge && session.extChannel) {
    session.bindChannel(sipChannel);
    if (armSend) armExternalMediaMix(session);
    return { bridge: session.bridge, ext: session.extChannel };
  }
  if (session._extMediaJoin) return session._extMediaJoin;

  session._extMediaJoin = (async () => {
    const ext = session.extChannel;
    const bridge = await createOneToOneBridge(
      client,
      `ph-${session.channelId || session.rtpPort || ext.id}`
    );
    session.bridge = bridge;
    session.bindChannel(sipChannel);
    await bridge.addChannel({ channel: `${sipChannel.id},${ext.id}` });
    if (armSend) armExternalMediaMix(session);
    console.log(
      `[bridged] FXS+ExternalMedia joined atomically fxs=${sipChannel.id} ext=${ext.id}`
    );
    return { bridge, ext };
  })();

  try {
    return await session._extMediaJoin;
  } catch (e) {
    session._extMediaJoin = null;
    const staleBridge = session.bridge;
    session.bridge = null;
    try {
      await staleBridge?.destroy();
    } catch {}
    throw e;
  }
}

async function attachExternalMedia(client, session, sipChannel, { armSend = false } = {}) {
  await prepareExternalMediaRtp(client, session);
  if (!sipChannel) {
    return { bridge: null, ext: session.extChannel };
  }
  return joinFxsExternalMediaBridge(client, session, sipChannel, { armSend });
}

/**
 * Listen-only tap of a child's Circle-filtered analog TreeHouse mix → parent WebRTC.
 * direction "out": Asterisk mix to our RTP socket; do not send into the mix.
 */
async function attachTreeHouseListenMedia(client, session, mixBridge) {
  const port = nextMediaPort;
  nextMediaPort += 2;
  if (nextMediaPort > EXT_MEDIA_PORT_BASE + 2000) nextMediaPort = EXT_MEDIA_PORT_BASE;

  const sock = dgram.createSocket("udp4");
  session.rtpSock = sock;
  session.rtpPort = port;
  await new Promise((resolve) => sock.bind(port, "0.0.0.0", resolve));

  sock.on("message", (msg, rinfo) => {
    session.remoteRtp = { address: rinfo.address, port: rinfo.port };
    if (session.closed || !session.audioTrack) return;
    const parsed = parseRtpPayload(msg);
    if (!parsed) return;
    try {
      const pcm8 = ulawToPcm16(parsed.payload);
      const pcm48 = upsample8kTo48k(pcm8);
      for (let off = 0; off + 960 <= pcm48.length; off += 960) {
        const frame = pcm48.subarray(off, off + 960);
        const encoded = encodeMonoPcm48ToOpus(session, frame);
        session.webrtcSeq = (session.webrtcSeq + 1) & 0xffff;
        session.webrtcTs = (session.webrtcTs + 960) >>> 0;
        const header = new RtpHeader({
          padding: false,
          extension: false,
          marker: false,
          payloadOffset: 12,
          payloadType: session.opusPt,
          sequenceNumber: session.webrtcSeq,
          timestamp: session.webrtcTs,
          ssrc: session.webrtcSsrc,
        });
        const pkt = new RtpPacket(header, encoded);
        session.audioTrack.writeRtp(pkt);
      }
    } catch {
      // ignore encode errors on short frames
    }
  });

  let ext;
  try {
    ext = await client.channels.externalMedia({
      app: ARI_APP,
      external_host: `${EXT_MEDIA_HOST}:${port}`,
      format: "ulaw",
      encapsulation: "rtp",
      transport: "udp",
      connection_type: "client",
      direction: "out",
    });
  } catch (e) {
    console.warn(`[bridged] TreeHouse listen ExternalMedia out failed, retry both:`, e.message || e);
    ext = await client.channels.externalMedia({
      app: ARI_APP,
      external_host: `${EXT_MEDIA_HOST}:${port}`,
      format: "ulaw",
      encapsulation: "rtp",
      transport: "udp",
      connection_type: "client",
      direction: "both",
    });
  }
  session.extChannel = ext;
  session.bindChannel(ext);
  await mixBridge.addChannel({ channel: ext.id });
  return ext;
}

async function announceOnTreeHouseMix(client, mixBridge, text) {
  const phrase = sanitizeIvrText(text);
  if (!phrase || !mixBridge?.id) return;
  try {
    const ch = await client.channels.originate({
      endpoint: "Local/s@phonehome-ivr-say",
      app: ARI_APP,
      appArgs: "th-announce",
      variables: { PH_IVR_TEXT: phrase },
    });
    try {
      await ch.answer();
    } catch {}
    await mixBridge.addChannel({ channel: ch.id });
    setTimeout(() => {
      ch.hangup().catch(() => {});
    }, 16_000);
  } catch (e) {
    console.warn(`[bridged] TreeHouse listen announce skipped:`, e.message || e);
  }
}

async function announceOnAnalogCircle(client, childLineId, text) {
  const child = treeHouseAtaLegs.get(childLineId);
  if (!child) return;
  const targets = analogAnnounceTargets(childLineId, child.snoops.keys());
  for (const lineId of targets) {
    const leg = treeHouseAtaLegs.get(lineId);
    if (leg?.hearBridge) {
      void announceOnTreeHouseMix(client, leg.hearBridge, text);
    }
  }
}

/**
 * Bidirectional Circle edge: each leg hears the other via ChannelSnoop → hear-bridge.
 * A channel may only sit in one bridge; snoops are the selective-mix path.
 */
async function linkAnalogTalkEdge(client, lineA, lineB) {
  const a = treeHouseAtaLegs.get(lineA);
  const b = treeHouseAtaLegs.get(lineB);
  if (!a || !b || lineA === lineB) return;
  if (a.snoops.has(lineB) && b.snoops.has(lineA)) return;

  async function addSnoop(listener, speakerLineId, speakerChannel) {
    if (listener.snoops.has(speakerLineId)) return;
    const snoop = await client.channels.snoopChannel({
      channelId: speakerChannel.id,
      app: ARI_APP,
      spy: "out",
      appArgs: "th-snoop",
    });
    try {
      await snoop.answer();
    } catch {}
    await listener.hearBridge.addChannel({ channel: snoop.id });
    listener.snoops.set(speakerLineId, snoop);
  }

  try {
    await addSnoop(a, lineB, b.channel);
    await addSnoop(b, lineA, a.channel);
    console.log(`[bridged] TreeHouse analog Circle link ${lineA} ↔ ${lineB}`);
  } catch (e) {
    console.warn(`[bridged] TreeHouse analog link failed:`, e.message || e);
  }
}

async function unlinkAnalogTalkEdge(lineA, lineB) {
  const a = treeHouseAtaLegs.get(lineA);
  const b = treeHouseAtaLegs.get(lineB);
  if (a?.snoops.has(lineB)) {
    const snoop = a.snoops.get(lineB);
    a.snoops.delete(lineB);
    try {
      await snoop.hangup();
    } catch {}
  }
  if (b?.snoops.has(lineA)) {
    const snoop = b.snoops.get(lineA);
    b.snoops.delete(lineA);
    try {
      await snoop.hangup();
    } catch {}
  }
}

async function handleTreeHouseListenOffer(client, claim, msg) {
  const parentLineId = String(msg.fromLineId || "");
  const childLineId = claim.lineId;
  const leg = treeHouseAtaLegs.get(childLineId);
  if (!leg?.hearBridge) {
    console.warn(`[bridged] TreeHouse listen: no analog Circle mix for ${childLineId}`);
    return;
  }
  const existing = treeHouseListenSessions.get(parentLineId);
  if (existing) {
    try {
      await existing.close(client);
    } catch {}
  }

  const listen = new CallSession(`th-listen-${parentLineId}`);
  listen.treeHouseListen = true;
  listen.fromLineId = parentLineId;
  listen.toLineId = childLineId;
  listen.ws = claim.ws;
  listen.callId = null;
  sessions.set(listen.channelId, listen);
  treeHouseListenSessions.set(parentLineId, listen);

  const pc = createPeerConnection(listen);
  const queuedIce = claim._listenIce || [];
  claim._listenIce = [];
  const remoteSdp = msg.sdp?.type ? msg.sdp : { type: "offer", sdp: msg.sdp };
  await pc.setRemoteDescription(remoteSdp);
  const sdpStr = String(remoteSdp.sdp || "");
  applyOutboundOpusFromSdp(listen, sdpStr);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceGathering(pc);
  const local = pc.localDescription;
  if (claim.ws?.readyState === WebSocket.OPEN) {
    claim.ws.send(
      JSON.stringify({
        type: "group.answer",
        roomId: msg.roomId,
        fromLineId: childLineId,
        toLineId: parentLineId,
        sdp: { type: local.type, sdp: local.sdp },
      })
    );
  }
  pc.onIceCandidate?.subscribe?.((candidate) => {
    if (!candidate || claim.ws?.readyState !== WebSocket.OPEN) return;
    claim.ws.send(
      JSON.stringify({
        type: "group.ice",
        roomId: msg.roomId,
        fromLineId: childLineId,
        toLineId: parentLineId,
        candidate: candidate.toJSON?.() || candidate,
      })
    );
  });
  for (const c of queuedIce) {
    try {
      await pc.addIceCandidate(c);
    } catch {}
  }
  await attachTreeHouseListenMedia(client, listen, leg.hearBridge);
  const childName = sanitizeAnnounceName(leg.session?.fromLabel || "Someone");
  void announceOnAnalogCircle(client, childLineId, `${childName}'s parent is listening`);
  console.log(
    `[bridged] TreeHouse listen media parent=${parentLineId} child=${childLineId} rtp=${listen.rtpPort} circle`
  );
}

function waitForSipLeg(channelId, timeoutMs = RING_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pendingSipLegs.delete(channelId);
      reject(new Error("No answer from ATA"));
    }, timeoutMs);
    pendingSipLegs.set(channelId, {
      resolve: (ch) => {
        clearTimeout(t);
        pendingSipLegs.delete(channelId);
        resolve(ch);
      },
      reject: (err) => {
        clearTimeout(t);
        pendingSipLegs.delete(channelId);
        reject(err);
      },
    });
  });
}

/** ARI callerId for INVITE to HT801: `"Name" <number>`. */
function formatSipCallerId(cidName, cidNumber) {
  const name = String(cidName || "PhoneHome")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "PhoneHome";
  const num = String(cidNumber || "0000").replace(/\D/g, "").slice(0, 16) || "0000";
  return `"${name}" <${num}>`;
}

/** Letters + spaces only — whole words for Flite TTS (never digit/symbol soup that sounds like spelling). */
function sanitizeAnnounceName(name) {
  return (
    String(name || "Someone")
      .replace(/[^a-zA-Z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40) || "Someone"
  );
}

/**
 * Play "{prefix} {name}" on an FXS channel via FreePBX Flite dialplan, then re-enter Stasis.
 * Prefer announceCallerInStasis for live calls — leaving Stasis for Flite can wedge remote SRTP.
 * @returns {Promise<object>} channel object from post-announce StasisStart (use this for bridging)
 */
async function announceOnFxs(channel, name, prefix = "Call from") {
  const text = sanitizeAnnounceName(name);
  const pref = String(prefix || "Call from").replace(/[^a-zA-Z\s]/g, " ").replace(/\s+/g, " ").trim() || "Call from";
  console.log(`[bridged] FXS announce (flite dialplan) "${pref} ${text}" ch=${channel.id}`);
  announceInProgress.add(channel.id);
  try {
    await channel.setChannelVar({ variable: "PH_ANNOUNCE_NAME", value: text });
    await channel.setChannelVar({ variable: "PH_ANNOUNCE_PREFIX", value: pref });
    const postChannel = await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pendingAnnounce.delete(channel.id);
        reject(new Error("announce timeout"));
      }, 25000);
      pendingAnnounce.set(channel.id, {
        resolve: (ch) => {
          clearTimeout(t);
          pendingAnnounce.delete(channel.id);
          resolve(ch || channel);
        },
        reject: (err) => {
          clearTimeout(t);
          pendingAnnounce.delete(channel.id);
          reject(err);
        },
      });
      channel
        .continueInDialplan({
          context: "phonehome-announce",
          extension: "s",
          priority: 1,
        })
        .catch((e) => {
          clearTimeout(t);
          pendingAnnounce.delete(channel.id);
          reject(e);
        });
    });
    return postChannel;
  } finally {
    announceInProgress.delete(channel.id);
  }
}

/**
 * Render a short telephony WAV with local Piper (no cloud). Used for Call-from screening
 * on handsets without CID displays — stays in Stasis so remote HT801 SRTP stays up.
 * @param {string} phrase
 * @returns {Promise<string>} path to 8 kHz mono PCM wav
 */
async function renderPiperTelephonyWav(phrase) {
  if (!fs.existsSync(PIPER_BIN) || !fs.existsSync(PIPER_MODEL)) {
    throw new Error(`piper missing (${PIPER_BIN} / ${PIPER_MODEL})`);
  }
  const id = randomBytes(6).toString("hex");
  const raw = path.join(os.tmpdir(), `ph-ann-raw-${id}.wav`);
  const out = path.join(os.tmpdir(), `ph-ann-${id}.wav`);
  await new Promise((resolve, reject) => {
    const child = spawn(PIPER_BIN, ["-m", PIPER_MODEL, "-f", raw], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exit ${code}: ${err.slice(0, 200)}`));
    });
    child.stdin.write(String(phrase || "Call"));
    child.stdin.end();
  });
  await execFileAsync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    raw,
    "-ac",
    "1",
    "-ar",
    "8000",
    "-c:a",
    "pcm_s16le",
    out,
  ]);
  try {
    fs.unlinkSync(raw);
  } catch {}
  return out;
}

/**
 * In-Stasis "Call from {name}" / "Calling {name}" — Piper WAV via ARI Playback.
 * Falls back to dialplan Flite only if Piper/ffmpeg is unavailable.
 * @param {{ skipAnswer?: boolean }} [opts] skip answer when FXS is already Up in a mix
 * @returns {Promise<object>} same channel (still in Stasis)
 */
async function announceCallerInStasis(channel, name, prefix = "Call from", opts = {}) {
  const text = sanitizeAnnounceName(name);
  const pref =
    String(prefix || "Call from")
      .replace(/[^a-zA-Z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Call from";
  const phrase = `${pref} ${text}`;
  console.log(`[bridged] FXS announce (in-Stasis) "${phrase}" ch=${channel.id}`);
  if (!opts.skipAnswer) {
    try {
      await channel.answer();
    } catch {}
  }
  let wav = null;
  try {
    wav = await renderPiperTelephonyWav(phrase);
    const url = registerMediaFile(wav, 90_000);
    await playMediaUri(channel, `sound:${url}`, 20000);
    return channel;
  } catch (e) {
    console.warn(`[bridged] in-Stasis announce failed (${e.message || e}); flite fallback`);
    return announceOnFxs(channel, name, prefix);
  } finally {
    if (wav) {
      try {
        fs.unlinkSync(wav);
      } catch {}
    }
  }
}

/** Inbound FXS screening whisper — keep call sites explicit. */
function announceCallerOnFxs(channel, name, opts) {
  return announceCallerInStasis(channel, name, "Call from", opts);
}

/**
 * Bridge announcer playback the handset hears. mediaMixLive must be off so the
 * softphone forwarder drops it. On softphone↔ATA legs this is end-of-call only:
 * before the mix it buzzed every call (see handleSoftphoneToAta). Do not
 * channel.play on the FXS leg — that freezes HT801 SDES.
 */
async function playBridgePhrase(bridge, phrase, timeoutMs = 8000) {
  if (!bridge) return "no-bridge";
  console.log(`[bridged] bridge prompt "${phrase}" bridge=${bridge.id}`);
  let wav = null;
  try {
    wav = await renderPiperTelephonyWav(phrase);
    const url = registerMediaFile(wav, 90_000);
    const playback = await bridge.play({ media: `sound:${url}` });
    return await playFinished(playback, timeoutMs);
  } catch (e) {
    console.warn(`[bridged] bridge prompt failed (${e.message || e})`);
    return "failed";
  } finally {
    if (wav) {
      try {
        fs.unlinkSync(wav);
      } catch {}
    }
  }
}

/** Handset-only "Call ended", then the caller BYEs. Not channel.play — that
 *  left HT801s off-hook with no dialtone until power-cycle. */
function sayCallEnded(session) {
  if (!session?.bridge || session._saidCallEnded || !session.callConnected) return Promise.resolve();
  session._saidCallEnded = true;
  session.mediaMixLive = false;
  session.sendPcmu = null;
  if (session._pcmuPacer) {
    clearInterval(session._pcmuPacer);
    session._pcmuPacer = null;
  }
  session._pcmuQueue = null;
  session._handsetPrompt = null;
  const pending = (async () => {
    const channels = [session.fxsChannel, session.destChannel].filter(Boolean);
    const seen = new Set();
    for (const ch of channels) {
      if (!ch.id || seen.has(ch.id)) continue;
      seen.add(ch.id);
      try {
        await ch.stopMoh();
      } catch {}
      try {
        await ch.unmute({ direction: "both" });
      } catch {}
    }
    const result = await playBridgePhrase(session.bridge, "Call ended", 8000);
    if (result !== "finished") {
      console.warn(`[bridged] Call ended playback ${result} call=${session.callId || "?"}`);
    }
  })();
  session._endPrompt = pending;
  return pending;
}

/** Outbound speed-dial / Home: confirm who we are about to ring. Never answer() here — FXS
 *  is off-hook before ExternalMedia exists; early answer wedges HT801 SDES (static + fxsIn=0). */
function announceDialingOnFxs(channel, name, opts = {}) {
  return announceCallerInStasis(channel, name, "Calling", { skipAnswer: true, ...opts });
}

function originateFxsPeer(client, session, sipExtension, callerId) {
  return originateFxsPeerWaitPickup({
    client,
    session,
    sipExtension,
    callerId,
    ariApp: ARI_APP,
    sipEndpoint,
    waitForSipLeg,
    ringTimeoutMs: RING_TIMEOUT_MS,
  });
}

/**
 * HT801 often rejects a new INVITE for ~1–2s after BYE (channel destroyed /
 * busy). Retry a few times so softphone→ATA redial does not instant-fail.
 */
async function originateSipWithRetry(client, session, sipExtension, callerId) {
  const attempts = 3;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (session.closed) throw lastErr || new Error("session closed");
    try {
      if (i > 0) {
        const waitMs = 1000 * i;
        console.log(
          `[bridged] originate retry ${i + 1}/${attempts} PJSIP/${sipExtension} in ${waitMs}ms`
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
      return await originateFxsPeer(client, session, sipExtension, callerId);
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      console.warn(`[bridged] originate attempt ${i + 1} failed:`, msg);
      if (session.destChannel) {
        try {
          await session.destChannel.hangup();
        } catch {}
        session.destChannel = null;
      }
      if (!/destroyed|hung up before answer|busy|unavailable|congest/i.test(msg)) {
        throw e;
      }
    }
  }
  throw lastErr || new Error("ATA originate failed");
}

/**
 * Analog pad 0 → TreeHouse: presence join + Circle-filtered Asterisk hearing.
 * Softphones keep WebRTC mesh; FXS legs use per-child hear-bridges + snoops so
 * kids only hear Circle peers (siblings / mutual allowlist / shared sphere).
 */
async function startTreeHouseAta(client, session, channel, resolved) {
  session.fromLineId = resolved.fromLineId;
  session.treeHouse = true;
  session.householdId = resolved.householdId;
  session.fromLabel = resolved.fromLabel;
  const lineId = resolved.fromLineId;
  const sipExtension = String(resolved.fromSipExtension || "").replace(/\D/g, "");
  if (lineId && sipExtension) {
    try {
      await ensureInboundClaim(lineId, sipExtension);
    } catch (e) {
      console.warn(`[bridged] TreeHouse inbound claim skipped:`, e.message || e);
    }
  }

  const hearBridge = await client.bridges.create({
    type: "mixing",
    name: `ph-treehouse-circle-${lineId}`,
  });
  session.bridge = hearBridge;
  const leg = {
    session,
    channel,
    hearBridge,
    snoops: new Map(),
  };
  treeHouseAtaLegs.set(lineId, leg);

  const joined = await phFetch("/api/bridge/treehouse/join", {
    method: "POST",
    body: JSON.stringify({ lineId }),
  });
  const analogTalkPeers = Array.isArray(joined.analogTalkPeers)
    ? joined.analogTalkPeers
    : [];
  console.log(
    `[bridged] TreeHouse join ${resolved.fromLabel} room=${joined.roomId} members=${
      (joined.members || []).length
    } analogPeers=${analogTalkPeers.length}`
  );

  try {
    await channel.answer();
  } catch {}

  try {
    await sayIvrText(channel, "Welcome to the TreeHouse");
  } catch (e) {
    console.warn(`[bridged] TreeHouse welcome skipped:`, e.message || e);
  }

  await hearBridge.addChannel({ channel: channel.id });

  const toLink = analogEdgesToLink(lineId, analogTalkPeers, treeHouseAtaLegs.keys());
  for (const peerId of toLink) {
    await linkAnalogTalkEdge(client, lineId, peerId);
  }

  // Stay until the handset hangs up. Do not watch StasisEnd — Flite fallback
  // still leaves Stasis briefly (ivrSayInProgress) and would end TreeHouse early.
  // Piper welcome stays in Stasis and is safe either way.
  await new Promise((resolve) => {
    const onEnd = () => {
      channel.removeListener("ChannelDestroyed", onEnd);
      channel.removeListener("ChannelHangupRequest", onEnd);
      resolve();
    };
    channel.on("ChannelDestroyed", onEnd);
    channel.on("ChannelHangupRequest", onEnd);
  });
}

async function leaveTreeHouseAta(session) {
  const lineId = session?.fromLineId;
  for (const [parentId, listen] of [...treeHouseListenSessions.entries()]) {
    if (listen.toLineId === lineId) {
      try {
        await listen.close(ariClient);
      } catch {}
      treeHouseListenSessions.delete(parentId);
    }
  }

  if (lineId && treeHouseAtaLegs.has(lineId)) {
    const leg = treeHouseAtaLegs.get(lineId);
    const peerIds = [...leg.snoops.keys()];
    for (const peerId of peerIds) {
      await unlinkAnalogTalkEdge(lineId, peerId);
    }
    try {
      await leg.hearBridge.removeChannel({ channel: session.channelId });
    } catch {}
    try {
      await leg.hearBridge.destroy();
    } catch {}
    treeHouseAtaLegs.delete(lineId);
  }

  if (lineId) {
    try {
      await phFetch("/api/bridge/treehouse/leave", {
        method: "POST",
        body: JSON.stringify({ lineId }),
      });
    } catch (e) {
      console.warn(`[bridged] TreeHouse leave:`, e.message || e);
    }
  }
}

/** ATA → ATA: SIP↔SIP via Asterisk bridge (no softphone). */
async function startAtaToAta(client, session, channel, resolved) {
  session.fromLineId = resolved.fromLineId;
  session.toLineId = resolved.toLineId;
  session.ataToAta = true;
  // "Calling {Name}" already finished in onStasisStart, before this ring.
  try {
    await channel.ring();
  } catch {}

  const bridge = await createOneToOneBridge(client, `ph-ata-${session.channelId}`);
  session.bridge = bridge;

  // Caller FXS — needed for hold peer lookup when callee is the one who holds.
  session.fxsChannel = channel;

  const cidName = resolved.cidName || resolved.fromLabel || "PhoneHome";
  const cidNumber = resolved.cidNumber || channel.caller?.number || "2000";
  const callerId = formatSipCallerId(cidName, cidNumber);
  const dest = await originateFxsPeer(client, session, resolved.toSipExtension, callerId);
  session.destChannel = dest;
  session.bindChannel(channel);
  session.bindChannel(dest);
  await addLegsToBridge(bridge, [channel.id, dest.id]);
  await answerChannelsAfterBridgeJoin([channel, dest]);
  session.callConnected = true;
  try {
    await announceCallerOnFxs(dest, cidName, { skipAnswer: true });
  } catch (e) {
    console.warn(`[bridged] ATA↔ATA announce skipped:`, e.message || e);
  }
  await phFetch(`/api/bridge/calls/${encodeURIComponent(session.callId)}/event`, {
    method: "POST",
    body: JSON.stringify({
      type: "connected",
      actorLineId: session.toLineId,
      idempotencyKey: `ari-connected:${session.channelId}`,
    }),
  });
  console.log(
    `[bridged] ATA↔ATA up ${resolved.fromLabel} → ${resolved.toLabel} ext=${resolved.toSipExtension} cid=${callerId}`
  );
  startAtaMediaDiagnostics(session);
  void logAtaRtpAddresses(session, channel, "ATA↔ATA caller").catch(() => {});
  void logAtaRtpAddresses(session, dest, "ATA↔ATA callee").catch(() => {});
}

/**
 * Analog # during an active call: toggle hold.
 * Holder (FXS) is muted both ways; the other leg hears Asterisk MOH.
 * Softphone UI gets call.hold when a WebRTC leg is in the session.
 */
function holdPeerChannel(session, holderChannel) {
  if (session.extChannel && session.extChannel.id !== holderChannel?.id) return session.extChannel;
  if (session.destChannel && session.destChannel.id !== holderChannel?.id) return session.destChannel;
  // ATA→softphone: primary channel is FXS; peer is ExternalMedia
  if (session.channelId && holderChannel?.id === session.channelId && session.extChannel) {
    return session.extChannel;
  }
  // ATA→ATA: callee holds — caller FXS is the peer
  if (session.fxsChannel && session.fxsChannel.id !== holderChannel?.id) return session.fxsChannel;
  return null;
}

function isWebRtcPeer(session, peer) {
  return Boolean(session.extChannel && peer?.id === session.extChannel.id);
}

/** Asterisk MOH on ExternalMedia is unreliable — softphone plays local MOH via call.hold. */
async function startPeerMoh(session, peer) {
  if (!peer || isWebRtcPeer(session, peer)) return;
  try {
    await peer.startMoh({ mohClass: "default" });
  } catch (e) {
    try {
      await peer.startMoh();
    } catch (e2) {
      console.warn(`[bridged] hold MOH failed:`, e2.message || e2);
    }
  }
}

async function stopPeerMoh(_session, peer) {
  if (!peer) return;
  try {
    await peer.stopMoh();
  } catch (e) {
    console.warn(`[bridged] stop MOH failed:`, e.message || e);
  }
}

function notifySoftphoneHold(session, onHold, byLineId) {
  const payload = {
    type: "call.hold",
    callId: session.callId,
    fromLineId: session.fromLineId,
    toLineId: session.toLineId,
    onHold: Boolean(onHold),
  };
  if (byLineId) payload.byLineId = byLineId;
  const body = JSON.stringify(payload);
  try {
    if (session.ws?.readyState === WebSocket.OPEN) {
      session.ws.send(body);
      console.log(
        `[bridged] call.hold ${onHold ? "ON" : "OFF"} call=${session.callId || "?"} by=${byLineId || "?"}`
      );
    } else {
      console.warn(
        `[bridged] call.hold ${onHold ? "ON" : "OFF"} dropped — WS not open call=${session.callId || "?"}`
      );
    }
  } catch (e) {
    console.warn(`[bridged] call.hold send failed:`, e.message || e);
  }
}

/**
 * Softphone Hold/Resume — play Asterisk MOH on the FXS (analog) leg.
 * Softphone mutes its mic locally; Cap/WKWebView WebRTC MOH is often silent.
 * Does not mute the FXS handset (unlike # hold where the analog is the holder).
 * Resume also clears FXS # hold so a parent can override a kid's analog hold.
 */
async function applySoftphoneHold(session, onHold) {
  if (!session || session.closed) return;
  const want = Boolean(onHold);
  if (session.onHold === want) return;
  const fxs = session.fxsChannel || session.destChannel;
  if (!fxs) {
    console.warn(
      `[bridged] softphone hold ignored — no FXS channel call=${session.callId || "?"}`
    );
    return;
  }
  session.onHold = want;
  console.log(
    `[bridged] softphone hold ${want ? "ON" : "OFF"} call=${session.callId || "?"} fxs=${fxs.id}`
  );
  if (want) {
    try {
      await fxs.startMoh({ mohClass: "default" });
    } catch (e) {
      try {
        await fxs.startMoh();
      } catch (e2) {
        console.warn(`[bridged] softphone hold MOH failed:`, e2.message || e2);
      }
    }
  } else {
    try {
      await fxs.stopMoh();
    } catch (e) {
      console.warn(`[bridged] softphone unhold stopMoh failed:`, e.message || e);
    }
    // Also undo FXS # hold (muted handset + MOH on peer) for adult override.
    try {
      await fxs.unmute({ direction: "both" });
    } catch (e) {
      console.warn(`[bridged] softphone unhold unmute failed:`, e.message || e);
    }
    await stopPeerMoh(session, holdPeerChannel(session, fxs));
  }
}

async function toggleFxsHold(session, holderChannel) {
  if (session.closed || !holderChannel) return;
  if (!session.bridge && !session.extChannel && !session.destChannel) return;

  session.onHold = !session.onHold;
  const peer = holdPeerChannel(session, holderChannel);
  console.log(
    `[bridged] FXS hold ${session.onHold ? "ON" : "OFF"} ch=${holderChannel.id} peer=${peer?.id || "none"}`
  );

  if (session.onHold) {
    try {
      await holderChannel.mute({ direction: "both" });
    } catch (e) {
      console.warn(`[bridged] hold mute failed:`, e.message || e);
    }
    await startPeerMoh(session, peer);
  } else {
    try {
      await holderChannel.unmute({ direction: "both" });
    } catch (e) {
      console.warn(`[bridged] unhold unmute failed:`, e.message || e);
    }
    await stopPeerMoh(session, peer);
  }
  // Softphone attributes hold to the ATA line (peer of the softphone).
  const ataLineId =
    session.destChannel && holderChannel.id === session.destChannel.id
      ? session.toLineId
      : session.fromLineId;
  if (session.ataToAta && session.callId && ataLineId) {
    try {
      await phFetch(`/api/bridge/calls/${encodeURIComponent(session.callId)}/event`, {
        method: "POST",
        body: JSON.stringify({
          type: "hold",
          actorLineId: ataLineId,
          onHold: session.onHold,
          idempotencyKey: `ari-hold:${holderChannel.id}:${session.onHold ? "on" : "off"}`,
        }),
      });
    } catch (e) {
      console.warn(`[bridged] ATA lifecycle hold failed call=${session.callId}:`, e.message || e);
    }
  }
  notifySoftphoneHold(session, session.onHold, ataLineId || undefined);
}

async function onFxsDtmf(event, channel) {
  const digit = String(event?.digit || "");
  const session = sessions.get(channel.id);
  // Log every DTMF before filters — if `#` never appears here, the ATA is not
  // sending RFC2833 (re-provision P850/P4825) or Asterisk is not decoding it.
  if (digit) {
    console.log(
      `[bridged] ChannelDtmf digit=${JSON.stringify(digit)} ch=${channel.id}` +
        ` name=${channel.name || "?"} session=${session && !session.closed ? "yes" : "no"}`
    );
  }
  if (!session || session.closed) return;
  // Only the analog handset(s) — not ExternalMedia — may toggle hold.
  const isFxs =
    channel.id === session.channelId ||
    channel.id === session.destChannel?.id ||
    channel.id === session.fxsChannel?.id;
  if (!isFxs) {
    console.log(`[bridged] DTMF ignored (not FXS leg) ch=${channel.id}`);
    return;
  }
  if (digit !== "#") return;
  if (session._holdDtmfAt && Date.now() - session._holdDtmfAt < 400) return;
  session._holdDtmfAt = Date.now();
  console.log(`[bridged] FXS # hold toggle ch=${channel.id}`);
  try {
    await toggleFxsHold(session, channel);
  } catch (e) {
    console.error(`[bridged] hold toggle failed:`, e.message || e);
  }
}

/**
 * HT801 hold via SIP re-INVITE (a=sendonly / a=inactive) or hook flash.
 * Asterisk fires ChannelHold / ChannelUnhold. SIP-only mute is not enough for
 * WebRTC peers — also mute the FXS leg and let the softphone play local MOH.
 */
async function onFxsSipHold(channel, isHold) {
  const session = sessions.get(channel.id);
  if (!session || session.closed) return;
  const isFxs =
    channel.id === session.channelId ||
    channel.id === session.destChannel?.id ||
    channel.id === session.fxsChannel?.id;
  if (!isFxs) return;
  if (session.onHold === Boolean(isHold)) return; // already correct state
  session.onHold = Boolean(isHold);
  const peer = holdPeerChannel(session, channel);
  const webRtcPeer = isWebRtcPeer(session, peer);
  console.log(
    `[bridged] FXS SIP hold ${isHold ? "ON" : "OFF"} ch=${channel.id} peer=${peer?.id || "none"} webrtc=${webRtcPeer}`
  );
  if (isHold) {
    if (webRtcPeer) {
      try {
        await channel.mute({ direction: "both" });
      } catch (e) {
        console.warn(`[bridged] SIP hold mute failed:`, e.message || e);
      }
    }
    await startPeerMoh(session, peer);
  } else {
    if (webRtcPeer) {
      try {
        await channel.unmute({ direction: "both" });
      } catch (e) {
        console.warn(`[bridged] SIP unhold unmute failed:`, e.message || e);
      }
    }
    await stopPeerMoh(session, peer);
  }
  const ataLineId =
    session.destChannel && channel.id === session.destChannel.id
      ? session.toLineId
      : session.fromLineId;
  notifySoftphoneHold(session, session.onHold, ataLineId || undefined);
}

const handsetPromptCache = new Map();

/** Render "Call from {name}" while the handset rings; null when off for this line. */
function prepareHandsetCallerPrompt(extension, name) {
  if (!name || !handsetPromptEnabled(HANDSET_CALLER_ANNOUNCE, extension)) return null;
  const phrase = `Call from ${sanitizeAnnounceName(name)}`;
  let pending = handsetPromptCache.get(phrase);
  if (!pending) {
    pending = renderHandsetPromptFrames(phrase);
    handsetPromptCache.set(phrase, pending);
    if (handsetPromptCache.size > 32) {
      handsetPromptCache.delete(handsetPromptCache.keys().next().value);
    }
    pending.catch(() => handsetPromptCache.delete(phrase));
  }
  return pending.catch((e) => {
    console.warn(`[bridged] handset caller prompt render failed: ${e.message || e}`);
    return null;
  });
}

async function renderHandsetPromptFrames(phrase) {
  const wav = await renderPiperTelephonyWav(phrase);
  try {
    const pcm = wavPcm16(fs.readFileSync(wav));
    if (!pcm) throw new Error("Piper WAV is not 8 kHz mono 16-bit");
    const frames = handsetPromptFrames(pcm, pcm16ToUlaw);
    if (!frames.length) throw new Error("Piper rendered silence");
    return frames;
  } finally {
    try {
      fs.unlinkSync(wav);
    } catch {}
  }
}

/**
 * Softphone→ATA "Call from {name}" on the handset: caller PCMU through the
 * pacer after the mix is armed (handsetPrompt.mjs). Never Asterisk playback.
 */
async function startHandsetCallerPrompt(session, pending) {
  if (!pending) return;
  const frames = await Promise.race([
    pending,
    new Promise((resolve) => setTimeout(resolve, HANDSET_PROMPT_WAIT_MS, null)),
  ]);
  const call = session.callId || "?";
  if (!frames || !session.sendHandsetPrompt?.(frames)) {
    console.log(
      `[bridged] handset caller prompt skipped call=${call} rendered=${frames ? "yes" : "no"}`
    );
    return;
  }
  console.log(`[bridged] handset caller prompt call=${call} frames=${frames.length}`);
}

/** Softphone → ATA: answer WebRTC early (ICE), then ring FXS + ExternalMedia. */
async function handleSoftphoneToAta(client, claim, msg) {
  const callId = msg.callId || claim.callId;
  const fromLineId = msg.fromLineId;
  const toLineId = msg.toLineId || claim.lineId;
  const sipExtension = claim.sipExtension;
  console.log(`[bridged] softphone→ATA offer call=${callId} → PJSIP/${sipExtension}`);

  const session = new CallSession(`in-${callId || Date.now()}`);
  session.callId = callId;
  session.fromLineId = fromLineId;
  session.toLineId = toLineId;
  session.ws = claim.ws;
  sessions.set(session.channelId, session);
  claim.session = session;

  try {
    let cidName = "PhoneHome";
    let cidNumber = softphoneCidFallback(fromLineId);
    let callerName = null;
    try {
      const route = await phFetch("/api/bridge/route", {
        method: "POST",
        body: JSON.stringify({ fromLineId, toLineId }),
      });
      if (route?.cidName) {
        cidName = route.cidName;
        callerName = route.cidName;
      }
      if (route?.cidNumber) cidNumber = route.cidNumber;
    } catch (e) {
      console.warn(`[bridged] route CID lookup failed:`, e.message || e);
    }
    const callerId = formatSipCallerId(cidName, cidNumber);
    const handsetPrompt = prepareHandsetCallerPrompt(sipExtension, callerName);

    const pc = createPeerConnection(session);
    const remoteSdp = msg.sdp?.type ? msg.sdp : { type: "offer", sdp: msg.sdp };
    await pc.setRemoteDescription(remoteSdp);
    // Trickle that arrived before PC existed (claim WS is up before offer handler runs).
    const buffered = claim._pendingIce || [];
    claim._pendingIce = [];
    for (const cand of buffered) {
      try {
        await pc.addIceCandidate(cand);
      } catch {}
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    const sdpStr = String(remoteSdp.sdp || "");
    // Softphone offered stereo — match PT + stereo encode so Android hears FXS.
    applyOutboundOpusFromSdp(session, sdpStr);
    setOpusDecoderChannels(session, opusChannelsFromSdp(sdpStr));

    pc.onIceCandidate?.subscribe?.((candidate) => {
      if (!candidate || claim.ws.readyState !== WebSocket.OPEN) return;
      claim.ws.send(
        JSON.stringify({
          type: "call.ice",
          callId,
          fromLineId,
          toLineId,
          candidate: candidate.toJSON?.() || candidate,
        })
      );
    });

    // Ring FXS immediately — do not wait on ICE gather first (that delayed the
    // landline ~8s while Grandma heard endless softphone ringback).
    const destPromise = originateSipWithRetry(client, session, sipExtension, callerId);
    // Open UnicastRTP ExternalMedia WHILE the handset rings. Pickup must only
    // atomically join FXS+ExternalMedia — creating media only after answer left
    // the HT801 Up with no mix peer, and chan_websocket uplink died at ~25 RTP
    // packets (call_yQ83rk8e45 / call_FqkVTQWrZ6). Do not bridge or arm sendPcmu
    // until join (unbridged injection aged the RTP path — call_POrefnnuZq).
    const mediaPrep = attachExternalMedia(client, session, null);
    // Early WebRTC answer so remote ICE/TURN can connect while the handset rings.
    // Full gather in parallel; send answer after a short window so we include
    // relay candidates without blocking FXS ring.
    await waitIceGathering(pc, Math.min(ICE_GATHER_MS, 2500));
    const local = pc.localDescription;
    if (claim.ws.readyState === WebSocket.OPEN) {
      claim.ws.send(
        JSON.stringify({
          type: "call.answer",
          callId,
          fromLineId,
          toLineId,
          early: true,
          sdp: { type: local.type, sdp: local.sdp },
        })
      );
      claim.ws.send(
        JSON.stringify({
          type: "call.ringing",
          callId,
          fromLineId,
          toLineId,
        })
      );
    }
    console.log(`[bridged] softphone→ATA early WebRTC answer call=${callId} (FXS ringing)`);

    const dest = await destPromise;
    session.destChannel = dest;
    session.fxsChannel = dest;
    await mediaPrep;
    await attachExternalMedia(client, session, dest, { armSend: false });
    await answerChannelsAfterBridgeJoin([dest]);
    session.callConnected = true;
    // No FXS or bridge playback on this leg. In-bridge Piper wedges HT801 SDES
    // (call_OaE7LGS-b6) and leaves a continuous full-scale buzz on the handset
    // uplink (call_u33f8zIAcP: 23894 of 23914 frames active). The handset hears
    // "Call from {name}" as caller PCMU through the pacer once the mix is armed.
    armExternalMediaMix(session);
    void startHandsetCallerPrompt(session, handsetPrompt);
    startMediaDiagnostics(session);
    void logAtaRtpAddresses(session, dest, "softphone→ATA").catch(() => {});
    if (claim.ws.readyState === WebSocket.OPEN) {
      claim.ws.send(
        JSON.stringify({
          type: "call.fxs-up",
          callId,
          fromLineId,
          toLineId,
        })
      );
    }
    console.log(
      `[bridged] softphone→ATA media up call=${callId} transport=${session.externalMediaTransport} ext=${sipExtension} cid=${callerId}`
    );
    // Directional watchdog: ICE alone is not audio evidence. Report both sides
    // so a live call proves browser→Asterisk and Asterisk→browser packet flow.
    setTimeout(() => {
      if (session.closed) return;
      if (!session._fxsRtpIn || !session._webrtcRtpIn || !session._sipRtpOut) {
        console.warn(
          `[bridged] softphone→ATA RTP incomplete after 2s call=${callId} ext=${sipExtension} webrtcIn=${
            session._webrtcRtpIn || 0
          } sipOut=${session._sipRtpOut || 0} fxsIn=${session._fxsRtpIn || 0} transport=${
            session.externalMediaTransport
          }`
        );
      }
    }, 2000);
  } catch (e) {
    console.error(`[bridged] softphone→ATA failed:`, e.message || e);
    markSipUnreachable(sipExtension, e.message || e);
    const failReason = String(e.message || "ata-failed").slice(0, 80);
    try {
      if (claim.ws?.readyState === WebSocket.OPEN) {
        session.hangupNotified = true;
        session.hangupReason = failReason;
        claim.ws.send(
          JSON.stringify({
            type: "call.hangup",
            callId,
            fromLineId,
            toLineId,
            reason: failReason,
          })
        );
      }
    } catch {}
    await session.close(client);
  }
}

/** Match server softphoneCidNumber when /route is unavailable. */
function softphoneCidFallback(lineId) {
  let h = 2166136261;
  const s = String(lineId || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(1000 + ((h >>> 0) % 9000));
}

/** Drop a leftover FXS claim so a softphone can own the line again. */
async function dropInboundClaim(lineId) {
  const claim = inboundClaims.get(lineId);
  if (!claim) return;
  inboundClaims.delete(lineId);
  try {
    await claim.session?.close(ariClient);
  } catch {}
  try {
    claim.ws?.close();
  } catch {}
}

/**
 * Keep a WS registration as the target line so PhoneHome can forward call.offer here.
 * Prefer FXS: claiming kicks any softphone already on that line.
 */
async function ensureInboundClaim(lineId, sipExtension, callId) {
  let claim = inboundClaims.get(lineId);
  if (claim?.ws?.readyState === WebSocket.OPEN) {
    claim.sipExtension = sipExtension;
    claim.callId = callId || claim.callId;
    return claim;
  }

  if (claim?.ws) {
    try {
      claim.ws.close();
    } catch {}
  }

  const { sessionId } = await phFetch("/api/bridge/session", {
    method: "POST",
    body: JSON.stringify({ lineId }),
  });

  const ws = new WebSocket(PH_WS);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "hello", sessionId, lineId }));

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("WS welcome timeout")), 8000);
    const onMsg = (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve();
      }
      if (msg.type === "error") {
        clearTimeout(t);
        ws.off("message", onMsg);
        reject(new Error(msg.error || "ws error"));
      }
    };
    ws.on("message", onMsg);
  });

  claim = { lineId, sipExtension, callId, ws, session: null };
  inboundClaims.set(lineId, claim);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "session.replaced") {
      console.log(`[bridged] inbound claim replaced for ${lineId}`);
      inboundClaims.delete(lineId);
      return;
    }
    if (msg.type === "call.offer") {
      if (!ariClient) {
        console.error("[bridged] ARI not ready for softphone→ATA");
        return;
      }
      handleSoftphoneToAta(ariClient, claim, msg).catch((e) =>
        console.error("[bridged] inbound handler", e)
      );
      return;
    }
    if (msg.type === "group.offer") {
      if (!ariClient) {
        console.error("[bridged] ARI not ready for TreeHouse listen");
        return;
      }
      handleTreeHouseListenOffer(ariClient, claim, msg).catch((e) =>
        console.error("[bridged] TreeHouse listen offer", e.message || e)
      );
      return;
    }
    if (msg.type === "group.ice") {
      const listen = treeHouseListenSessions.get(msg.fromLineId);
      if (listen?.pc && msg.candidate) {
        listen.pc.addIceCandidate(msg.candidate).catch(() => {});
      } else if (msg.candidate) {
        claim._listenIce = claim._listenIce || [];
        claim._listenIce.push(msg.candidate);
      }
      return;
    }
    if (msg.type === "group.peer-left" && msg.listener) {
      const parentId = String(msg.lineId || "");
      const listen = treeHouseListenSessions.get(parentId);
      if (listen) {
        listen.close(ariClient).catch(() => {});
      }
      return;
    }
    if (msg.type === "call.ice" && msg.candidate) {
      if (claim.session?.pc) {
        claim.session.pc.addIceCandidate(msg.candidate).catch(() => {});
      } else {
        claim._pendingIce = claim._pendingIce || [];
        claim._pendingIce.push(msg.candidate);
      }
      return;
    }
    if (msg.type === "call.hold" && claim.session) {
      if (msg.callId && claim.session.callId && msg.callId !== claim.session.callId) return;
      void applySoftphoneHold(claim.session, msg.onHold).catch((e) =>
        console.warn(`[bridged] softphone hold (soft→ATA) failed:`, e.message || e)
      );
      return;
    }
    if (msg.type === "call.hangup" && claim.session) {
      const s = claim.session;
      claim.session = null;
      // Soft→ATA: destChannel is the FXS. endAtaCallFromSoftphoneHangup says
      // "Call ended" on the bridge, then BYE.
      if (s.destChannel && !s.fxsChannel) {
        s.fxsChannel = s.destChannel;
      }
      void endAtaCallFromSoftphoneHangup(s, "softphone-hangup").catch((e) =>
        console.error(`[bridged] hangup cleanup failed:`, e.message || e)
      );
    }
  });

  ws.on("close", () => {
    if (inboundClaims.get(lineId)?.ws === ws) inboundClaims.delete(lineId);
  });

  console.log(`[bridged] claimed line ${lineId} for FXS ${sipExtension}`);
  return claim;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function bridgeAuthOk(req) {
  const hdr = String(req.headers.authorization || "");
  const bearer = hdr.toLowerCase().startsWith("bearer ") ? hdr.slice(7).trim() : "";
  const alt = String(req.headers["x-bridge-secret"] || "");
  return bearer === BRIDGE_SECRET || alt === BRIDGE_SECRET;
}

/**
 * @typedef {Object} SipStatus
 * @property {boolean} ok        check completed without an error
 * @property {boolean} registered evidence of a usable Contact — drives the parent chip
 * @property {boolean} callable   worth attempting an originate — drives /claim
 * @property {"online"|"offline"|"unknown"} state
 * @property {"high"|"low"|"none"} confidence
 * @property {string} method     where the answer came from
 * @property {number|null} contacts usable contact count when known
 * @property {string} extension
 * @property {string} [reason]
 */

/**
 * PJSIP registration for the parent UI.
 *
 * `registered` must mean "we saw a usable Contact", never "ARI didn't object".
 * ARI cannot list contacts, and with `qualify_frequency=0` Asterisk calls an
 * endpoint "online" even when the AOR is empty — that is how a fail2ban ban of
 * the SIP TLS proxy stayed invisible while the app said the adapter was working.
 * So AMI contact detail wins when configured, ARI state is a labelled fallback,
 * and anything inconclusive reports unknown rather than a guess.
 *
 * `callable` stays separate so an unverifiable check degrades the status chip
 * without blocking calls that would otherwise connect.
 * @param {string} ext
 * @returns {Promise<SipStatus>}
 */
async function sipRegistrationStatus(ext) {
  const extension = String(ext || "").replace(/\D/g, "");
  const base = {
    ok: false,
    registered: false,
    callable: false,
    state: "unknown",
    confidence: "none",
    method: "none",
    contacts: null,
    extension,
  };
  if (!extension) return { ...base, reason: "extension required" };

  const until = sipUnreachableUntil.get(extension) || 0;
  if (until > Date.now()) {
    return {
      ...base,
      ok: true,
      state: "offline",
      confidence: "high",
      method: "originate-failure",
      reason: "contact unreachable (recent call failure)",
    };
  }
  if (until) sipUnreachableUntil.delete(extension);

  if (!ariClient) return { ...base, reason: "ARI not connected" };

  let ariState = "unknown";
  try {
    const ep = await ariClient.endpoints.get({ tech: SIP_ENDPOINT_PREFIX, resource: extension });
    ariState = String(ep?.state || "unknown").toLowerCase();
  } catch (e) {
    const msg = e?.message || String(e);
    // Missing endpoint is a real answer: FreePBX has no such extension.
    if (/not found|404/i.test(msg)) {
      return {
        ...base,
        ok: true,
        state: "offline",
        confidence: "high",
        method: "ari-endpoint-state",
        reason: "no such PJSIP endpoint",
      };
    }
    return { ...base, method: "ari-endpoint-state", reason: msg };
  }

  if (amiConfig) {
    try {
      const evidence = await fetchAmiContactEvidence({
        host: AMI_HOST,
        port: amiConfig.port,
        username: amiConfig.username,
        password: amiConfig.password,
        timeoutMs: amiConfig.timeoutMs,
        extension,
      });
      const registered = evidence.usable > 0;
      return {
        ...base,
        ok: true,
        registered,
        callable: registered,
        state: registered ? "online" : "offline",
        confidence: "high",
        method: "ami-contacts",
        contacts: evidence.usable,
        reason: registered
          ? undefined
          : evidence.total
            ? "contact registered but unreachable"
            : "no contact registered",
      };
    } catch (e) {
      // Inconclusive: say so, but let a call still try the FXS.
      return {
        ...base,
        callable: ariState === "online",
        method: "ami-contacts",
        reason: `contact check failed: ${e?.message || e}`,
      };
    }
  }

  if (ariState === "online") {
    return {
      ...base,
      ok: true,
      registered: true,
      callable: true,
      state: "online",
      confidence: "low",
      method: "ari-endpoint-state",
      reason: "endpoint state only — no contact detail (needs AMI, and qualify on the AOR)",
    };
  }
  if (ariState === "offline") {
    return {
      ...base,
      ok: true,
      state: "offline",
      confidence: "high",
      method: "ari-endpoint-state",
      reason: "no available contact",
    };
  }
  return {
    ...base,
    ok: true,
    method: "ari-endpoint-state",
    reason: `endpoint state ${ariState}`,
  };
}

function markSipUnreachable(extension, errMsg) {
  const ext = String(extension || "").replace(/\D/g, "");
  if (!ext) return;
  if (!/Allocation failed|invalid URI|not registered|unreachable|offline/i.test(String(errMsg || ""))) {
    return;
  }
  sipUnreachableUntil.set(ext, Date.now() + SIP_UNREACHABLE_TTL_MS);
  console.warn(`[bridged] marking PJSIP/${ext} unreachable for ${SIP_UNREACHABLE_TTL_MS / 1000}s`);
}

function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${BRIDGE_HTTP_PORT}`);

    // Asterisk Playback downloads greeting/VM wavs during *98 (no auth header).
    if (req.method === "GET" && url.pathname.startsWith("/media/")) {
      const token = url.pathname
        .slice("/media/".length)
        .replace(/\.wav$/i, "")
        .replace(/[^a-f0-9]/gi, "");
      const entry = mediaTokens.get(token);
      if (!entry || entry.expires < Date.now() || !fs.existsSync(entry.filePath)) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "no-store");
      fs.createReadStream(entry.filePath).pipe(res);
      return;
    }

    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && url.pathname === "/health") {
      res.end(
        JSON.stringify({
          ok: true,
          ari: Boolean(ariClient),
          claims: inboundClaims.size,
          contact_check: amiConfig ? "ami" : "ari-state",
        })
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/sip-status") {
      if (!bridgeAuthOk(req)) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const ext = url.searchParams.get("ext") || url.searchParams.get("extension") || "";
      const status = await sipRegistrationStatus(ext);
      res.statusCode = status.ok ? 200 : 503;
      res.end(JSON.stringify(status));
      return;
    }

    if (req.method === "POST" && url.pathname === "/claim") {
      if (!bridgeAuthOk(req)) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      try {
        const body = await readJsonBody(req);
        const lineId = String(body.lineId || "");
        const sipExtension = String(body.sipExtension || "").replace(/\D/g, "");
        const callId = String(body.callId || "");
        if (!lineId || !sipExtension) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "lineId and sipExtension required" }));
          return;
        }
        // Gate on `callable`, not `registered`: refusing a call because the
        // registration could not be *verified* would be worse than trying.
        const sip = await sipRegistrationStatus(sipExtension);
        if (!sip.callable) {
          await dropInboundClaim(lineId);
          res.statusCode = 409;
          res.end(
            JSON.stringify({
              error: "ata-offline",
              reason: sip.reason || "HT801 is not registered",
              state: sip.state,
              confidence: sip.confidence,
            })
          );
          return;
        }
        await ensureInboundClaim(lineId, sipExtension, callId);
        res.end(JSON.stringify({ ok: true, lineId, sipExtension }));
      } catch (e) {
        console.error("[bridged] /claim failed:", e.message || e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message || "claim failed" }));
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/release") {
      if (!bridgeAuthOk(req)) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      try {
        const body = await readJsonBody(req);
        const lineId = String(body.lineId || "");
        if (!lineId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "lineId required" }));
          return;
        }
        await dropInboundClaim(lineId);
        res.end(JSON.stringify({ ok: true, lineId }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message || "release failed" }));
      }
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(BRIDGE_HTTP_PORT, BRIDGE_HTTP_BIND, () => {
    console.log(
      `[bridged] HTTP on ${BRIDGE_HTTP_BIND}:${BRIDGE_HTTP_PORT} (media ${MEDIA_BASE_URL})`
    );
    console.log(
      `[bridged] WebRTC ICE: ${ICE_SERVERS.length} server group(s), TURN=${HAS_TURN ? "yes" : "NO (remote softphones will be silent)"} gather=${ICE_GATHER_MS}ms`
    );
  });
  return server;
}

/** Prefer SIP CallerID digits; fall back to PJSIP/<ext>-… channel name (empty CID). */
function callerExtensionFromChannel(channel) {
  const fromCid = String(channel?.caller?.number || channel?.caller?.name || "").replace(/\D/g, "");
  if (fromCid) return fromCid;
  const name = String(channel?.name || "");
  const m = name.match(/^PJSIP\/(\d+)/i);
  return m ? m[1] : "";
}

async function onStasisStart(client, event, channel) {
  const rawArg = String((event.args && event.args[0]) || "");
  const caller = callerExtensionFromChannel(channel);
  console.log(`[bridged] StasisStart ch=${channel.id} caller=${caller} arg=${rawArg} name=${channel.name || ""}`);

  // *98 Messages / greeting IVR (do not strip letters — "vm" is intentional)
  if (rawArg === "th-announce" || rawArg === "th-snoop" || rawArg === "fxs-whisper") {
    console.log(`[bridged] TreeHouse helper ch=${channel.id} arg=${rawArg}`);
    return;
  }

  if (rawArg === "vm" || rawArg === "*98" || rawArg === "98") {
    const session = new CallSession(channel.id);
    sessions.set(channel.id, session);
    try {
      await vmIvr.runVoicemailIvr(channel, caller);
    } catch (e) {
      console.error(`[bridged] *98 IVR failed:`, e.message || e);
      try {
        await channel.answer();
        await channel.play({ media: "sound:vm-sorry" });
      } catch {}
    }
    await session.close(client);
    return;
  }

  const digits = rawArg.replace(/\D/g, "");
  const session = new CallSession(channel.id);
  sessions.set(channel.id, session);
  let resolved = null;

  try {
    resolved = await phFetch("/api/bridge/resolve", {
      method: "POST",
      body: JSON.stringify({ sipExtension: caller, dialed: digits }),
    });
    if (!resolved.ok) throw Object.assign(new Error(resolved.reason || "resolve failed"), { body: resolved });

    if (resolved.treeHouse) {
      console.log(`[bridged] ${resolved.fromLabel} → TreeHouse (${digits})`);
      try {
        await startTreeHouseAta(client, session, channel, {
          ...resolved,
          fromSipExtension: caller,
        });
      } finally {
        await leaveTreeHouseAta(session);
      }
      await session.close(client);
      return;
    }

    if (resolved.grandparentsMenu) {
      console.log(`[bridged] ${resolved.fromLabel} → Grandparents menu (${digits})`);
      try {
        await channel.answer();
      } catch {}
      const prompt = String(resolved.prompt || "There are no grandparents yet.");
      const choices = Array.isArray(resolved.choices) ? resolved.choices : [];
      const menuKeys = choices
        .map((c) => String(c.digit || ""))
        .filter((d) => /^\d$/.test(d))
        .join("");
      const intKeys = menuKeys || "123456789";
      let picked = null;
      for (let attempt = 0; attempt < 2 && !picked; attempt++) {
        // Read() in phonehome-ivr-say plays the prompt and returns the digit
        // (during the file, or within 12s after). A second pass if they miss.
        const digit = await sayIvrText(channel, prompt, intKeys);
        if (!digit || digit === "*" || digit === "#") continue;
        picked = choices.find((c) => String(c.digit) === String(digit)) || null;
      }
      if (!picked) {
        await sayIvrText(channel, "Sorry, I did not get that.");
        await session.close(client);
        return;
      }
      resolved = {
        ok: true,
        fromLineId: resolved.fromLineId,
        toLineId: picked.toLineId,
        fromLabel: resolved.fromLabel,
        toLabel: picked.toLabel,
        cidName: picked.cidName || picked.toLabel,
        cidNumber: picked.cidNumber || "0000",
        dialed: digits,
        toSipExtension: picked.toSipExtension || null,
      };
      console.log(
        `[bridged] Grandparents menu → ${resolved.toLabel}${
          resolved.toSipExtension ? ` [FXS ${resolved.toSipExtension}]` : ""
        }`
      );
    }

    console.log(
      `[bridged] ${resolved.fromLabel} → ${resolved.toLabel} (${digits})${
        resolved.toSipExtension ? ` [FXS ${resolved.toSipExtension}]` : ""
      }`
    );

    // "Calling {name}" on the off-hook handset before either far end rings.
    // Early media only (skipAnswer). answer() here wedges HT801 SDES, and
    // channel.play that overlaps ExternalMedia freezes the uplink (~25 packets).
    try {
      await announceDialingOnFxs(channel, resolved.toLabel);
    } catch (e) {
      console.warn(`[bridged] outbound destination announce skipped:`, e.message || e);
    }

    // FXS-first when the kid has an ATA, but do not strand the caller if the
    // landline contact is stale/Unavail while their softphone still shows online.
    if (resolved.toSipExtension) {
      const sip = await sipRegistrationStatus(resolved.toSipExtension);
      const tryAta = Boolean(sip.callable || sip.registered);
      if (tryAta) {
        try {
          const lifecycle = await phFetch("/api/bridge/calls/begin", {
            method: "POST",
            body: JSON.stringify({
              fromLineId: resolved.fromLineId,
              toLineId: resolved.toLineId,
            }),
          });
          session.callId = lifecycle.callId;
          session.ataToAta = true;
          await startAtaToAta(client, session, channel, resolved);
          return;
        } catch (e) {
          const msg = e?.message || String(e);
          if (session.callId && session.ataToAta && !session.ataLifecycleEnded) {
            session.ataLifecycleEnded = true;
            try {
              await phFetch(`/api/bridge/calls/${encodeURIComponent(session.callId)}/event`, {
                method: "POST",
                body: JSON.stringify({
                  type: "cancel",
                  reason: /no answer/i.test(msg) ? "no-answer" : "media-failure",
                  idempotencyKey: `ari-cancel:${session.channelId}`,
                }),
              });
            } catch {}
          }
          session.callId = null;
          session.ataToAta = false;
          markSipUnreachable(resolved.toSipExtension, msg);
          if (
            !/Allocation failed|invalid URI|not registered|unreachable|offline/i.test(msg)
          ) {
            throw e;
          }
          console.warn(
            `[bridged] ATA ${resolved.toSipExtension} unreachable (${msg}); falling back to softphone`
          );
          try {
            await session.destChannel?.hangup();
          } catch {}
          session.destChannel = null;
          try {
            await session.bridge?.destroy();
          } catch {}
          session.bridge = null;
        }
      } else {
        console.log(
          `[bridged] ATA ${resolved.toSipExtension} not registered (${
            sip.state || sip.reason || "offline"
          }); ringing softphone`
        );
      }
    }

    // No FXS playback on this leg. Piper after join killed the HT801 uplink
    // (call_OaE7LGS-b6). "Calling {name}" already finished above, before this ring.
    // Piper that overlaps this join freezes fxsIn (~25).
    session.fxsChannel = channel;
    const webrtcLeg = startWebRtcLeg(session, resolved);
    try {
      await channel.ring();
    } catch {}
    await webrtcLeg;
    await attachExternalMedia(client, session, channel, { armSend: false });
    await answerFxsWhenMediaReady(session, "media-ready");
    if (session.closed) return;
    session.callConnected = true;
    armExternalMediaMix(session);
    startMediaDiagnostics(session);
    void logAtaRtpAddresses(session, channel, "ATA→softphone").catch(() => {});
    console.log(
      `[bridged] media up call=${session.callId} transport=${session.externalMediaTransport} encCh=${session.opusEncChannels} pt=${session.opusPt}`
    );
  } catch (e) {
    console.error(`[bridged] call failed:`, e.message || e);
    const body = e.body || { reason: e.message };
    const errText = String(body.reason || e.message || "");
    const noAnswer = /No answer from (ATA|softphone)/i.test(errText);
    const offlineAta = /Allocation failed|invalid URI|not registered|unreachable|offline/i.test(
      errText
    );
    const offlineSoft =
      body.voice === "offline" ||
      /isn.?t reachable|not reachable|open PhoneHome|landline is offline|Analog phone didn/i.test(
        errText
      );
    const policy =
      body.voice ||
      /quiet|pause|timeout|Bedtime|School|talk time|not available|approved|busy|another call/i.test(
        errText
      );
    try {
      if (noAnswer && session.fromLineId && session.toLineId) {
        // Stop ringing the far leg before depositing.
        try {
          await session.destChannel?.hangup();
        } catch {}
        await releaseMediaForVoicemail(session);
        await vmIvr.runNoAnswerDeposit(channel, {
          fromLineId: session.fromLineId,
          toLineId: session.toLineId,
          toLabel: resolved?.toLabel || "them",
        });
      } else if (policy || offlineSoft) await playUnavailablePrompt(channel, body);
      else if (offlineAta) {
        await channel.answer();
        await sayIvrText(
          channel,
          "That phone is offline right now. Please try again in a minute."
        );
      } else {
        await channel.answer();
        await playMediaUri(channel, "sound:cannot-complete-as-dialed");
      }
    } catch {}
    await session.close(client);
  }
}

async function closeSessionsForChannel(client, channelId) {
  const pending = pendingSipLegs.get(channelId);
  if (pending) pending.reject(new Error("ATA hung up before answer"));
  const ann = pendingAnnounce.get(channelId);
  if (ann) ann.reject(new Error("ATA hung up during announce"));
  const ivr = pendingIvrSay.get(channelId);
  if (ivr) ivr.reject(new Error("ATA hung up during IVR say"));

  const closed = new Set();
  const closeOne = async (session) => {
    if (!session || closed.has(session)) return;
    closed.add(session);
    if (!session.hangupReason) session.hangupReason = "analog-hangup";
    await session.close(client);
  };

  const direct = sessions.get(channelId);
  if (direct) await closeOne(direct);
  for (const s of sessions.values()) {
    if (
      s.destChannel?.id === channelId ||
      s.extChannel?.id === channelId ||
      s.fxsChannel?.id === channelId
    ) {
      await closeOne(s);
    }
  }
}

async function main() {
  // One bad SDP must not take down the whole Stasis listener (lab saw systemd
  // restart mid-call when setRemoteDescription threw from a WS handler).
  process.on("uncaughtException", (e) => {
    console.error("[bridged] uncaughtException (kept alive):", e?.message || e);
  });
  process.on("unhandledRejection", (e) => {
    console.error("[bridged] unhandledRejection (kept alive):", e?.message || e);
  });

  console.log(`[bridged] PhoneHome ${PH_URL}  ARI ${ARI_URL} app=${ARI_APP}`);
  startHttpServer();

  const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
  ariClient = client;

  client.on("StasisStart", (event, channel) => {
    if (event.application !== ARI_APP) return;
    const args = event.args || [];
    if (args[0] === "sip-leg") {
      const pending = pendingSipLegs.get(channel.id);
      if (pending) pending.resolve(channel);
      else console.log(`[bridged] sip-leg StasisStart unmatched ch=${channel.id}`);
      return;
    }
    if (args[0] === "post-announce") {
      const pending = pendingAnnounce.get(channel.id);
      if (pending) pending.resolve(channel);
      else console.log(`[bridged] post-announce unmatched ch=${channel.id}`);
      return;
    }
    if (args[0] === "post-ivr-say") {
      const pending = pendingIvrSay.get(channel.id);
      // Dialplan may pass barge-in digit as args[1] (Flite intkeys + Read).
      // Piper Read also passes READSTATUS as args[2]. ERROR with no digit means
      // the wav never played — reject so sayIvrText can Flite instead.
      const bargeDigit = args[1] ? String(args[1]).replace(/\D/g, "").slice(0, 1) : null;
      const readStatus = args[2] ? String(args[2]) : "";
      if (pending) {
        if (readStatus === "ERROR" && !bargeDigit) pending.reject(new Error("ivr read error"));
        else pending.resolve(bargeDigit || null);
      } else console.log(`[bridged] post-ivr-say unmatched ch=${channel.id}`);
      return;
    }
    // ExternalMedia / empty args — ignore
    if (!args.length) return;
    onStasisStart(client, event, channel).catch((e) => console.error(e));
  });

  client.on("StasisEnd", async (_event, channel) => {
    // Expected leave while Flite runs in phonehome-announce / phonehome-ivr-say.
    if (announceInProgress.has(channel.id) || ivrSayInProgress.has(channel.id)) return;
    await closeSessionsForChannel(client, channel.id);
  });

  client.on("ChannelHangupRequest", async (_event, channel) => {
    if (announceInProgress.has(channel.id)) {
      // Real hangup during announce — clear guard so cleanup can run
      announceInProgress.delete(channel.id);
      const ann = pendingAnnounce.get(channel.id);
      if (ann) ann.reject(new Error("ATA hung up during announce"));
    }
    if (ivrSayInProgress.has(channel.id)) {
      ivrSayInProgress.delete(channel.id);
      const ivr = pendingIvrSay.get(channel.id);
      if (ivr) ivr.reject(new Error("ATA hung up during IVR say"));
    }
    await closeSessionsForChannel(client, channel.id);
  });

  client.on("ChannelDestroyed", async (_event, channel) => {
    const pending = pendingSipLegs.get(channel.id);
    if (pending) pending.reject(new Error("ATA channel destroyed"));
    if (announceInProgress.has(channel.id)) {
      announceInProgress.delete(channel.id);
      const ann = pendingAnnounce.get(channel.id);
      if (ann) ann.reject(new Error("ATA channel destroyed during announce"));
    }
    if (ivrSayInProgress.has(channel.id)) {
      ivrSayInProgress.delete(channel.id);
      const ivr = pendingIvrSay.get(channel.id);
      if (ivr) ivr.reject(new Error("ATA channel destroyed during IVR say"));
    }
    await closeSessionsForChannel(client, channel.id);
  });

  client.on("ChannelDtmfReceived", (event, channel) => {
    onFxsDtmf(event, channel).catch((e) => console.error("[bridged] dtmf", e.message || e));
  });

  client.on("ChannelHold", (event, channel) => {
    onFxsSipHold(channel, true).catch((e) => console.error("[bridged] ChannelHold", e.message || e));
  });

  client.on("ChannelUnhold", (event, channel) => {
    onFxsSipHold(channel, false).catch((e) => console.error("[bridged] ChannelUnhold", e.message || e));
  });

  await sweepOrphanedExternalMedia(client, { extMediaHost: EXT_MEDIA_HOST });
  await client.start(ARI_APP);
  console.log(`[bridged] listening for Stasis(${ARI_APP})`);
}

main().catch((e) => {
  console.error("[bridged] fatal", e);
  process.exit(1);
});
