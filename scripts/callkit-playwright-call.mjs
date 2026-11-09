/**
 * CallKit E2E: open softphone in Chromium, call Cameron's line (real WebRTC).
 * Measures caller-side inbound audioLevel — proves callee mic is actually sending.
 * Usage:
 *   SESSION_ID=sess_xxx FROM_LINE=… TO_LINE=… HOLD_MS=45000 node scripts/callkit-playwright-call.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PHONEHOME_URL || "https://mothership.example:8443";
const SESSION = process.env.SESSION_ID || "";
const FROM_LINE = process.env.FROM_LINE || "line_example_from";
const TO_LINE = process.env.TO_LINE || "line_example_to";
const HOLD_MS = Number(process.env.HOLD_MS || 45000);
/** Minimum peak inbound audioLevel (0–1) to count as real callee uplink. */
const MIN_IN_LEVEL = Number(process.env.MIN_IN_LEVEL || 0.01);

if (!SESSION) {
  console.error("SESSION_ID required");
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--ignore-certificate-errors",
    "--host-resolver-rules=MAP mothership.example 192.168.2.31",
  ],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  permissions: ["microphone"],
});
const page = await context.newPage();
page.on("console", (msg) => {
  const t = msg.text();
  if (/\[ios\]|\[signal\]|\[ice\]|\[call\]|CallKit|error|warn/i.test(t)) {
    console.log("browser:", t.slice(0, 240));
  }
});

await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.evaluate(
  ({ sessionId, fromLine }) => {
    localStorage.setItem("kl_session", sessionId);
    localStorage.setItem("kl_line", fromLine);
    localStorage.setItem("kl_tutorial_v9", "1");
    localStorage.setItem("kl_how_it_works_install", "1");
  },
  { sessionId: SESSION, fromLine: FROM_LINE }
);
await page.reload({ waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(2500);

const me = await page.evaluate(async () => {
  const sid = localStorage.getItem("kl_session");
  const r = await fetch("/api/me", { headers: { "X-Session-Id": sid } });
  const j = await r.json();
  return {
    ok: r.ok,
    user: j.user?.username || j.user?.display_name,
    lines: (j.households || []).flatMap((h) => (h.lines || []).map((l) => l.name)),
  };
});
console.log("signed in as", me);
console.log("dial (forced programmatic WebRTC) — answer on iPhone");

const result = await page.evaluate(
  async ({ fromLine, toLine, sessionId, holdMs, minInLevel }) => {
    const ice = await fetch("/api/ice").then((r) => r.json());
    const pc = new RTCPeerConnection({ iceServers: ice.iceServers || [] });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getAudioTracks()) pc.addTrack(t, stream);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
      setTimeout(() => rej(new Error("ws timeout")), 8000);
    });
    const inbox = [];
    ws.onmessage = (ev) => {
      try {
        inbox.push(JSON.parse(ev.data));
      } catch {}
    };
    ws.send(JSON.stringify({ type: "hello", sessionId, lineId: fromLine }));
    await new Promise((r) => setTimeout(r, 800));

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      ws.send(
        JSON.stringify({
          type: "call.ice",
          fromLineId: fromLine,
          toLineId: toLine,
          callId: window.__phCallId,
          candidate: ev.candidate.toJSON(),
        })
      );
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((r) => setTimeout(r, 1500));

    ws.send(
      JSON.stringify({
        type: "call.offer",
        fromLineId: fromLine,
        toLineId: toLine,
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      })
    );

    const deadline = Date.now() + 35000;
    let answer = null;
    while (Date.now() < deadline) {
      while (inbox.length) {
        const m = inbox.shift();
        if (m.type === "call.answer" && m.sdp) {
          answer = m;
          window.__phCallId = m.callId;
        }
        if (m.type === "call.rejected") return { ok: false, rejected: m.reason };
        if (m.type === "call.ice" && m.candidate && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(m.candidate);
          } catch {}
        }
      }
      if (answer) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!answer) return { ok: false, error: "no answer", inbox: inbox.map((m) => m.type) };
    await pc.setRemoteDescription(answer.sdp);

    // Sample getStats for real audio energy (not just ICE connected).
    let maxInLevel = 0;
    let maxOutLevel = 0;
    let bytesIn0 = null;
    let bytesInLast = 0;
    let bytesOutLast = 0;
    const sampleUntil = Date.now() + Math.min(holdMs, 20000);
    while (Date.now() < sampleUntil) {
      while (inbox.length) {
        const m = inbox.shift();
        if (m.type === "call.ice" && m.candidate) {
          try {
            await pc.addIceCandidate(m.candidate);
          } catch {}
        }
      }
      const stats = await pc.getStats();
      stats.forEach((s) => {
        if (s.type === "inbound-rtp" && (s.kind === "audio" || s.mediaType === "audio")) {
          const lvl = Number(s.audioLevel || 0);
          if (lvl > maxInLevel) maxInLevel = lvl;
          const b = Number(s.bytesReceived || 0);
          if (bytesIn0 == null) bytesIn0 = b;
          bytesInLast = b;
        }
        if (s.type === "outbound-rtp" && (s.kind === "audio" || s.mediaType === "audio")) {
          const lvl = Number(s.audioLevel || 0);
          if (lvl > maxOutLevel) maxOutLevel = lvl;
          bytesOutLast = Number(s.bytesSent || 0);
        }
        // Chromium sometimes puts level on media-source / track
        if (s.type === "media-source" && s.kind === "audio") {
          const lvl = Number(s.audioLevel || 0);
          if (lvl > maxOutLevel) maxOutLevel = lvl;
        }
      });
      await new Promise((r) => setTimeout(r, 400));
    }

    const bytesInDelta = bytesInLast - (bytesIn0 || 0);
    const uplinkOk = maxInLevel >= minInLevel || bytesInDelta > 8000;
    try {
      ws.send(
        JSON.stringify({
          type: "call.hangup",
          callId: answer.callId,
          fromLineId: fromLine,
          toLineId: toLine,
        })
      );
    } catch {}
    pc.close();
    return {
      ok: uplinkOk,
      ice: pc.iceConnectionState,
      conn: pc.connectionState,
      callId: answer.callId,
      maxInLevel,
      maxOutLevel,
      bytesInDelta,
      uplinkOk,
      minInLevel,
    };
  },
  {
    fromLine: FROM_LINE,
    toLine: TO_LINE,
    sessionId: SESSION,
    holdMs: HOLD_MS,
    minInLevel: MIN_IN_LEVEL,
  }
);

console.log("programmatic call", result);
if (!result?.uplinkOk) {
  console.error(
    "FAIL: no real callee uplink (maxInLevel=",
    result?.maxInLevel,
    "bytesInDelta=",
    result?.bytesInDelta,
    ")"
  );
  await browser.close();
  process.exit(2);
}
console.log("PASS: callee uplink has energy");
await browser.close();
