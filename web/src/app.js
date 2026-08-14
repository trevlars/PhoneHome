const app = document.getElementById("app");

const state = {
  sessionId: localStorage.getItem("kl_session") || "",
  user: null,
  households: [],
  directory: [],
  activeLineId: localStorage.getItem("kl_line") || "",
  ws: null,
  pc: null,
  localStream: null,
  call: null,
  error: "",
  screen: "boot", // boot | welcome | host | join | home | invite | settings | add-contact
  mode: "host", // host | join on welcome
  flash: "",
};

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
    if (msg.type === "call.ice" && state.pc && msg.candidate) {
      try {
        await state.pc.addIceCandidate(msg.candidate);
      } catch {}
    }
    if (msg.type === "call.hangup") endCallUi();
    if (msg.type === "call.rejected") {
      state.flash = msg.reason || "Call could not connect";
      endCallUi();
      render();
    }
    if (msg.type === "call.ringing") {
      state.call = { ...(state.call || {}), status: "ringing", callId: msg.callId };
      render();
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
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

async function makePc(peer) {
  const pc = new RTCPeerConnection({ iceServers: await iceServers() });
  state.pc = pc;
  state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  for (const track of state.localStream.getTracks()) pc.addTrack(track, state.localStream);
  const remoteAudio = document.getElementById("remote-audio");
  pc.ontrack = (ev) => {
    if (remoteAudio) {
      remoteAudio.srcObject = ev.streams[0];
      remoteAudio.play().catch(() => {});
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
  return pc;
}

async function placeCall(toLineId) {
  state.flash = "";
  state.call = { status: "calling", toLineId, fromLineId: state.activeLineId };
  render();
  try {
    const pc = await makePc(toLineId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
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
  state.call = {
    status: "incoming",
    fromLineId: msg.fromLineId,
    toLineId: msg.toLineId,
    callId: msg.callId,
    sdp: msg.sdp,
  };
  render();
}

async function acceptCall() {
  const msg = state.call;
  const pc = await makePc(msg.fromLineId);
  await pc.setRemoteDescription(msg.sdp);
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
  state.call = { ...msg, status: "active" };
  render();
}

async function onAnswer(msg) {
  if (!state.pc) return;
  await state.pc.setRemoteDescription(msg.sdp);
  state.call = { ...(state.call || {}), status: "active", callId: msg.callId };
  render();
}

function hangup() {
  if (state.ws && state.call) {
    state.ws.send(
      JSON.stringify({
        type: "call.hangup",
        callId: state.call.callId,
        fromLineId: state.call.fromLineId || state.activeLineId,
        toLineId: state.call.toLineId || state.call.fromLineId,
      })
    );
  }
  endCallUi();
}

function endCallUi() {
  if (state.pc) state.pc.close();
  state.pc = null;
  if (state.localStream) state.localStream.getTracks().forEach((t) => t.stop());
  state.localStream = null;
  state.call = null;
  render();
}

function lineName(id) {
  const d = state.directory.find((x) => x.id === id);
  return d ? d.name : "Contact";
}

function householdName(id) {
  const d = state.directory.find((x) => x.id === id);
  return d ? d.household_name : "";
}

function dots(n, active) {
  return `<div class="step-dots">${Array.from({ length: n }, (_, i) => `<span class="${i === active ? "on" : ""}"></span>`).join("")}</div>`;
}

function callOverlay() {
  if (!state.call) return "";
  const title =
    state.call.status === "incoming"
      ? "Incoming call"
      : state.call.status === "active"
        ? "On a call"
        : state.call.status === "ringing"
          ? "Ringing…"
          : "Calling…";
  const who = lineName(state.call.fromLineId === state.activeLineId ? state.call.toLineId : state.call.fromLineId);
  return `
    <div id="call-layer">
      <div class="sheet">
        <h2>${title}</h2>
        <p>${who}</p>
        <div class="btn-row ${state.call.status === "incoming" ? "two" : ""}">
          ${state.call.status === "incoming" ? `<button class="primary" id="accept">Answer</button>` : ""}
          <button class="danger" id="hangup">Hang up</button>
        </div>
      </div>
    </div>`;
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
      ${invite ? `<p class="tiny" style="margin-top:14px">Invite code ready: <strong class="mono" style="letter-spacing:0.12em;font-size:0.95rem!important">${invite}</strong></p>` : ""}
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
    <audio id="remote-audio" autoplay playsinline></audio>
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
        <button class="ghost" id="quiet">${hh.quiet_start ? "Quiet hours on" : "Quiet 9pm–7am"}</button>
      </div>
      <p class="tiny" style="margin:12px 0 0">Only allowlisted people can ring you. Unknown callers never get through.</p>
    </div>
    ${callOverlay()}
  `;

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
  document.getElementById("hangup")?.addEventListener("click", hangup);
  document.getElementById("accept")?.addEventListener("click", acceptCall);
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
  document.getElementById("quiet").onclick = async () => {
    const on = Boolean(hh.quiet_start);
    await api(`/api/households/${hh.id}/rules`, {
      method: "PATCH",
      body: JSON.stringify(on ? { quiet_start: null, quiet_end: null } : { quiet_start: "21:00", quiet_end: "07:00" }),
    });
    await refresh();
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
        <input id="label" placeholder="e.g. Maya" />
        <button class="primary" id="save">Add to contacts</button>`
          : `<div class="empty">No other families yet. Send an invite first.</div>`
      }
    </div>
  `;
  document.getElementById("back").onclick = () => {
    state.screen = "home";
    render();
  };
  document.getElementById("save")?.addEventListener("click", async () => {
    await api(`/api/households/${hh.id}/allowlist`, {
      method: "POST",
      body: JSON.stringify({
        targetLineId: document.getElementById("dir").value,
        label: document.getElementById("label").value || "Contact",
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
  if (state.screen === "welcome") return renderWelcome();
  if (state.screen === "host") return renderHost();
  if (state.screen === "join") return renderJoin();
  if (!state.user) return renderWelcome();
  if (state.screen === "invite") return renderInvite();
  if (state.screen === "add-contact") return renderAddContact();
  if (state.screen === "settings") return renderSettings();
  return renderHome();
}

async function boot() {
  // Clear stale session if DB was wiped
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
  state.screen = invite ? "join" : "welcome";
  if (invite) state.mode = "join";
  render();
}

boot();
