/**
 * PhoneHome bridged — FreePBX ARI (Stasis) ↔ PhoneHome WebRTC softphones / HT801 FXS.
 *
 * Paths:
 *   ATA → softphone: Stasis → resolve → WS call.offer → ExternalMedia ↔ WebRTC
 *   ATA → ATA:       Stasis → resolve (toSipExtension) → originate PJSIP → mixing bridge
 *   ATA → TreeHouse: Stasis → resolve treeHouse → Asterisk mixing + presence join (pad #1)
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

const execFileAsync = promisify(execFile);
const PH_URL = (process.env.PHONEHOME_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const PH_WS = process.env.PHONEHOME_WS || PH_URL.replace(/^http/, "ws") + "/ws";
const BRIDGE_SECRET = (process.env.BRIDGE_SECRET || "").trim();
const ARI_URL = process.env.ARI_URL || "http://10.0.5.105:8088";
const ARI_USER = process.env.ARI_USER || "phonehome";
const ARI_PASS = process.env.ARI_PASS || "PhoneHomeAri!";
const ARI_APP = process.env.ARI_APP || "phonehome";
const EXT_MEDIA_HOST = process.env.EXT_MEDIA_HOST || "10.0.5.106";
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
 * Household-scoped Asterisk mixing bridges for analog TreeHouse (pad #1).
 * Softphone mesh stays WebRTC; FXS legs share this bridge so multiple ATAs can hear each other.
 * @type {Map<string, { bridge: import("ari-client").Bridge, channels: Set<string> }>}
 */
const treeHouseAtaBridges = new Map();
/** Parent listen-only ExternalMedia on the analog TreeHouse mix. parentLineId → session */
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

/** Letters, digits, spaces, basic punctuation — safe for Flite IVR phrases. */
function sanitizeIvrText(text) {
  return (
    String(text || "")
      .replace(/[^a-zA-Z0-9\s.,!?'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "Sorry."
  );
}

/**
 * Speak one Flite phrase on the FXS channel via FreePBX dialplan, then re-enter Stasis.
 * Fallback only when a Piper clip is missing — *98 menus prefer bridged/sounds/*.wav.
 */
async function sayIvrText(channel, text) {
  const phrase = sanitizeIvrText(text);
  console.log(`[bridged] IVR Flite fallback "${phrase}" ch=${channel.id}`);
  ivrSayInProgress.add(channel.id);
  try {
    await channel.setChannelVar({ variable: "PH_IVR_TEXT", value: phrase });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pendingIvrSay.delete(channel.id);
        reject(new Error("ivr say timeout"));
      }, 45000);
      pendingIvrSay.set(channel.id, {
        resolve: () => {
          clearTimeout(t);
          pendingIvrSay.delete(channel.id);
          resolve();
        },
        reject: (err) => {
          clearTimeout(t);
          pendingIvrSay.delete(channel.id);
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
          reject(e);
        });
    });
  } finally {
    ivrSayInProgress.delete(channel.id);
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

async function playMediaUri(channel, media, timeoutMs = 20000) {
  const playback = await channel.play({ media });
  await playFinished(playback, timeoutMs);
}

/**
 * Softphone hung up on an ATA↔WebRTC call — BYE the FXS immediately.
 *
 * Do NOT play Asterisk busy/beep over the SRTP FXS leg before hangup. That path
 * left HT801s in a silent "still in call" state (no dialtone on the next
 * off-hook) until power-cycle — receive still worked because FreePBX INVITEs
 * the Contact. Instant hangup restores idle dialtone on the adapter.
 */
async function endAtaCallFromSoftphoneHangup(session, reason = "softphone-hangup") {
  if (!session || session.closed) return;
  const fxs = session.fxsChannel;
  console.log(`[bridged] ${reason} call=${session.callId || "?"} — drop FXS`);
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
  playMediaUri,
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
    this.ws = null;
    this.pc = null;
    this.audioTrack = null;
    this.callId = null;
    this.fromLineId = null;
    this.toLineId = null;
    /** ARI channel for the FXS caller (ATA→soft). Answered early on call.accepted. */
    this.fxsChannel = null;
    /** True after channel.answer() — stops analog ringback before WebRTC SDP. */
    this.fxsAnswered = false;
    this.closed = false;
    this.opusEnc = new OpusScript(48000, 1, OpusScript.Application.VOIP);
    this.opusDec = new OpusScript(48000, 1, OpusScript.Application.VOIP);
    /** 1 or 2 — must match the remote Opus stream (iOS often sends stereo). */
    this.opusChannels = 1;
    this._opusDecodeFails = 0;
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
  }

  bindChannel(ch) {
    if (!ch?.id) return;
    this._sessionKeys.add(ch.id);
    sessions.set(ch.id, this);
  }

  async close(client) {
    if (this.closed) return;
    this.closed = true;
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
    // Flush hangup to the softphone before tearing down the socket — iOS was
    // staying "in call" when close() raced ahead of the hangup frame.
    try {
      if (this.ws?.readyState === WebSocket.OPEN && this.callId) {
        const payload = JSON.stringify({
          type: "call.hangup",
          callId: this.callId,
          fromLineId: this.fromLineId,
          toLineId: this.toLineId,
          reason: "bridge-hangup",
        });
        await new Promise((resolve) => {
          try {
            this.ws.send(payload, () => resolve());
          } catch {
            resolve();
          }
          setTimeout(resolve, 500);
        });
      }
    } catch {}
    try {
      this.ws?.close();
    } catch {}
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
    try {
      if (this.destChannel) await this.destChannel.hangup();
    } catch {}
    // TreeHouse uses a shared household mixing bridge — leaveTreeHouseAta owns teardown.
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

function upsample8kTo48k(pcm8) {
  const out = new Int16Array(pcm8.length * 6);
  for (let i = 0; i < pcm8.length; i++) {
    const s = pcm8[i];
    for (let j = 0; j < 6; j++) out[i * 6 + j] = s;
  }
  return out;
}

function downsample48kTo8k(pcm48) {
  const out = new Int16Array(Math.floor(pcm48.length / 6));
  for (let i = 0; i < out.length; i++) out[i] = pcm48[i * 6];
  return out;
}

function parseRtpPayload(msg) {
  if (msg.length < 12) return null;
  const cc = msg[0] & 0x0f;
  const headerLen = 12 + cc * 4;
  const pt = msg[1] & 0x7f;
  if (pt !== 0 && pt !== 8) return null;
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

/** Safari/iOS softphones often negotiate Opus stereo=1; our FXS path is mono ulaw. */
function opusChannelsFromSdp(sdp) {
  const s = String(sdp || "");
  if (/a=fmtp:\d+[^\r\n]*stereo=1/i.test(s)) return 2;
  // Some clients omit stereo=1 but still send 2-channel frames; prefer stereo when
  // channel_mapping / sprop hints appear.
  if (/a=fmtp:\d+[^\r\n]*channel_mapping=/i.test(s)) return 2;
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
  // Coturn on lab PVE is 10.0.5.31 — not the PhoneHome CT IP.
  const turnLanUrls = (process.env.TURN_LAN_URLS || "turn:10.0.5.31:3478")
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
      if (session.closed || !session.rtpSock) return;
      if (!session.remoteRtp) {
        session._rtpDropNoRemote = (session._rtpDropNoRemote || 0) + 1;
        if (session._rtpDropNoRemote === 1 || session._rtpDropNoRemote % 200 === 0) {
          console.warn(
            `[bridged] WebRTC→FXS drop x${session._rtpDropNoRemote} (waiting for Asterisk ExternalMedia RTP)`
          );
        }
        return;
      }
      try {
        const pcm48 = decodeOpusToMonoPcm48(session, rtp.payload);
        const pcm8 = downsample48kTo8k(pcm48);
        const ulaw = pcm16ToUlaw(pcm8);
        for (let off = 0; off + 160 <= ulaw.length; off += 160) {
          session.sipSeq = (session.sipSeq + 1) & 0xffff;
          session.sipTs = (session.sipTs + 160) >>> 0;
          const pkt = buildPcmuRtp({
            payload: ulaw.subarray(off, off + 160),
            seq: session.sipSeq,
            timestamp: session.sipTs,
            ssrc: session.sipSsrc,
          });
          session.rtpSock.send(pkt, session.remoteRtp.port, session.remoteRtp.address);
        }
      } catch {
        // iOS/Safari often sends stereo Opus while we initially decode mono — flip once.
        session._opusDecodeFails = (session._opusDecodeFails || 0) + 1;
        if (session.opusChannels !== 2 && session._opusDecodeFails <= 3) {
          setOpusDecoderChannels(session, 2);
          try {
            const pcm48 = decodeOpusToMonoPcm48(session, rtp.payload);
            const pcm8 = downsample48kTo8k(pcm48);
            const ulaw = pcm16ToUlaw(pcm8);
            for (let off = 0; off + 160 <= ulaw.length; off += 160) {
              session.sipSeq = (session.sipSeq + 1) & 0xffff;
              session.sipTs = (session.sipTs + 160) >>> 0;
              const pkt = buildPcmuRtp({
                payload: ulaw.subarray(off, off + 160),
                seq: session.sipSeq,
                timestamp: session.sipTs,
                ssrc: session.sipSsrc,
              });
              session.rtpSock.send(pkt, session.remoteRtp.port, session.remoteRtp.address);
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

/** Stop FXS ringback as soon as CallKit/softphone accepts (before SDP). */
async function answerFxsEarly(session, reason = "accepted") {
  if (!session?.fxsChannel || session.fxsAnswered || session.closed) return;
  try {
    await session.fxsChannel.answer();
    session.fxsAnswered = true;
    console.log(`[bridged] FXS answered early (${reason}) ch=${session.channelId}`);
  } catch (e) {
    console.warn(`[bridged] FXS early answer failed:`, e?.message || e);
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
  await waitIceGathering(pc);

  const local = pc.localDescription;
  ws.send(
    JSON.stringify({
      type: "call.offer",
      fromLineId: resolved.fromLineId,
      toLineId: resolved.toLineId,
      sdp: { type: local.type, sdp: local.sdp },
    })
  );

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("No answer from softphone")), RING_TIMEOUT_MS);
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
        // CallKit Answer (no SDP yet) — stop analog ringback immediately.
        if (msg.type === "call.accepted") {
          session.callId = msg.callId || session.callId;
          void answerFxsEarly(session, "call.accepted");
          return;
        }
        if (msg.type === "call.rejected") {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          ws.off("message", onMsg);
          reject(new Error(msg.reason || "rejected"));
          return;
        }
        if (msg.type === "call.answer" && msg.sdp) {
          // Keep listening for trickle ICE after answer — softphones do not
          // wait for iceGatheringComplete before sending call.answer.
          session.callId = msg.callId || session.callId;
          void answerFxsEarly(session, "call.answer");
          const remote = msg.sdp?.type ? msg.sdp : { type: "answer", sdp: msg.sdp };
          await pc.setRemoteDescription(remote);
          const sdp = String(remote.sdp || "");
          const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
          if (m) session.opusPt = Number(m[1]);
          setOpusDecoderChannels(session, opusChannelsFromSdp(sdp));
          if (!settled) {
            settled = true;
            clearTimeout(t);
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
            reject(new Error("remote hangup"));
            return;
          }
          // Already connected — must tear down FXS (was a no-op before → silent handset).
          try {
            ws.off("message", onMsg);
          } catch {}
          void endAtaCallFromSoftphoneHangup(session, "softphone-hangup");
        }
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        ws.off("message", onMsg);
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

async function attachExternalMedia(client, session, sipChannel) {
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
        const encoded = session.opusEnc.encode(int16ToBuffer(frame), 960);
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

  const ext = await client.channels.externalMedia({
    app: ARI_APP,
    external_host: `${EXT_MEDIA_HOST}:${port}`,
    format: "ulaw",
    encapsulation: "rtp",
    transport: "udp",
    connection_type: "client",
    direction: "both",
  });
  session.extChannel = ext;
  session.bindChannel(ext);
  if (sipChannel) session.bindChannel(sipChannel);

  const bridge = await client.bridges.create({ type: "mixing", name: `ph-${session.channelId || port}` });
  session.bridge = bridge;
  if (sipChannel) {
    await bridge.addChannel({ channel: `${sipChannel.id},${ext.id}` });
  }
  // Softphone→ATA: caller adds dest + ext after originate answers.
  return { bridge, ext };
}

/**
 * Listen-only tap of the household analog TreeHouse mix → parent WebRTC.
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
        const encoded = session.opusEnc.encode(int16ToBuffer(frame), 960);
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

async function handleTreeHouseListenOffer(client, claim, msg) {
  const parentLineId = String(msg.fromLineId || "");
  const childLineId = claim.lineId;
  const ataSession = [...sessions.values()].find(
    (s) => s.treeHouse && s.fromLineId === childLineId && !s.closed && !s.treeHouseListen
  );
  const hhId = ataSession?._treeHouseHh;
  const entry = hhId && treeHouseAtaBridges.get(hhId);
  if (!entry?.bridge) {
    console.warn(`[bridged] TreeHouse listen: no analog mix for ${childLineId}`);
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
  listen._treeHouseHh = hhId;
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
  const m = sdpStr.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (m) listen.opusPt = Number(m[1]);
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
  await attachTreeHouseListenMedia(client, listen, entry.bridge);
  const childName = sanitizeAnnounceName(ataSession?.fromLabel || "Someone");
  void announceOnTreeHouseMix(client, entry.bridge, `${childName}'s parent is listening`);
  console.log(
    `[bridged] TreeHouse listen media parent=${parentLineId} child=${childLineId} rtp=${listen.rtpPort}`
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
 * @returns {Promise<object>} same channel (still in Stasis)
 */
async function announceCallerInStasis(channel, name, prefix = "Call from") {
  const text = sanitizeAnnounceName(name);
  const pref =
    String(prefix || "Call from")
      .replace(/[^a-zA-Z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Call from";
  const phrase = `${pref} ${text}`;
  console.log(`[bridged] FXS announce (in-Stasis) "${phrase}" ch=${channel.id}`);
  try {
    await channel.answer();
  } catch {}
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
function announceCallerOnFxs(channel, name) {
  return announceCallerInStasis(channel, name, "Call from");
}

/** Outbound speed-dial / Home: confirm who we are about to ring. */
function announceDialingOnFxs(channel, name) {
  return announceCallerInStasis(channel, name, "Calling");
}

async function originateSip(client, session, sipExtension, callerId) {
  const endpoint = sipEndpoint(sipExtension);
  console.log(`[bridged] originate ${endpoint} callerId=${callerId || ""}`);
  const ringSec = Math.max(15, Math.round(RING_TIMEOUT_MS / 1000));
  const dest = await client.channels.originate({
    endpoint,
    app: ARI_APP,
    appArgs: "sip-leg",
    callerId: callerId || '"PhoneHome" <0000>',
    timeout: ringSec,
  });
  session.destChannel = dest;
  session.bindChannel(dest);
  const answered = await waitForSipLeg(dest.id, RING_TIMEOUT_MS);
  try {
    await answered.answer();
  } catch {
    /* already Up */
  }
  return answered || dest;
}

/**
 * Analog pad #1 → TreeHouse: presence join + Asterisk mixing (no WebRTC / ExternalMedia).
 * Softphones keep their mesh; they hear enter announce + presence. Multiple ATAs share one
 * household mixing bridge. Does not touch the soft↔analog ExternalMedia path.
 */
async function startTreeHouseAta(client, session, channel, resolved) {
  session.fromLineId = resolved.fromLineId;
  session.treeHouse = true;
  session.householdId = resolved.householdId;
  session.fromLabel = resolved.fromLabel;
  const sipExtension = String(resolved.fromSipExtension || "").replace(/\D/g, "");
  if (resolved.fromLineId && sipExtension) {
    try {
      await ensureInboundClaim(resolved.fromLineId, sipExtension);
    } catch (e) {
      console.warn(`[bridged] TreeHouse inbound claim skipped:`, e.message || e);
    }
  }

  const hhId = resolved.householdId;
  let entry = treeHouseAtaBridges.get(hhId);
  if (!entry && hhId) {
    const bridge = await client.bridges.create({
      type: "mixing",
      name: `ph-treehouse-${hhId}`,
    });
    entry = { bridge, channels: new Set() };
    treeHouseAtaBridges.set(hhId, entry);
  }
  if (entry) {
    session.bridge = entry.bridge;
    session._treeHouseHh = hhId;
  }

  const joined = await phFetch("/api/bridge/treehouse/join", {
    method: "POST",
    body: JSON.stringify({ lineId: resolved.fromLineId }),
  });
  console.log(
    `[bridged] TreeHouse join ${resolved.fromLabel} room=${joined.roomId} members=${
      (joined.members || []).length
    }`
  );

  try {
    await channel.answer();
  } catch {}

  try {
    await sayIvrText(channel, "Welcome to the TreeHouse");
  } catch (e) {
    console.warn(`[bridged] TreeHouse welcome skipped:`, e.message || e);
  }

  if (entry) {
    entry.channels.add(channel.id);
    await entry.bridge.addChannel({ channel: channel.id });
  }

  // Stay until the handset hangs up. Do not watch StasisEnd — Flite welcome
  // leaves Stasis briefly (ivrSayInProgress) and would end TreeHouse early.
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
  const hhId = session?._treeHouseHh;
  for (const [parentId, listen] of [...treeHouseListenSessions.entries()]) {
    if (listen.toLineId === lineId) {
      try {
        await listen.close(ariClient);
      } catch {}
      treeHouseListenSessions.delete(parentId);
    }
  }
  if (hhId && session?.channelId) {
    const entry = treeHouseAtaBridges.get(hhId);
    if (entry) {
      entry.channels.delete(session.channelId);
      try {
        await entry.bridge.removeChannel({ channel: session.channelId });
      } catch {}
      if (entry.channels.size === 0) {
        for (const [parentId, listen] of [...treeHouseListenSessions.entries()]) {
          if (listen._treeHouseHh !== hhId) continue;
          try {
            await listen.close(ariClient);
          } catch {}
          treeHouseListenSessions.delete(parentId);
        }
        try {
          await entry.bridge.destroy();
        } catch {}
        treeHouseAtaBridges.delete(hhId);
      }
    }
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

/** ATA → ATA: SIP↔SIP via Asterisk mixing bridge (no softphone). */
async function startAtaToAta(client, session, channel, resolved) {
  session.fromLineId = resolved.fromLineId;
  session.toLineId = resolved.toLineId;
  // Outbound "Calling {Name}" deferred while media path is restored (see onStasisStart).
  try {
    await channel.ring();
  } catch {}

  const bridge = await client.bridges.create({
    type: "mixing",
    name: `ph-ata-${session.channelId}`,
  });
  session.bridge = bridge;

  // Caller FXS — needed for hold peer lookup when callee is the one who holds.
  session.fxsChannel = channel;

  const cidName = resolved.cidName || resolved.fromLabel || "PhoneHome";
  const cidNumber = resolved.cidNumber || channel.caller?.number || "2000";
  const callerId = formatSipCallerId(cidName, cidNumber);
  const dest = await originateSip(client, session, resolved.toSipExtension, callerId);
  // Spoken screening for handsets with no CID display (in-Stasis Piper — no Flite leave).
  let peer = dest;
  try {
    peer = (await announceCallerOnFxs(dest, cidName)) || dest;
  } catch (e) {
    console.warn(`[bridged] ATA↔ATA announce skipped:`, e.message || e);
  }
  session.destChannel = peer;
  await channel.answer();
  await bridge.addChannel({ channel: `${channel.id},${peer.id}` });
  session.bindChannel(channel);
  session.bindChannel(peer);
  console.log(
    `[bridged] ATA↔ATA up ${resolved.fromLabel} → ${resolved.toLabel} ext=${resolved.toSipExtension} cid=${callerId}`
  );
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
    if (session.ws?.readyState === WebSocket.OPEN) session.ws.send(body);
  } catch {}
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
    const peer = holdPeerChannel(session, fxs);
    if (peer) {
      try {
        await peer.stopMoh();
      } catch (e) {
        console.warn(`[bridged] softphone unhold peer stopMoh failed:`, e.message || e);
      }
    }
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
    if (peer) {
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
  } else {
    try {
      await holderChannel.unmute({ direction: "both" });
    } catch (e) {
      console.warn(`[bridged] unhold unmute failed:`, e.message || e);
    }
    if (peer) {
      try {
        await peer.stopMoh();
      } catch (e) {
        console.warn(`[bridged] stop MOH failed:`, e.message || e);
      }
    }
  }
  // Softphone attributes hold to the ATA line (peer of the softphone).
  const ataLineId =
    session.destChannel && holderChannel.id === session.destChannel.id
      ? session.toLineId
      : session.fromLineId;
  notifySoftphoneHold(session, session.onHold, ataLineId || undefined);
}

async function onFxsDtmf(event, channel) {
  const digit = String(event?.digit || "");
  if (digit !== "#") return;
  const session = sessions.get(channel.id);
  if (!session || session.closed) return;
  // Only the analog handset(s) — not ExternalMedia — may toggle hold.
  const isFxs =
    channel.id === session.channelId ||
    channel.id === session.destChannel?.id;
  if (!isFxs) return;
  if (session._holdDtmfAt && Date.now() - session._holdDtmfAt < 400) return;
  session._holdDtmfAt = Date.now();
  try {
    await toggleFxsHold(session, channel);
  } catch (e) {
    console.error(`[bridged] hold toggle failed:`, e.message || e);
  }
}

/**
 * HT801 hold via SIP re-INVITE (a=sendonly / a=inactive).
 * Asterisk fires ChannelHold / ChannelUnhold; we play MOH on the peer so the
 * other party hears hold music.  We do NOT mute at ARI level — Asterisk already
 * handles the RTP direction negotiated in the re-INVITE.
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
  console.log(
    `[bridged] FXS SIP hold ${isHold ? "ON" : "OFF"} ch=${channel.id} peer=${peer?.id || "none"}`
  );
  if (isHold) {
    if (peer) {
      try {
        await peer.startMoh({ mohClass: "default" });
      } catch (e) {
        try {
          await peer.startMoh();
        } catch (e2) {
          console.warn(`[bridged] SIP hold MOH failed:`, e2.message || e2);
        }
      }
    }
  } else {
    if (peer) {
      try {
        await peer.stopMoh();
      } catch (e) {
        console.warn(`[bridged] SIP unhold stopMoh failed:`, e.message || e);
      }
    }
  }
  const ataLineId =
    session.destChannel && channel.id === session.destChannel.id
      ? session.toLineId
      : session.fromLineId;
  notifySoftphoneHold(session, session.onHold, ataLineId || undefined);
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
    try {
      const route = await phFetch("/api/bridge/route", {
        method: "POST",
        body: JSON.stringify({ fromLineId, toLineId }),
      });
      if (route?.cidName) cidName = route.cidName;
      if (route?.cidNumber) cidNumber = route.cidNumber;
    } catch (e) {
      console.warn(`[bridged] route CID lookup failed:`, e.message || e);
    }
    const callerId = formatSipCallerId(cidName, cidNumber);

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
    const m = sdpStr.match(/a=rtpmap:(\d+) opus\/48000/i);
    if (m) session.opusPt = Number(m[1]);
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
    const destPromise = originateSip(client, session, sipExtension, callerId);

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
    // Spoken "Call from {name}" on the handset (in-Stasis Piper — do NOT use Flite
    // leave/re-enter here; that races ExternalMedia and dumps the softphone to VM).
    try {
      await announceCallerOnFxs(dest, cidName);
    } catch (e) {
      console.warn(`[bridged] softphone→ATA announce skipped:`, e.message || e);
    }
    await attachExternalMedia(client, session, dest);
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
      `[bridged] softphone→ATA media up call=${callId} rtp=${session.rtpPort} ext=${sipExtension} cid=${callerId}`
    );
  } catch (e) {
    console.error(`[bridged] softphone→ATA failed:`, e.message || e);
    markSipUnreachable(sipExtension, e.message || e);
    try {
      if (claim.ws?.readyState === WebSocket.OPEN) {
        claim.ws.send(
          JSON.stringify({
            type: "call.hangup",
            callId,
            fromLineId,
            toLineId,
            reason: e.message || "ata-failed",
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
      // Soft→ATA: destChannel is the FXS; play busy so the kid hears the far end hang up.
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
  if (rawArg === "th-announce") {
    console.log(`[bridged] TreeHouse listen announce ch=${channel.id}`);
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

    console.log(
      `[bridged] ${resolved.fromLabel} → ${resolved.toLabel} (${digits})${
        resolved.toSipExtension ? ` [FXS ${resolved.toSipExtension}]` : ""
      }`
    );

    // FXS-first when the kid has an ATA, but do not strand the caller if the
    // landline contact is stale/Unavail while their softphone still shows online.
    if (resolved.toSipExtension) {
      const sip = await sipRegistrationStatus(resolved.toSipExtension);
      const tryAta = Boolean(sip.callable || sip.registered);
      if (tryAta) {
        try {
          await startAtaToAta(client, session, channel, resolved);
          return;
        } catch (e) {
          const msg = e?.message || String(e);
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

    // NOTE: outbound "Calling {Name}" announce deferred — Answer()+dialplan divert
    // before ExternalMedia was risky while debugging silent media (RTP to SIP proxy).
    // Ring FXS until softphone accepts — early Answer() at StasisStart stole ringback.
    // CallKit Answer sends call.accepted → answerFxsEarly() stops ringback before SDP.
    session.fxsChannel = channel;
    try {
      await channel.ring();
    } catch {}
    await startWebRtcLeg(session, resolved);
    try {
      if (!session.fxsAnswered) await channel.answer();
      session.fxsAnswered = true;
    } catch {}
    await attachExternalMedia(client, session, channel);
    console.log(`[bridged] media up call=${session.callId} rtp=${session.rtpPort}`);
  } catch (e) {
    console.error(`[bridged] call failed:`, e.message || e);
    const body = e.body || { reason: e.message };
    const errText = String(body.reason || e.message || "");
    const noAnswer = /No answer from (ATA|softphone)/i.test(errText);
    const offlineAta = /Allocation failed|invalid URI|not registered|unreachable|offline/i.test(
      errText
    );
    const policy =
      body.voice ||
      /quiet|pause|timeout|Bedtime|School|talk time|not available|approved/i.test(errText);
    try {
      if (noAnswer && session.fromLineId && session.toLineId) {
        // Stop ringing the far leg before depositing.
        try {
          await session.destChannel?.hangup();
        } catch {}
        await vmIvr.runNoAnswerDeposit(channel, {
          fromLineId: session.fromLineId,
          toLineId: session.toLineId,
          toLabel: resolved?.toLabel || "them",
        });
      } else if (policy) await playUnavailablePrompt(channel, body);
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
      if (pending) pending.resolve(channel);
      else console.log(`[bridged] post-ivr-say unmatched ch=${channel.id}`);
      return;
    }
    // ExternalMedia / empty args — ignore
    if (!args.length) return;
    onStasisStart(client, event, channel).catch((e) => console.error(e));
  });

  client.on("StasisEnd", async (_event, channel) => {
    // Expected leave while Flite runs in phonehome-announce / phonehome-ivr-say.
    if (announceInProgress.has(channel.id) || ivrSayInProgress.has(channel.id)) return;
    const pending = pendingSipLegs.get(channel.id);
    if (pending) pending.reject(new Error("ATA hung up before answer"));
    const ann = pendingAnnounce.get(channel.id);
    if (ann) ann.reject(new Error("ATA hung up during announce"));
    const ivr = pendingIvrSay.get(channel.id);
    if (ivr) ivr.reject(new Error("ATA hung up during IVR say"));
    const session = sessions.get(channel.id);
    if (session) await session.close(client);
    // Also close softphone→ATA sessions whose dest hung up
    for (const s of sessions.values()) {
      if (s.destChannel?.id === channel.id || s.extChannel?.id === channel.id) {
        await s.close(client);
      }
    }
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
    const session = sessions.get(channel.id);
    if (session) await session.close(client);
    for (const s of sessions.values()) {
      if (s.destChannel?.id === channel.id) await s.close(client);
    }
  });

  client.on("ChannelDestroyed", (_event, channel) => {
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

  await client.start(ARI_APP);
  console.log(`[bridged] listening for Stasis(${ARI_APP})`);
}

main().catch((e) => {
  console.error("[bridged] fatal", e);
  process.exit(1);
});
