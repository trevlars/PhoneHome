const app = document.getElementById("app");

const TUTORIAL_KEY = "kl_tutorial_done";

const TUTORIAL_SLIDES = [
  {
    glyph: "☎",
    title: "A phone that’s just a phone",
    body: "Kids call people you approve — not the open internet. No feeds, no strangers, no spam.",
  },
  {
    glyph: "🔗",
    title: "Invite families you trust",
    body: "Send a short code. Cousins join the same private network. They don’t need a VPN.",
  },
  {
    glyph: "✓",
    title: "Allowlist is the rule",
    body: "If someone’s not on your contacts list, the phone doesn’t ring. Quiet hours and a kill switch are one tap away.",
  },
  {
    glyph: "🔒",
    title: "Calls stay private",
    body: "Voice is encrypted between phones. The server only helps the call start — it doesn’t listen in.",
  },
];

const state = {
  sessionId: localStorage.getItem("kl_session") || "",
  user: null,
  households: [],
  directory: [],
  activeLineId: localStorage.getItem("kl_line") || "",
  ws: null,
  pc: null,
  localStream: null,
  pendingIce: [],
  remoteReady: false,
  muted: false,
  call: null,
  callStartedAt: 0,
  iceState: "",
  wakeLock: null,
  ringTimer: null,
  tickTimer: null,
  connectWatch: null,
  audioCtx: null,
  presenceTimer: null,
  celebrate: "",
  nav: localStorage.getItem("kl_nav") || "phone",
  parentUnlocked: sessionStorage.getItem("kl_parent_ok") === "1",
  error: "",
  screen: "boot",
  mode: "host",
  flash: "",
  tutorialIndex: 0,
  tutorialFromSettings: false,
};

const callRoot = () => document.getElementById("call-root");
const remoteAudio = () => document.getElementById("remote-audio");

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (state.sessionId) headers["X-Session-Id"] = state.sessionId;
  const res = await fetch(path, { ...opts, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function ensureWs() {
  if (!state.sessionId || !state.activeLineId) return;
  if (state.ws && state.ws.readyState <= 1) return;
  const ws = new WebSocket(wsUrl());
  state.ws = ws;
  let chain = Promise.resolve();
  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sessionId: state.sessionId,
        lineId: state.activeLineId,
      })
    );
  };
  ws.onmessage = (ev) => {
    // Serialize handlers — overlapping async onmessage drops/races ICE + SDP.
    chain = chain
      .then(() => handleSignal(JSON.parse(ev.data)))
      .catch((err) => console.warn("[signal]", err));
  };
  ws.onclose = () => setTimeout(ensureWs, 1500);
}

async function handleSignal(msg) {
  if (msg.type === "call.offer") await onIncomingOffer(msg);
  else if (msg.type === "call.answer") await onAnswer(msg);
  else if (msg.type === "call.ice") await addRemoteIce(msg.candidate);
  else if (msg.type === "call.hangup") {
    stopRing();
    endCallUi("Call ended");
    render();
  } else if (msg.type === "call.rejected") {
    stopRing();
    state.flash = msg.reason || "Call could not connect";
    endCallUi();
    render();
  } else if (msg.type === "call.ringing") {
    state.call = { ...(state.call || {}), status: "ringing", callId: msg.callId };
    paintCallLayer();
  }
}

function sdpPayload(desc) {
  return { type: desc.type, sdp: desc.sdp };
}

function icePayload(candidate) {
  if (!candidate) return null;
  return typeof candidate.toJSON === "function" ? candidate.toJSON() : candidate;
}

async function refresh() {
  const data = await api("/api/me");
  state.user = data.user;
  state.households = data.households || [];
  state.directory = data.directory || [];
  if (!state.activeLineId) {
    const line = state.households.flatMap((h) => h.lines)[0];
    if (line) {
      state.activeLineId = line.id;
      localStorage.setItem("kl_line", line.id);
    }
  }
  const hh = state.households[0];
  if (!hh) state.screen = state.mode === "join" ? "join" : "host";
  else if (!hh.lines.length) state.screen = "host";
  else if (state.screen === "boot" || state.screen === "welcome" || state.screen === "host" || state.screen === "join") {
    state.screen = "home";
  }
  ensureWs();
  render();
}

async function iceServers() {
  try {
    const data = await api("/api/ice");
    if (data.iceServers?.length) return data.iceServers;
  } catch {}
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
}

async function addRemoteIce(candidate) {
  // candidate may be null (= end of candidates). Still must not drop early trickle.
  if (candidate === undefined) return;
  if (!state.pc || !state.remoteReady) {
    if (candidate) state.pendingIce.push(candidate);
    return;
  }
  try {
    await state.pc.addIceCandidate(candidate ? new RTCIceCandidate(candidate) : null);
  } catch (e) {
    console.warn("[ice] add failed", e);
  }
}

async function flushIce() {
  state.remoteReady = true;
  const queued = state.pendingIce.splice(0);
  for (const c of queued) {
    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      console.warn("[ice] flush failed", e);
    }
  }
}

function clearConnectWatch() {
  if (state.connectWatch) clearTimeout(state.connectWatch);
  state.connectWatch = null;
}

function armConnectWatch() {
  clearConnectWatch();
  state.connectWatch = setTimeout(() => {
    if (!state.call) return;
    if (state.iceState === "connected") return;
    state.flash =
      "Voice didn’t connect. Hang up and try again — both phones need the tab open on a solid network.";
    hangup();
    render();
  }, 25_000);
}

async function requestWakeLock() {
  try {
    if (navigator.wakeLock) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}

function releaseWakeLock() {
  try {
    state.wakeLock?.release();
  } catch {}
  state.wakeLock = null;
}

function startRing() {
  stopRing();
  try {
    const ctx = state.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    state.audioCtx = ctx;
    const beep = () => {
      playTone(440, 0.22, 0.055, "triangle");
      setTimeout(() => playTone(554, 0.22, 0.045, "triangle"), 220);
    };
    beep();
    state.ringTimer = setInterval(beep, 2200);
    if (navigator.vibrate) navigator.vibrate([180, 80, 180, 80, 240]);
  } catch {}
}

function stopRing() {
  if (state.ringTimer) clearInterval(state.ringTimer);
  state.ringTimer = null;
}

function startCallTicker() {
  stopCallTicker();
  state.tickTimer = setInterval(() => {
    const el = document.getElementById("call-timer");
    if (el && state.callStartedAt) el.textContent = formatDuration(Date.now() - state.callStartedAt);
  }, 500);
}

function stopCallTicker() {
  if (state.tickTimer) clearInterval(state.tickTimer);
  state.tickTimer = null;
}

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

async function makePc(peer) {
  state.remoteReady = false;
  state.iceState = "starting";
  state.muted = false;
  const pc = new RTCPeerConnection({
    iceServers: await iceServers(),
    iceCandidatePoolSize: 4,
  });
  state.pc = pc;
  // Keep any ICE that arrived before Answer / before PC existed.
  state.localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  for (const track of state.localStream.getTracks()) pc.addTrack(track, state.localStream);

  pc.ontrack = (ev) => {
    const audio = remoteAudio();
    if (audio) {
      audio.srcObject = ev.streams[0] || new MediaStream([ev.track]);
      const kick = () => audio.play().catch(() => {});
      kick();
      audio.onloadedmetadata = kick;
    }
  };
  pc.onicecandidate = (ev) => {
    if (!state.ws || state.ws.readyState !== 1) return;
    const payload = icePayload(ev.candidate);
    // null candidate = gathering complete; still useful for some peers
    state.ws.send(
      JSON.stringify({
        type: "call.ice",
        fromLineId: state.activeLineId,
        toLineId: peer,
        candidate: payload,
      })
    );
  };
  pc.onconnectionstatechange = () => {
    state.iceState = pc.connectionState;
    if (pc.connectionState === "connected") {
      clearConnectWatch();
      if (state.call && state.call.status !== "active") {
        state.call = { ...state.call, status: "active" };
        playConnectChime();
        if (!sessionStorage.getItem("kl_celebrated_call")) {
          sessionStorage.setItem("kl_celebrated_call", "1");
          state.celebrate = "You’re on a private family line.";
        }
      }
      if (!state.callStartedAt) {
        state.callStartedAt = Date.now();
        startCallTicker();
      }
      const audio = remoteAudio();
      if (audio) audio.play().catch(() => {});
      paintCallLayer();
    }
    if (pc.connectionState === "failed") {
      clearConnectWatch();
      state.flash = "Couldn’t connect voice. Try again — both phones need a good network.";
      hangup();
      render();
    }
    if (pc.connectionState === "disconnected") {
      paintCallLayer();
    }
  };
  return pc;
}

async function placeCall(toLineId) {
  if (state.call) return;
  state.flash = "";
  state.callStartedAt = 0;
  state.pendingIce = [];
  state.call = { status: "calling", toLineId, fromLineId: state.activeLineId };
  paintCallLayer();
  try {
    await requestWakeLock();
    const pc = await makePc(toLineId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (!state.ws || state.ws.readyState !== 1) {
      throw new Error("Not connected to the network yet — wait a second and try again");
    }
    state.ws.send(
      JSON.stringify({
        type: "call.offer",
        fromLineId: state.activeLineId,
        toLineId,
        sdp: sdpPayload(offer),
      })
    );
    armConnectWatch();
  } catch (e) {
    state.flash = e.message || "Microphone permission needed";
    endCallUi();
    render();
  }
}

async function onIncomingOffer(msg) {
  // New inbound call — keep early ICE for this call, drop leftovers from a prior one only if idle
  if (!state.call) state.pendingIce = [];
  state.callStartedAt = 0;
  state.call = {
    status: "incoming",
    fromLineId: msg.fromLineId,
    toLineId: msg.toLineId,
    callId: msg.callId,
    sdp: msg.sdp,
  };
  startRing();
  paintCallLayer();
}

async function acceptCall() {
  const msg = state.call;
  if (!msg?.sdp) return;
  stopRing();
  try {
    await requestWakeLock();
    const pc = await makePc(msg.fromLineId);
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.ws.send(
      JSON.stringify({
        type: "call.answer",
        callId: msg.callId,
        fromLineId: msg.fromLineId,
        toLineId: msg.toLineId,
        sdp: sdpPayload(answer),
      })
    );
    state.call = { ...msg, status: "connecting" };
    armConnectWatch();
    paintCallLayer();
  } catch (e) {
    state.flash = e.message || "Could not answer";
    hangup();
    render();
  }
}

async function onAnswer(msg) {
  if (!state.pc) return;
  if (state.pc.signalingState !== "have-local-offer") {
    console.warn("[signal] unexpected answer in state", state.pc.signalingState);
  }
  await state.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
  await flushIce();
  state.call = { ...(state.call || {}), status: "connecting", callId: msg.callId };
  armConnectWatch();
  paintCallLayer();
}

function toggleMute() {
  state.muted = !state.muted;
  state.localStream?.getAudioTracks().forEach((t) => {
    t.enabled = !state.muted;
  });
  paintCallLayer();
}

function hangup() {
  stopRing();
  if (state.ws && state.call) {
    state.ws.send(
      JSON.stringify({
        type: "call.hangup",
        callId: state.call.callId,
        fromLineId: state.call.fromLineId || state.activeLineId,
        toLineId: state.call.toLineId === state.activeLineId ? state.call.fromLineId : state.call.toLineId,
      })
    );
  }
  endCallUi();
}

function endCallUi(flash) {
  stopRing();
  stopCallTicker();
  clearConnectWatch();
  releaseWakeLock();
  if (state.pc) {
    try {
      state.pc.close();
    } catch {}
  }
  state.pc = null;
  if (state.localStream) state.localStream.getTracks().forEach((t) => t.stop());
  state.localStream = null;
  state.pendingIce = [];
  state.remoteReady = false;
  state.call = null;
  state.callStartedAt = 0;
  state.iceState = "";
  state.muted = false;
  const audio = remoteAudio();
  if (audio) audio.srcObject = null;
  if (flash) state.flash = flash;
  paintCallLayer();
}

function lineName(id) {
  const d = state.directory.find((x) => x.id === id);
  return d ? d.name : "Contact";
}

function householdName(id) {
  const d = state.directory.find((x) => x.id === id);
  return d ? d.household_name : "";
}

function contactLabel(call) {
  if (!call) return "";
  const other = call.fromLineId === state.activeLineId ? call.toLineId : call.fromLineId;
  return lineName(other);
}

function otherLineId(call) {
  if (!call) return "";
  return call.fromLineId === state.activeLineId ? call.toLineId : call.fromLineId;
}

function initials(name) {
  const parts = String(name || "?")
    .replace(/'s phone$/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const AVATAR_HUES = [28, 48, 142, 168, 198, 22, 85, 12];

function avatarStyle(seed) {
  let h = 0;
  const s = String(seed || "x");
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * 17) % AVATAR_HUES.length;
  const hue = AVATAR_HUES[h];
  return `background: linear-gradient(145deg, hsl(${hue} 52% 42%), hsl(${hue} 40% 22%));`;
}

function avatarHtml(name, seed, sizeClass = "") {
  return `<div class="avatar ${sizeClass}" style="${avatarStyle(seed)}" aria-hidden="true">${initials(name)}</div>`;
}

function playTone(freq, dur = 0.18, gain = 0.06, type = "sine") {
  try {
    const ctx = state.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    state.audioCtx = ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.stop(ctx.currentTime + dur);
  } catch {}
}

function playConnectChime() {
  playTone(523, 0.12, 0.05);
  setTimeout(() => playTone(784, 0.18, 0.05), 90);
}

function dots(n, active) {
  return `<div class="step-dots">${Array.from({ length: n }, (_, i) => `<span class="${i === active ? "on" : ""}"></span>`).join("")}</div>`;
}

function formatCallWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function outcomeLabel(outcome) {
  if (outcome === "completed" || outcome === "answered") return "Talked";
  if (outcome === "missed") return "Missed";
  if (outcome === "cancelled") return "Cancelled";
  if (outcome === "offline") return "Away";
  if (outcome === "ringing") return "Ringing";
  if (outcome === "blocked") return "Blocked";
  return "Call";
}

function paintCallLayer() {
  const root = callRoot();
  if (!root) return;
  if (!state.call) {
    root.innerHTML = "";
    return;
  }
  const status = state.call.status;
  const title =
    status === "incoming"
      ? "Incoming call"
      : status === "active"
        ? "Connected"
        : status === "connecting"
          ? "Connecting…"
          : status === "ringing"
            ? "Ringing…"
            : "Calling…";
  const who = contactLabel(state.call);
  const other = otherLineId(state.call);
  const house = householdName(other);
  const timer =
    state.callStartedAt && (status === "active" || status === "connecting")
      ? formatDuration(Date.now() - state.callStartedAt)
      : status === "active" || status === "connecting"
        ? "0:00"
        : "";
  const mediaHint =
    state.iceState === "connected"
      ? "Private · encrypted voice"
      : state.iceState === "disconnected"
        ? "Reconnecting…"
        : status === "connecting"
          ? "Setting up a private line…"
          : status === "incoming"
            ? "Someone on your allowlist is calling"
            : "Waiting for them to pick up…";
  const ringing = status === "incoming" || status === "ringing" || status === "calling";

  root.innerHTML = `
    <div id="call-layer" class="call-stage ${status}">
      <div class="call-stage-bg" aria-hidden="true"></div>
      <div class="call-card cinematic">
        <p class="call-kicker">${title}</p>
        <div class="call-avatar-wrap ${ringing ? "pulse" : ""}">
          <span class="call-ring"></span>
          <span class="call-ring delay"></span>
          ${avatarHtml(who, other, "xl")}
        </div>
        <h2 class="call-who">${who}</h2>
        ${house ? `<p class="call-house">${house}</p>` : ""}
        ${timer ? `<p class="call-timer" id="call-timer">${timer}</p>` : `<p class="call-media">${mediaHint}</p>`}
        ${timer && mediaHint ? `<p class="call-media">${mediaHint}</p>` : ""}
        <div class="call-actions ${status === "incoming" ? "incoming" : status === "active" || status === "connecting" ? "in-call" : "outbound"}">
          ${status === "incoming" ? `<button class="primary call-answer" id="accept">Answer</button>` : ""}
          ${status === "active" || status === "connecting" ? `<button class="ghost" id="mute">${state.muted ? "Unmute" : "Mute"}</button>` : ""}
          <button class="danger" id="hangup">${status === "incoming" ? "Decline" : "Hang up"}</button>
        </div>
      </div>
    </div>`;

  document.getElementById("hangup")?.addEventListener("click", () => {
    hangup();
    render();
  });
  document.getElementById("accept")?.addEventListener("click", acceptCall);
  document.getElementById("mute")?.addEventListener("click", toggleMute);
}

function renderWelcome() {
  const invite = new URLSearchParams(location.search).get("invite") || "";
  app.innerHTML = `
    <p class="brand">Kids<br/>Landline</p>
    <p class="lede">A private phone for the people you love. No strangers. No feeds. Just talk.</p>
    <div class="sheet welcome-sheet">
      <h2>Open the clubhouse</h2>
      <p>Cousins join with a short code — no app store, no VPN.</p>
      <div class="btn-row">
        <button class="primary" id="go-host">I’m hosting this family network</button>
        <button class="ghost" id="go-join">I was invited</button>
      </div>
      ${
        invite
          ? `<div class="invite-ready">Invite code ready<br/><strong>${invite}</strong></div>`
          : ""
      }
      <button class="linkish" id="replay-tutorial">How does this work?</button>
    </div>
  `;
  document.getElementById("go-host").onclick = () => {
    state.mode = "host";
    state.screen = "host";
    render();
  };
  document.getElementById("go-join").onclick = () => {
    state.mode = "join";
    state.screen = "join";
    render();
  };
  document.getElementById("replay-tutorial").onclick = () => {
    state.tutorialFromSettings = false;
    state.tutorialIndex = 0;
    state.screen = "tutorial";
    render();
  };
}

function phoneSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8z"/></svg>`;
}

function renderSplash() {
  app.innerHTML = `
    <div class="splash">
      <div class="splash-mark">${phoneSvg()}</div>
      <p class="brand">Kids<br/>Landline</p>
      <p class="lede">A private phone network for your family circle.</p>
    </div>
  `;
  setTimeout(() => {
    const done = localStorage.getItem(TUTORIAL_KEY) === "1";
    if (done) {
      state.screen = "welcome";
    } else {
      state.tutorialIndex = 0;
      state.screen = "tutorial";
    }
    render();
  }, 1600);
}

function finishTutorial() {
  localStorage.setItem(TUTORIAL_KEY, "1");
  if (state.tutorialFromSettings) {
    state.tutorialFromSettings = false;
    state.screen = state.user ? "settings" : "welcome";
  } else {
    state.screen = "welcome";
  }
  render();
}

function renderTutorial() {
  const slide = TUTORIAL_SLIDES[state.tutorialIndex];
  const last = state.tutorialIndex === TUTORIAL_SLIDES.length - 1;
  app.innerHTML = `
    <div class="tutorial">
      <div>
        ${dots(TUTORIAL_SLIDES.length, state.tutorialIndex)}
        <div class="tutorial-visual">
          <span class="ring"></span>
          <span class="ring delay"></span>
          <span class="glyph">${slide.glyph}</span>
        </div>
        <h2>${slide.title}</h2>
        <p>${slide.body}</p>
      </div>
      <div class="tutorial-footer">
        <div class="btn-row ${state.tutorialIndex > 0 ? "two" : ""}">
          ${state.tutorialIndex > 0 ? `<button class="ghost" id="prev">Back</button>` : ""}
          <button class="primary" id="next">${last ? "Get started" : "Next"}</button>
        </div>
        ${
          last
            ? ""
            : `<button class="linkish tutorial-skip" id="skip">Skip tutorial</button>`
        }
      </div>
    </div>
  `;
  document.getElementById("next").onclick = () => {
    if (last) finishTutorial();
    else {
      state.tutorialIndex += 1;
      render();
    }
  };
  document.getElementById("prev")?.addEventListener("click", () => {
    state.tutorialIndex = Math.max(0, state.tutorialIndex - 1);
    render();
  });
  document.getElementById("skip")?.addEventListener("click", finishTutorial);
}

function renderHost() {
  const hh = state.households[0];
  const needsAuth = !state.user;
  const needsFamily = state.user && !hh;
  const needsLine = hh && !hh.lines.length;
  const step = needsAuth ? 0 : needsFamily ? 1 : needsLine ? 2 : 3;

  app.innerHTML = `
    ${dots(3, Math.min(step, 2))}
    <p class="brand" style="font-size:1.8rem;margin-top:8px">Set up your network</p>
    <p class="lede">${needsAuth ? "Enter the host setup code from the server." : needsFamily ? "Name your household." : "Name this phone’s line."}</p>
    <div class="sheet">
      ${state.flash ? `<p class="error">${state.flash}</p>` : ""}
      ${
        needsAuth
          ? `
        <label>Host setup code</label>
        <input id="code" class="mono" inputmode="numeric" maxlength="6" placeholder="······" autocomplete="one-time-code" />
        <label>Your name</label>
        <input id="name" placeholder="e.g. Trevor" />
        <div class="btn-row">
          <button class="primary" id="login">Continue</button>
        </div>
        <button class="linkish" id="back">Back</button>`
          : needsFamily
            ? `
        <label>Family name</label>
        <input id="hh-name" placeholder="e.g. Carlston" />
        <div class="btn-row">
          <button class="primary" id="create-hh">Create household</button>
        </div>`
            : needsLine
              ? `
        <label>Line name</label>
        <input id="line-name" placeholder="e.g. Trevor’s phone" value="${state.user.display_name}'s phone" />
        <div class="btn-row">
          <button class="primary" id="add-line">Add softphone</button>
        </div>`
              : `
        <h2>You’re ready</h2>
        <p>Invite another parent, then allowlist each other’s lines to call.</p>
        <div class="btn-row">
          <button class="primary" id="to-home">Go to home</button>
        </div>`
      }
    </div>
  `;

  const back = document.getElementById("back");
  if (back)
    back.onclick = () => {
      state.screen = "welcome";
      render();
    };

  const login = document.getElementById("login");
  if (login)
    login.onclick = async () => {
      state.flash = "";
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            code: document.getElementById("code").value.trim(),
            displayName: document.getElementById("name").value.trim(),
          }),
        });
        state.sessionId = data.sessionId;
        localStorage.setItem("kl_session", data.sessionId);
        await refresh();
      } catch (e) {
        state.flash = e.message;
        render();
      }
    };

  const createHh = document.getElementById("create-hh");
  if (createHh)
    createHh.onclick = async () => {
      await api("/api/households", {
        method: "POST",
        body: JSON.stringify({ name: document.getElementById("hh-name").value }),
      });
      await refresh();
    };

  const addLine = document.getElementById("add-line");
  if (addLine)
    addLine.onclick = async () => {
      const line = (
        await api(`/api/households/${hh.id}/lines`, {
          method: "POST",
          body: JSON.stringify({
            name: document.getElementById("line-name").value || "Softphone",
            type: "softphone",
          }),
        })
      ).line;
      state.activeLineId = line.id;
      localStorage.setItem("kl_line", line.id);
      state.screen = "home";
      await refresh();
    };

  const toHome = document.getElementById("to-home");
  if (toHome)
    toHome.onclick = () => {
      state.screen = "home";
      render();
    };
}

function renderJoin() {
  const invite = new URLSearchParams(location.search).get("invite") || "";
  const needsAuth = !state.user;
  const needsRedeem = state.user && !state.households[0];
  const hh = state.households[0];
  const needsLine = hh && !hh.lines.length;

  app.innerHTML = `
    ${dots(3, needsAuth ? 0 : needsRedeem ? 1 : 2)}
    <p class="brand" style="font-size:1.8rem;margin-top:8px">Join a family</p>
    <p class="lede">${needsAuth ? "Create your parent login." : needsRedeem ? "Enter the invite code you were sent." : "Name the phone you’ll use."}</p>
    <div class="sheet">
      ${state.flash ? `<p class="error">${state.flash}</p>` : ""}
      ${
        needsAuth
          ? `
        <label>Your name</label>
        <input id="reg-name" placeholder="e.g. Maya’s mom" />
        <div class="btn-row">
          <button class="primary" id="register">Continue</button>
        </div>
        <p class="tiny" id="reg-code"></p>
        <button class="linkish" id="back">Back</button>`
          : needsRedeem
            ? `
        <label>Invite code</label>
        <input id="inv-code" class="mono" inputmode="numeric" maxlength="6" value="${invite}" placeholder="······" />
        <label>Your family name</label>
        <input id="inv-hh" placeholder="e.g. Cousins" />
        <div class="btn-row">
          <button class="primary" id="redeem">Join network</button>
        </div>`
            : needsLine
              ? `
        <label>Line name</label>
        <input id="line-name" placeholder="e.g. Kitchen phone" value="${state.user.display_name}'s phone" />
        <div class="btn-row">
          <button class="primary" id="add-line">Add softphone</button>
        </div>`
              : `
        <h2>Joined</h2>
        <p>Add each other to Contacts, then call.</p>
        <button class="primary" id="to-home">Go to home</button>`
      }
    </div>
  `;

  document.getElementById("back")?.addEventListener("click", () => {
    state.screen = "welcome";
    render();
  });

  document.getElementById("register")?.addEventListener("click", async () => {
    state.flash = "";
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ displayName: document.getElementById("reg-name").value.trim() }),
      });
      state.sessionId = data.sessionId;
      localStorage.setItem("kl_session", data.sessionId);
      state.flash = "";
      await refresh();
      // show save code once
      state.flash = `Save your code for next time: ${data.setupCode}`;
    } catch (e) {
      state.flash = e.message;
      render();
    }
  });

  document.getElementById("redeem")?.addEventListener("click", async () => {
    try {
      await api("/api/invites/redeem", {
        method: "POST",
        body: JSON.stringify({
          code: document.getElementById("inv-code").value.trim(),
          householdName: document.getElementById("inv-hh").value.trim(),
        }),
      });
      history.replaceState({}, "", "/");
      state.flash = "";
      await refresh();
    } catch (e) {
      state.flash = e.message;
      render();
    }
  });

  document.getElementById("add-line")?.addEventListener("click", async () => {
    const line = (
      await api(`/api/households/${hh.id}/lines`, {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("line-name").value || "Softphone",
          type: "softphone",
        }),
      })
    ).line;
    state.activeLineId = line.id;
    localStorage.setItem("kl_line", line.id);
    state.screen = "home";
    await refresh();
  });

  document.getElementById("to-home")?.addEventListener("click", () => {
    state.screen = "home";
    render();
  });
}

function dockHtml(active) {
  const unreadVm = (state.households[0]?.voicemails || []).filter((v) => !v.listened).length;
  const blocked = (state.households[0]?.call_logs || []).filter((l) => l.outcome === "blocked").length;
  return `
    <nav class="dock" aria-label="Main">
      <button type="button" class="dock-btn ${active === "phone" ? "on" : ""}" data-nav="phone"><span>☎</span>Phone</button>
      <button type="button" class="dock-btn ${active === "activity" ? "on" : ""}" data-nav="activity"><span>◉</span>Activity${blocked ? `<em>${Math.min(blocked, 9)}</em>` : ""}</button>
      <button type="button" class="dock-btn ${active === "voicemail" ? "on" : ""}" data-nav="voicemail"><span>▤</span>Voicemail${unreadVm ? `<em>${Math.min(unreadVm, 9)}</em>` : ""}</button>
      <button type="button" class="dock-btn ${active === "controls" ? "on" : ""}" data-nav="controls"><span>▣</span>Controls</button>
    </nav>`;
}

function bindDock() {
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.onclick = async () => {
      const nav = btn.getAttribute("data-nav");
      if (nav === "controls" && state.households[0]?.has_parent_pin && !state.parentUnlocked) {
        const pin = prompt("Parent PIN");
        if (pin == null) return;
        try {
          await api(`/api/households/${state.households[0].id}/pin/verify`, {
            method: "POST",
            body: JSON.stringify({ pin }),
          });
          state.parentUnlocked = true;
          sessionStorage.setItem("kl_parent_ok", "1");
        } catch (e) {
          state.flash = e.message || "Incorrect PIN";
          state.nav = "phone";
          localStorage.setItem("kl_nav", "phone");
          render();
          return;
        }
      }
      state.nav = nav;
      localStorage.setItem("kl_nav", nav);
      state.screen = "home";
      render();
    };
  });
}

function statusLine(hh, onlineCount) {
  if (hh.kill_switch) return { text: "Phone paused by parent", live: false, danger: true };
  if (hh.quiet_start && hh.quiet_end) return { text: `Quiet hours · ${quietSummary(hh)}`, live: false };
  const cap = hh.daily_cap_minutes;
  const used = hh.usage_today_minutes || 0;
  if (cap != null) return { text: `${used}/${cap} min used today · ${onlineCount} online`, live: onlineCount > 0 };
  return {
    text: onlineCount ? `${onlineCount} family line${onlineCount === 1 ? "" : "s"} online` : "Waiting for family to open their phone",
    live: onlineCount > 0,
  };
}

function renderHome() {
  if (state.nav === "activity") return renderActivity();
  if (state.nav === "voicemail") return renderVoicemail();
  if (state.nav === "controls") return renderControls();
  return renderPhone();
}

function renderPhone() {
  const hh = state.households[0];
  const contacts = (hh?.allowlist || []).map((a) => ({
    ...a,
    online: state.directory.find((d) => d.id === a.target_line_id)?.online,
  }));
  const onlineCount = contacts.filter((c) => c.online).length;
  const status = statusLine(hh, onlineCount);
  const dialSlots = [];
  for (let i = 1; i <= 9; i++) {
    dialSlots.push(contacts.find((c) => Number(c.speed_dial) === i) || null);
  }

  app.innerHTML = `
    <div class="app-shell">
      <div class="topbar">
        <div>
          <div class="mark">Kids Landline</div>
          <div class="who">${hh?.name || "Family"} · ${state.user.display_name}</div>
        </div>
        <button class="icon-btn" id="settings" title="Settings" aria-label="Settings">⚙</button>
      </div>

      <div class="home-hero compact">
        <h1 class="home-title">Speed dial</h1>
        <div class="status-chip ${status.live ? "live" : ""} ${status.danger ? "danger" : ""}">
          <span class="dot"></span>${status.text}
        </div>
      </div>

      ${state.flash ? `<p class="flash-banner">${state.flash}</p>` : ""}
      ${state.celebrate ? `<p class="celebrate-banner">${state.celebrate}</p>` : ""}

      <div class="speed-grid">
        ${dialSlots
          .map((c, idx) => {
            const n = idx + 1;
            if (!c) {
              return `<button class="speed-slot empty" data-add="1" type="button"><span class="speed-num">${n}</span><span class="speed-empty">Add</span></button>`;
            }
            return `<button class="speed-slot" data-call="${c.target_line_id}" type="button">
              <span class="speed-num">${n}</span>
              ${avatarHtml(c.label, c.target_line_id, "md")}
              <strong>${c.label}</strong>
              <small class="${c.online ? "on" : ""}">${c.online ? "Online" : "Away"}</small>
            </button>`;
          })
          .join("")}
      </div>

      <div class="home-actions">
        <button class="action-tile" id="invite">
          <span class="action-glyph">＋</span>
          <span><strong>Invite</strong><small>Family pass code</small></span>
        </button>
        <button class="action-tile" id="add-contact">
          <span class="action-glyph">★</span>
          <span><strong>Contacts</strong><small>Approved only</small></span>
        </button>
      </div>

      ${
        contacts.length
          ? `<div class="section-title">All approved contacts</div>
          <div class="contact-grid">${contacts
            .map(
              (c, i) => `
            <button class="contact-tile" data-call="${c.target_line_id}" style="animation-delay:${i * 0.04}s">
              ${avatarHtml(c.label, c.target_line_id, "lg")}
              <div class="contact-meta">
                <strong>${c.speed_dial ? `${c.speed_dial} · ` : ""}${c.label}</strong>
                <small>${householdName(c.target_line_id) || lineName(c.target_line_id)}</small>
              </div>
              <span class="pill ${c.online ? "on" : ""}"><span class="dot"></span>${c.online ? "Online" : "Away"}</span>
              <span class="call-fab">Call</span>
            </button>`
            )
            .join("")}</div>`
          : `<div class="empty hero-empty">
              <div class="empty-visual">${phoneSvg()}</div>
              <strong>No approved contacts yet</strong>
              <p>Invite a relative, add each other, then kids only see people you trust — same idea as Ring Ring / Tin Can.</p>
              <button class="primary" id="empty-invite">Send an invite</button>
            </div>`
      }
      ${dockHtml("phone")}
    </div>
  `;

  if (state.flash) setTimeout(() => { state.flash = ""; }, 5000);
  if (state.celebrate) {
    setTimeout(() => {
      state.celebrate = "";
      document.querySelector(".celebrate-banner")?.remove();
    }, 4200);
  }

  bindDock();
  document.getElementById("settings").onclick = () => {
    state.screen = "settings";
    render();
  };
  document.getElementById("invite").onclick = () => {
    state.screen = "invite";
    render();
  };
  document.getElementById("empty-invite")?.addEventListener("click", () => {
    state.screen = "invite";
    render();
  });
  document.getElementById("add-contact").onclick = () => {
    state.screen = "add-contact";
    render();
  };
  document.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => {
      state.screen = "add-contact";
      render();
    };
  });
  document.querySelectorAll("[data-call]").forEach((btn) => {
    btn.onclick = () => placeCall(btn.getAttribute("data-call"));
  });

  if (!state.presenceTimer) {
    state.presenceTimer = setInterval(async () => {
      if (!state.sessionId || state.call || state.screen !== "home") return;
      try {
        const data = await api("/api/me");
        state.directory = data.directory || [];
        state.households = data.households || [];
        render();
      } catch {}
    }, 12000);
  }
}

function renderActivity() {
  const hh = state.households[0];
  const contacts = hh?.allowlist || [];
  const logs = hh?.call_logs || [];
  app.innerHTML = `
    <div class="app-shell">
      <div class="topbar"><div class="mark">Activity</div><span style="width:40px"></span></div>
      <p class="lede tight">Calls, misses, and blocked attempts — parent visibility like the paid clubs.</p>
      <div class="stat-row">
        <div class="stat"><strong>${logs.filter((l) => l.outcome === "completed").length}</strong><span>Completed</span></div>
        <div class="stat"><strong>${logs.filter((l) => l.outcome === "missed").length}</strong><span>Missed</span></div>
        <div class="stat"><strong>${logs.filter((l) => l.outcome === "blocked").length}</strong><span>Blocked</span></div>
      </div>
      <div class="recent-list tall">
        ${
          logs.length
            ? logs
                .map((log) => {
                  const other =
                    log.from_line_id === state.activeLineId ? log.to_line_id : log.from_line_id;
                  const inbound = log.to_line_id === state.activeLineId;
                  const name =
                    contacts.find((c) => c.target_line_id === other)?.label || lineName(other);
                  return `<div class="recent-row">
                    ${avatarHtml(name, other, "sm")}
                    <div>
                      <strong>${inbound ? "Incoming" : "Outgoing"} · ${name}</strong>
                      <small>${outcomeLabel(log.outcome)} · ${formatCallWhen(log.started_at)}</small>
                    </div>
                  </div>`;
                })
                .join("")
            : `<div class="empty">No activity yet. First calls show up here.</div>`
        }
      </div>
      ${dockHtml("activity")}
    </div>`;
  bindDock();
}

function renderVoicemail() {
  const hh = state.households[0];
  const vms = hh?.voicemails || [];
  app.innerHTML = `
    <div class="app-shell">
      <div class="topbar"><div class="mark">Voicemail</div><span style="width:40px"></span></div>
      <p class="lede tight">Family voicemail inbox. Audio drop-offs from hardware landlines come in Stage 2 — notes work now.</p>
      <div class="vm-list">
        ${
          vms.length
            ? vms
                .map(
                  (v) => `
            <button class="vm-card ${v.listened ? "" : "unread"}" data-vm="${v.id}" type="button">
              <div class="vm-top"><strong>${v.from_label || "Family"}</strong><small>${formatCallWhen(v.created_at)}</small></div>
              <p>${v.body}</p>
            </button>`
                )
                .join("")
            : `<div class="empty hero-empty"><strong>Inbox zero</strong><p>When cousins leave a message, it’ll land here.</p></div>`
        }
      </div>
      ${dockHtml("voicemail")}
    </div>`;
  bindDock();
  document.querySelectorAll("[data-vm]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/households/${hh.id}/voicemails/${btn.getAttribute("data-vm")}/listen`, {
        method: "POST",
        body: "{}",
      });
      await refresh();
    };
  });
}

function renderControls() {
  const hh = state.households[0];
  const preset = hh.schedule_preset || "open";
  const cap = hh.daily_cap_minutes;
  const used = hh.usage_today_minutes || 0;
  app.innerHTML = `
    <div class="app-shell">
      <div class="topbar"><div class="mark">Parent controls</div><span style="width:40px"></span></div>
      <p class="lede tight">Pause, schedules, daily caps, PIN — the dashboard relatives expect from Ring Ring / Tin Can / Pinwheel.</p>

      <div class="sheet control-card">
        <h2>Phone power</h2>
        <p>Instant pause for the whole household softphone.</p>
        <button class="${hh.kill_switch ? "danger" : "primary"}" id="toggle-kill">${hh.kill_switch ? "Resume phone" : "Pause phone"}</button>
      </div>

      <div class="sheet control-card">
        <h2>Schedule modes</h2>
        <p>One-tap quiet windows in your timezone.</p>
        <div class="preset-grid">
          ${["open", "bedtime", "school"]
            .map(
              (p) =>
                `<button type="button" class="preset ${preset === p ? "on" : ""}" data-preset="${p}">${p === "open" ? "Open" : p === "bedtime" ? "Bedtime" : "School"}</button>`
            )
            .join("")}
        </div>
        <button class="ghost" id="custom-quiet" style="margin-top:10px">Custom quiet hours…</button>
      </div>

      <div class="sheet control-card">
        <h2>Daily talk limit</h2>
        <p>Used today: <strong>${used} min</strong>${cap != null ? ` / ${cap} min` : " · unlimited"}</p>
        <label>Minutes per day (blank = unlimited)</label>
        <input id="cap" type="number" min="0" step="5" placeholder="e.g. 60" value="${cap ?? ""}" />
        <button class="primary" id="save-cap">Save limit</button>
      </div>

      <div class="sheet control-card">
        <h2>Parent PIN</h2>
        <p>${hh.has_parent_pin ? "PIN is on — required to open Controls." : "Lock Controls so kids can’t change rules."}</p>
        <label>Set 4–6 digit PIN</label>
        <input id="pin" class="mono" inputmode="numeric" maxlength="6" placeholder="····" />
        <div class="btn-row two">
          <button class="primary" id="save-pin">Save PIN</button>
          <button class="ghost" id="clear-pin">Remove PIN</button>
        </div>
      </div>

      <div class="sheet control-card">
        <h2>Outside lines</h2>
        <p class="tiny">Cell / landline / 911 via SIP trunk is a paid add-on (Stage 3) — same split the commercial kits use. Network-to-network family calling is free here.</p>
      </div>
      ${dockHtml("controls")}
    </div>`;

  bindDock();
  document.getElementById("toggle-kill").onclick = async () => {
    await api(`/api/households/${hh.id}/rules`, {
      method: "PATCH",
      body: JSON.stringify({ kill_switch: !hh.kill_switch }),
    });
    state.flash = hh.kill_switch ? "Phone resumed" : "Phone paused";
    await refresh();
  };
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.onclick = async () => {
      const body = {
        schedule_preset: btn.getAttribute("data-preset"),
        quiet_tz: hh.quiet_tz || browserTimeZone(),
      };
      await api(`/api/households/${hh.id}/rules`, { method: "PATCH", body: JSON.stringify(body) });
      state.flash = "Schedule updated";
      await refresh();
    };
  });
  document.getElementById("custom-quiet").onclick = () => {
    state.screen = "quiet";
    render();
  };
  document.getElementById("save-cap").onclick = async () => {
    const raw = document.getElementById("cap").value.trim();
    const daily_cap_minutes = raw === "" ? null : Number(raw);
    await api(`/api/households/${hh.id}/rules`, {
      method: "PATCH",
      body: JSON.stringify({ daily_cap_minutes }),
    });
    state.flash = "Daily limit saved";
    await refresh();
  };
  document.getElementById("save-pin").onclick = async () => {
    const parent_pin = document.getElementById("pin").value.trim();
    await api(`/api/households/${hh.id}/rules`, {
      method: "PATCH",
      body: JSON.stringify({ parent_pin }),
    });
    state.parentUnlocked = true;
    sessionStorage.setItem("kl_parent_ok", "1");
    state.flash = "Parent PIN saved";
    await refresh();
  };
  document.getElementById("clear-pin").onclick = async () => {
    await api(`/api/households/${hh.id}/rules`, {
      method: "PATCH",
      body: JSON.stringify({ parent_pin: null }),
    });
    state.flash = "PIN removed";
    await refresh();
  };
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatQuietClock(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function quietSummary(hh) {
  if (!hh?.quiet_start || !hh?.quiet_end) return "Quiet hours";
  const tz = (hh.quiet_tz || "").split("/").pop()?.replace(/_/g, " ") || "local";
  return `${formatQuietClock(hh.quiet_start)}–${formatQuietClock(hh.quiet_end)} · ${tz}`;
}

function timezoneOptions(selected) {
  const detected = browserTimeZone();
  const zones = [
    detected,
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Anchorage",
    "Pacific/Honolulu",
    "UTC",
  ];
  const unique = [...new Set(zones.filter(Boolean))];
  if (selected && !unique.includes(selected)) unique.unshift(selected);
  return unique
    .map((z) => `<option value="${z}" ${z === selected ? "selected" : ""}>${z === detected ? `${z} (this device)` : z}</option>`)
    .join("");
}

function renderQuietHours() {
  const hh = state.households[0];
  const enabled = Boolean(hh?.quiet_start && hh?.quiet_end);
  const start = hh?.quiet_start || "21:00";
  const end = hh?.quiet_end || "07:00";
  const tz = hh?.quiet_tz || browserTimeZone();

  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back">←</button>
      <div class="mark">Quiet hours</div>
      <span style="width:40px"></span>
    </div>
    <div class="sheet">
      <h2>Your family’s quiet window</h2>
      <p>Calls are blocked during this window in <strong>your</strong> timezone — not the host’s server clock.</p>
      <label class="check-row">
        <input type="checkbox" id="q-on" ${enabled ? "checked" : ""} />
        <span>Enable quiet hours</span>
      </label>
      <div id="q-fields" class="${enabled ? "" : "hidden"}">
        <label>Starts</label>
        <input type="time" id="q-start" value="${start}" />
        <label>Ends</label>
        <input type="time" id="q-end" value="${end}" />
        <label>Timezone</label>
        <select id="q-tz">${timezoneOptions(tz)}</select>
        <p class="tiny">Detected on this phone as ${browserTimeZone()}. Cousins should set their own window in their timezone.</p>
      </div>
      <p class="error hidden" id="q-err"></p>
      <button class="primary" id="q-save">Save</button>
    </div>
  `;

  const fields = document.getElementById("q-fields");
  document.getElementById("q-on").onchange = (e) => {
    fields.classList.toggle("hidden", !e.target.checked);
  };
  document.getElementById("back").onclick = () => {
    state.screen = "home";
    render();
  };
  document.getElementById("q-save").onclick = async () => {
    const err = document.getElementById("q-err");
    err.classList.add("hidden");
    try {
      const on = document.getElementById("q-on").checked;
      const body = on
        ? {
            quiet_start: document.getElementById("q-start").value,
            quiet_end: document.getElementById("q-end").value,
            quiet_tz: document.getElementById("q-tz").value,
          }
        : { quiet_start: null, quiet_end: null };
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      state.flash = on ? "Quiet hours saved" : "Quiet hours off";
      state.screen = "home";
      await refresh();
    } catch (e) {
      err.textContent = e.message || "Could not save";
      err.classList.remove("hidden");
    }
  };
}

async function renderInvite() {
  const hh = state.households[0];
  let sharePayload = null;
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back">←</button>
      <div class="mark">Invite</div>
      <span style="width:40px"></span>
    </div>
    <div class="invite-hero sheet">
      <p class="invite-eyebrow">Family pass</p>
      <h2>Invite someone you trust</h2>
      <p>They open the same link, type this code, and join your private network — no VPN, no app store.</p>
      <div class="code-box glow" id="code">······</div>
      <p class="tiny center" id="url"></p>
      <div class="btn-row">
        <button class="primary" id="share">Share invite</button>
        <button class="ghost" id="copy">Copy link</button>
      </div>
      <button class="linkish" id="refresh-inv">Make a new code</button>
    </div>
    <div class="sheet tip-sheet">
      <h2>What to tell them</h2>
      <ol class="how-list">
        <li>Open the link on their phone</li>
        <li>Tap <em>I was invited</em></li>
        <li>Enter the code, then add each other as contacts</li>
      </ol>
    </div>
  `;
  document.getElementById("back").onclick = () => {
    state.screen = "home";
    render();
  };

  async function loadInvite() {
    const data = await api(`/api/households/${hh.id}/invites`, { method: "POST", body: "{}" });
    sharePayload = data;
    document.getElementById("code").textContent = data.invite.code;
    document.getElementById("url").textContent = data.shareUrl;
  }

  document.getElementById("copy").onclick = async () => {
    if (!sharePayload) return;
    const text = `${sharePayload.shareText}\n${sharePayload.shareUrl}`;
    await navigator.clipboard.writeText(text);
    state.flash = "Invite copied — send it to them";
    state.screen = "home";
    render();
  };
  document.getElementById("share").onclick = async () => {
    if (!sharePayload) return;
    const text = `${sharePayload.shareText}\n${sharePayload.shareUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Kids Landline invite",
          text: sharePayload.shareText,
          url: sharePayload.shareUrl,
        });
        state.flash = "Invite sent";
        state.screen = "home";
        render();
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(text);
    state.flash = "Invite copied — paste it in a text";
    state.screen = "home";
    render();
  };
  document.getElementById("refresh-inv").onclick = loadInvite;
  await loadInvite();
}

function renderAddContact() {
  const hh = state.households[0];
  const others = state.directory.filter((d) => d.household_id !== hh.id);
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back">←</button>
      <div class="mark">Add contact</div>
      <span style="width:40px"></span>
    </div>
    <div class="sheet">
      <h2>Who can they call?</h2>
      <p>Both families must add each other. After that, kids only see approved names.</p>
      ${
        others.length
          ? `
        <div class="picker-list" id="picker">
          ${others
            .map(
              (d, i) => `
            <button type="button" class="picker-row ${i === 0 ? "selected" : ""}" data-id="${d.id}">
              ${avatarHtml(d.name, d.id, "md")}
              <span><strong>${d.name}</strong><small>${d.household_name}</small></span>
            </button>`
            )
            .join("")}
        </div>
        <label>Name on your phone</label>
        <input id="label" placeholder="e.g. Maya" value="${others[0] ? others[0].name.replace(/'s phone$/i, "").trim() : ""}" />
        <button class="primary" id="save">Add to contacts</button>`
          : `<div class="empty hero-empty">
              <strong>No other families yet</strong>
              <p>Send an invite first. When they join, they’ll show up here.</p>
              <button class="primary" id="to-invite">Invite someone</button>
            </div>`
      }
    </div>
  `;
  let selectedId = others[0]?.id || "";
  document.getElementById("back").onclick = () => {
    state.screen = "home";
    render();
  };
  document.getElementById("to-invite")?.addEventListener("click", () => {
    state.screen = "invite";
    render();
  });
  document.querySelectorAll(".picker-row").forEach((row) => {
    row.onclick = () => {
      document.querySelectorAll(".picker-row").forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      selectedId = row.getAttribute("data-id");
      const d = others.find((x) => x.id === selectedId);
      if (d) document.getElementById("label").value = d.name.replace(/'s phone$/i, "").trim() || d.name;
    };
  });
  document.getElementById("save")?.addEventListener("click", async () => {
    const selected = others.find((x) => x.id === selectedId);
    await api(`/api/households/${hh.id}/allowlist`, {
      method: "POST",
      body: JSON.stringify({
        targetLineId: selectedId,
        label: document.getElementById("label").value || selected?.name || "Contact",
      }),
    });
    state.flash = "Contact added — they need to add you too";
    state.screen = "home";
    await refresh();
  });
}

function renderSettings() {
  const hh = state.households[0];
  const lines = hh?.lines || [];
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back">←</button>
      <div class="mark">Settings</div>
      <span style="width:40px"></span>
    </div>
    <div class="sheet">
      <h2>This phone</h2>
      <label>Active line</label>
      <select id="line">${lines.map((l) => `<option value="${l.id}" ${l.id === state.activeLineId ? "selected" : ""}>${l.name}</option>`).join("")}</select>
      <p class="tiny">Calls use this line’s identity on the network.</p>
    </div>
    <div class="sheet" style="margin-top:12px">
      <h2>Quiet hours</h2>
      <p>${quietSummary(hh)}${hh?.quiet_tz ? ` · ${hh.quiet_tz}` : ""}</p>
      <button class="ghost" id="edit-quiet">Customize quiet hours</button>
    </div>
    <div class="sheet" style="margin-top:12px">
      <h2>Help</h2>
      <p>Replay the intro if you want a refresher.</p>
      <button class="ghost" id="tutorial">Show tutorial</button>
    </div>
    <div class="sheet" style="margin-top:12px">
      <button class="ghost" id="logout">Sign out</button>
    </div>
  `;
  document.getElementById("back").onclick = () => {
    state.screen = "home";
    render();
  };
  document.getElementById("line").onchange = () => {
    state.activeLineId = document.getElementById("line").value;
    localStorage.setItem("kl_line", state.activeLineId);
    if (state.ws) state.ws.close();
    ensureWs();
  };
  document.getElementById("edit-quiet").onclick = () => {
    state.screen = "quiet";
    render();
  };
  document.getElementById("tutorial").onclick = () => {
    state.tutorialFromSettings = true;
    state.tutorialIndex = 0;
    state.screen = "tutorial";
    render();
  };
  document.getElementById("logout").onclick = async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.sessionId = "";
    state.user = null;
    state.households = [];
    localStorage.removeItem("kl_session");
    localStorage.removeItem("kl_line");
    state.screen = "welcome";
    render();
  };
}

function render() {
  if (state.screen === "splash") renderSplash();
  else if (state.screen === "tutorial") renderTutorial();
  else if (state.screen === "welcome") renderWelcome();
  else if (state.screen === "host") renderHost();
  else if (state.screen === "join") renderJoin();
  else if (!state.user) renderWelcome();
  else if (state.screen === "invite") renderInvite();
  else if (state.screen === "add-contact") renderAddContact();
  else if (state.screen === "quiet") renderQuietHours();
  else if (state.screen === "settings") renderSettings();
  else renderHome();
  paintCallLayer();
}

async function boot() {
  if (state.sessionId) {
    try {
      await refresh();
      return;
    } catch {
      state.sessionId = "";
      localStorage.removeItem("kl_session");
      localStorage.removeItem("kl_line");
    }
  }
  const invite = new URLSearchParams(location.search).get("invite");
  // Invite deep-links skip splash but still offer tutorial if never seen
  if (invite) {
    state.mode = "join";
    if (localStorage.getItem(TUTORIAL_KEY) === "1") {
      state.screen = "join";
    } else {
      state.tutorialIndex = 0;
      state.screen = "tutorial";
    }
  } else {
    state.screen = "splash";
  }
  render();
}

boot();
