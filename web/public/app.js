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
  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sessionId: state.sessionId,
        lineId: state.activeLineId,
      })
    );
  };
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "call.offer") await onIncomingOffer(msg);
    if (msg.type === "call.answer") await onAnswer(msg);
    if (msg.type === "call.ice" && msg.candidate) await addRemoteIce(msg.candidate);
    if (msg.type === "call.hangup") {
      stopRing();
      endCallUi("Call ended");
    }
    if (msg.type === "call.rejected") {
      stopRing();
      state.flash = msg.reason || "Call could not connect";
      endCallUi();
      render();
    }
    if (msg.type === "call.ringing") {
      state.call = { ...(state.call || {}), status: "ringing", callId: msg.callId };
      paintCallLayer();
    }
  };
  ws.onclose = () => setTimeout(ensureWs, 1500);
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
  if (!state.pc) return;
  if (!state.remoteReady) {
    state.pendingIce.push(candidate);
    return;
  }
  try {
    await state.pc.addIceCandidate(candidate);
  } catch {}
}

async function flushIce() {
  state.remoteReady = true;
  const queued = state.pendingIce.splice(0);
  for (const c of queued) {
    try {
      await state.pc.addIceCandidate(c);
    } catch {}
  }
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 440;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.25);
    };
    beep();
    state.ringTimer = setInterval(beep, 2000);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
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
  state.pendingIce = [];
  state.remoteReady = false;
  state.iceState = "starting";
  state.muted = false;
  const pc = new RTCPeerConnection({ iceServers: await iceServers() });
  state.pc = pc;
  state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  for (const track of state.localStream.getTracks()) pc.addTrack(track, state.localStream);

  pc.ontrack = (ev) => {
    const audio = remoteAudio();
    if (audio) {
      audio.srcObject = ev.streams[0];
      audio.play().catch(() => {});
    }
  };
  pc.onicecandidate = (ev) => {
    if (!ev.candidate || !state.ws) return;
    state.ws.send(
      JSON.stringify({
        type: "call.ice",
        fromLineId: state.activeLineId,
        toLineId: peer,
        candidate: ev.candidate,
      })
    );
  };
  pc.onconnectionstatechange = () => {
    state.iceState = pc.connectionState;
    if (pc.connectionState === "connected") {
      if (state.call && state.call.status !== "active") {
        state.call = { ...state.call, status: "active" };
      }
      if (!state.callStartedAt) {
        state.callStartedAt = Date.now();
        startCallTicker();
      }
      paintCallLayer();
    }
    if (pc.connectionState === "failed") {
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
  state.call = { status: "calling", toLineId, fromLineId: state.activeLineId };
  paintCallLayer();
  try {
    await requestWakeLock();
    const pc = await makePc(toLineId);
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    if (!state.ws || state.ws.readyState !== 1) throw new Error("Not connected to the network yet — wait a second and try again");
    state.ws.send(
      JSON.stringify({
        type: "call.offer",
        fromLineId: state.activeLineId,
        toLineId,
        sdp: offer,
      })
    );
  } catch (e) {
    state.flash = e.message || "Microphone permission needed";
    endCallUi();
    render();
  }
}

async function onIncomingOffer(msg) {
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
    await pc.setRemoteDescription(msg.sdp);
    await flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.ws.send(
      JSON.stringify({
        type: "call.answer",
        callId: msg.callId,
        fromLineId: msg.fromLineId,
        toLineId: msg.toLineId,
        sdp: answer,
      })
    );
    state.call = { ...msg, status: "connecting" };
    paintCallLayer();
  } catch (e) {
    state.flash = e.message || "Could not answer";
    hangup();
    render();
  }
}

async function onAnswer(msg) {
  if (!state.pc) return;
  await state.pc.setRemoteDescription(msg.sdp);
  await flushIce();
  state.call = { ...(state.call || {}), status: "connecting", callId: msg.callId };
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

function dots(n, active) {
  return `<div class="step-dots">${Array.from({ length: n }, (_, i) => `<span class="${i === active ? "on" : ""}"></span>`).join("")}</div>`;
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
        ? "On a call"
        : status === "connecting"
          ? "Connecting…"
          : status === "ringing"
            ? "Ringing…"
            : "Calling…";
  const who = contactLabel(state.call);
  const house = householdName(
    state.call.fromLineId === state.activeLineId ? state.call.toLineId : state.call.fromLineId
  );
  const timer =
    state.callStartedAt && (status === "active" || status === "connecting")
      ? formatDuration(Date.now() - state.callStartedAt)
      : status === "active" || status === "connecting"
        ? "0:00"
        : "";
  const mediaHint =
    state.iceState === "connected"
      ? "Connected"
      : state.iceState === "disconnected"
        ? "Reconnecting…"
        : status === "connecting" || status === "active"
          ? "Setting up voice…"
          : "";

  root.innerHTML = `
    <div id="call-layer">
      <div class="call-card">
        <p class="call-kicker">${title}</p>
        <h2 class="call-who">${who}</h2>
        ${house ? `<p class="call-house">${house}</p>` : ""}
        ${timer ? `<p class="call-timer" id="call-timer">${timer}</p>` : ""}
        ${mediaHint ? `<p class="call-media">${mediaHint}</p>` : ""}
        <div class="call-actions ${status === "incoming" ? "incoming" : status === "active" || status === "connecting" ? "in-call" : ""}">
          ${status === "incoming" ? `<button class="primary call-answer" id="accept">Answer</button>` : ""}
          ${(status === "active" || status === "connecting") ? `<button class="ghost" id="mute">${state.muted ? "Unmute" : "Mute"}</button>` : ""}
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
    <p class="lede">Private calls for families you trust. No strangers. No feeds. Just talk.</p>
    <div class="sheet">
      <h2>Get started</h2>
      <p>You’ll use a short code — no app store, no VPN for cousins.</p>
      <div class="btn-row">
        <button class="primary" id="go-host">I’m hosting this family network</button>
        <button class="ghost" id="go-join">I was invited</button>
      </div>
      ${invite ? `<p class="tiny" style="margin-top:14px">Invite code ready: <strong style="letter-spacing:0.12em">${invite}</strong></p>` : ""}
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

function renderHome() {
  const hh = state.households[0];
  const contacts = (hh?.allowlist || []).map((a) => ({
    ...a,
    online: state.directory.find((d) => d.id === a.target_line_id)?.online,
  }));

  app.innerHTML = `
    <div class="topbar">
      <div>
        <div class="mark">Kids Landline</div>
        <div class="who">${hh?.name || ""} · ${state.user.display_name}</div>
      </div>
      <button class="icon-btn" id="settings" title="Settings">⚙</button>
    </div>

    ${state.flash ? `<p class="error">${state.flash}</p>` : ""}

    <div class="stack" style="grid-template-columns:1fr 1fr;display:grid;gap:10px;margin-bottom:8px">
      <button class="ghost" id="invite" style="width:100%">Invite</button>
      <button class="ghost" id="add-contact" style="width:100%">Add contact</button>
    </div>

    <div class="section-title">Contacts you can call</div>
    ${
      contacts.length
        ? contacts
            .map(
              (c) => `
        <div class="contact">
          <div>
            <strong>${c.label}</strong>
            <small>${lineName(c.target_line_id)} · ${householdName(c.target_line_id)}</small>
          </div>
          <div class="stack" style="justify-items:end">
            <span class="pill ${c.online ? "on" : ""}"><span class="dot"></span>${c.online ? "Online" : "Away"}</span>
            <button class="primary call" data-call="${c.target_line_id}">Call</button>
          </div>
        </div>`
            )
            .join("")
        : `<div class="empty">No contacts yet.<br/>Invite a family, then tap <strong>Add contact</strong>.</div>`
    }

    <div class="section-title">Safety</div>
    <div class="sheet" style="padding:14px">
      <div class="btn-row two">
        <button class="ghost" id="toggle-kill">${hh.kill_switch ? "Kill switch ON" : "Kill switch"}</button>
        <button class="ghost" id="quiet">${quietSummary(hh)}</button>
      </div>
      <p class="tiny" style="margin:12px 0 0">Only allowlisted people can ring you. Keep this tab open to receive calls.</p>
    </div>
  `;

  if (state.flash) {
    setTimeout(() => {
      state.flash = "";
    }, 5000);
  }

  document.getElementById("settings").onclick = () => {
    state.screen = "settings";
    render();
  };
  document.getElementById("invite").onclick = () => {
    state.screen = "invite";
    render();
  };
  document.getElementById("add-contact").onclick = () => {
    state.screen = "add-contact";
    render();
  };
  document.querySelectorAll("[data-call]").forEach((btn) => {
    btn.onclick = () => placeCall(btn.getAttribute("data-call"));
  });
  document.getElementById("toggle-kill").onclick = async () => {
    await api(`/api/households/${hh.id}/rules`, {
      method: "PATCH",
      body: JSON.stringify({ kill_switch: !hh.kill_switch }),
    });
    await refresh();
  };
  document.getElementById("quiet").onclick = () => {
    state.screen = "quiet";
    render();
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
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back">←</button>
      <div class="mark">Invite</div>
      <span style="width:40px"></span>
    </div>
    <div class="sheet">
      <h2>Invite another family</h2>
      <p>Send them this code. They open the same website — no VPN.</p>
      <div class="code-box" id="code">······</div>
      <p class="tiny" id="url"></p>
      <div class="btn-row">
        <button class="primary" id="copy">Copy invite</button>
        <button class="ghost" id="refresh-inv">New code</button>
      </div>
    </div>
  `;
  document.getElementById("back").onclick = () => {
    state.screen = "home";
    render();
  };

  async function loadInvite() {
    const data = await api(`/api/households/${hh.id}/invites`, { method: "POST", body: "{}" });
    document.getElementById("code").textContent = data.invite.code;
    document.getElementById("url").textContent = data.shareUrl;
    document.getElementById("copy").onclick = async () => {
      await navigator.clipboard.writeText(`${data.shareText}\n${data.shareUrl}`);
      state.flash = "Invite copied";
      state.screen = "home";
      render();
    };
  }
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
      <p>Pick a line from families on this network. Both sides must add each other.</p>
      ${
        others.length
          ? `
        <label>Line</label>
        <select id="dir">${others.map((d) => `<option value="${d.id}">${d.name} — ${d.household_name}</option>`).join("")}</select>
        <label>Label on your phone</label>
        <input id="label" placeholder="e.g. Maya" value="${others[0] ? others[0].name.replace(/'s phone$/i, "").trim() : ""}" />
        <button class="primary" id="save">Add to contacts</button>`
          : `<div class="empty">No other families yet. Send an invite first.</div>`
      }
    </div>
  `;
  document.getElementById("back").onclick = () => {
    state.screen = "home";
    render();
  };
  document.getElementById("dir")?.addEventListener("change", () => {
    const d = others.find((x) => x.id === document.getElementById("dir").value);
    if (d) document.getElementById("label").value = d.name.replace(/'s phone$/i, "").trim() || d.name;
  });
  document.getElementById("save")?.addEventListener("click", async () => {
    const selected = others.find((x) => x.id === document.getElementById("dir").value);
    await api(`/api/households/${hh.id}/allowlist`, {
      method: "POST",
      body: JSON.stringify({
        targetLineId: document.getElementById("dir").value,
        label: document.getElementById("label").value || selected?.name || "Contact",
      }),
    });
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
