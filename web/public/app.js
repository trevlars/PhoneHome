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
  boot: null,
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
    if (msg.type === "call.hangup") endCallUi("ended");
    if (msg.type === "call.rejected") {
      state.error = msg.reason || "Call rejected";
      endCallUi("rejected");
      render();
    }
    if (msg.type === "call.ringing") {
      state.call = { ...(state.call || {}), status: "ringing", callId: msg.callId };
      render();
    }
  };
  ws.onclose = () => {
    setTimeout(ensureWs, 1500);
  };
}

async function refresh() {
  const data = await api("/api/me");
  state.user = data.user;
  state.households = data.households || [];
  state.directory = data.directory || [];
  if (!state.activeLineId) {
    const line = state.households.flatMap((h) => h.lines).find((l) => l.type === "softphone");
    if (line) {
      state.activeLineId = line.id;
      localStorage.setItem("kl_line", line.id);
    }
  }
  ensureWs();
  render();
}

async function iceServers() {
  // Public STUN for Stage 1 lab; production should inject TURN from server
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

async function makePc(isCaller, peer) {
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
  state.error = "";
  state.call = { status: "calling", toLineId, fromLineId: state.activeLineId };
  render();
  const pc = await makePc(true, toLineId);
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
  const pc = await makePc(false, msg.fromLineId);
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
  endCallUi("ended");
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
  return d ? `${d.name} (${d.household_name})` : id;
}

function renderAuth() {
  const params = new URLSearchParams(location.search);
  const invite = params.get("invite") || "";
  app.innerHTML = `
    <h1>Kids Landline</h1>
    <p class="sub">Private family softphones. Allowlisted calls only. No VPN for cousins.</p>
    <div class="card">
      <h2>Host / returning parent</h2>
      <label>Setup code</label>
      <input id="code" class="mono" inputmode="numeric" placeholder="6-digit code" />
      <label>Display name</label>
      <input id="name" placeholder="Your name" />
      <div class="error" id="err"></div>
      <button id="login">Sign in</button>
    </div>
    <div class="card">
      <h2>New parent on this server</h2>
      <label>Display name</label>
      <input id="reg-name" placeholder="Other parent's name" />
      <button class="secondary" id="register">Create parent account</button>
      <p class="sub" id="reg-out"></p>
    </div>
    ${
      invite
        ? `<div class="card"><h2>Invite waiting</h2><p class="sub">After sign-in, redeem code <span class="mono">${invite}</span></p></div>`
        : ""
    }
  `;
  document.getElementById("login").onclick = async () => {
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
      document.getElementById("err").textContent = e.message;
    }
  };
  document.getElementById("register").onclick = async () => {
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ displayName: document.getElementById("reg-name").value.trim() }),
      });
      state.sessionId = data.sessionId;
      localStorage.setItem("kl_session", data.sessionId);
      document.getElementById("reg-out").textContent = `Save your setup code: ${data.setupCode}`;
      await refresh();
    } catch (e) {
      document.getElementById("reg-out").textContent = e.message;
    }
  };
}

function render() {
  if (!state.sessionId || !state.user) return renderAuth();
  const hh = state.households[0];
  const params = new URLSearchParams(location.search);
  const inviteCode = params.get("invite") || "";
  const myLines = state.households.flatMap((h) => h.lines);
  const contacts = (hh?.allowlist || []).map((a) => ({
    ...a,
    online: state.directory.find((d) => d.id === a.target_line_id)?.online,
  }));

  app.innerHTML = `
    <audio id="remote-audio" autoplay playsinline></audio>
    <h1>Kids Landline</h1>
    <p class="sub">Signed in as ${state.user.display_name}</p>
    ${
      state.call
        ? `<div id="call-banner">
            <strong>${state.call.status === "incoming" ? "Incoming call" : "Call"}</strong>
            <div class="sub">${lineName(state.call.fromLineId || state.call.toLineId)}</div>
            <div class="row" style="margin-top:10px">
              ${
                state.call.status === "incoming"
                  ? `<button id="accept">Answer</button>`
                  : ""
              }
              <button class="danger" id="hangup">Hang up</button>
            </div>
          </div>`
        : ""
    }
    ${state.error ? `<p class="error">${state.error}</p>` : ""}

    ${
      !hh
        ? `<div class="card">
            <h2>Create household</h2>
            <input id="hh-name" placeholder="Family name" />
            <button id="create-hh">Create</button>
          </div>
          <div class="card">
            <h2>Or redeem invite</h2>
            <input id="inv-code" class="mono" value="${inviteCode}" placeholder="Invite code" />
            <input id="inv-hh" placeholder="Your family name" />
            <button id="redeem">Accept invite</button>
          </div>`
        : `
          <div class="card">
            <h2>${hh.name}</h2>
            <div class="row">
              <span class="pill ${hh.kill_switch ? "on" : ""}">Kill switch ${hh.kill_switch ? "ON" : "off"}</span>
              <span class="pill">${hh.quiet_start && hh.quiet_end ? `Quiet ${hh.quiet_start}–${hh.quiet_end}` : "No quiet hours"}</span>
            </div>
            <div class="row" style="margin-top:12px">
              <button class="secondary" id="toggle-kill">${hh.kill_switch ? "Disable kill switch" : "Enable kill switch"}</button>
              <button class="secondary" id="set-quiet">Quiet 21:00–07:00</button>
              <button class="secondary" id="clear-quiet">Clear quiet hours</button>
            </div>
          </div>

          <div class="card">
            <h2>Your softphone line</h2>
            <label>Active line</label>
            <select id="line-select">
              ${myLines.map((l) => `<option value="${l.id}" ${l.id === state.activeLineId ? "selected" : ""}>${l.name} (${l.type})</option>`).join("")}
            </select>
            <div class="row">
              <input id="line-name" placeholder="New line name" style="flex:1;margin:0" />
              <button id="add-line">Add softphone</button>
            </div>
          </div>

          <div class="card">
            <h2>Invite family</h2>
            <button id="invite">Create invite code</button>
            <p class="sub mono" id="invite-out"></p>
          </div>

          <div class="card">
            <h2>Allowlist contacts</h2>
            <label>Add line from directory</label>
            <select id="dir-select">
              ${state.directory
                .filter((d) => d.household_id !== hh.id)
                .map((d) => `<option value="${d.id}">${d.name} — ${d.household_name}</option>`)
                .join("")}
            </select>
            <input id="al-label" placeholder="Label (e.g. Maya kitchen)" />
            <button id="add-al">Add to allowlist</button>
            <div style="margin-top:12px">
              ${contacts
                .map(
                  (c) => `<div class="contact">
                    <div>
                      <div>${c.label}</div>
                      <div class="meta">${lineName(c.target_line_id)}</div>
                    </div>
                    <div class="row">
                      <span class="pill ${c.online ? "on" : ""}">${c.online ? "online" : "offline"}</span>
                      <button data-call="${c.target_line_id}">Call</button>
                      <button class="secondary" data-del="${c.id}">Remove</button>
                    </div>
                  </div>`
                )
                .join("") || `<p class="sub">No contacts yet — invite a family, then allowlist their line.</p>`}
            </div>
          </div>

          <div class="card">
            <h2>Recent calls</h2>
            ${(hh.call_logs || [])
              .slice(0, 8)
              .map(
                (c) =>
                  `<div class="meta">${c.started_at.slice(0, 19)} · ${c.outcome} · ${c.from_line_id.slice(0, 8)}→${c.to_line_id.slice(0, 8)}</div>`
              )
              .join("") || `<p class="sub">No calls yet</p>`}
          </div>
        `
    }

    <div class="row">
      <button class="secondary" id="logout">Sign out</button>
      <button class="secondary" id="reload">Refresh</button>
    </div>
  `;

  const byId = (id) => document.getElementById(id);
  byId("logout").onclick = async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.sessionId = "";
    localStorage.removeItem("kl_session");
    renderAuth();
  };
  byId("reload").onclick = () => refresh();
  if (byId("hangup")) byId("hangup").onclick = hangup;
  if (byId("accept")) byId("accept").onclick = acceptCall;

  if (byId("create-hh")) {
    byId("create-hh").onclick = async () => {
      await api("/api/households", {
        method: "POST",
        body: JSON.stringify({ name: byId("hh-name").value }),
      });
      await refresh();
    };
  }
  if (byId("redeem")) {
    byId("redeem").onclick = async () => {
      await api("/api/invites/redeem", {
        method: "POST",
        body: JSON.stringify({
          code: byId("inv-code").value.trim(),
          householdName: byId("inv-hh").value.trim(),
        }),
      });
      history.replaceState({}, "", "/");
      await refresh();
    };
  }
  if (byId("add-line")) {
    byId("add-line").onclick = async () => {
      const line = (
        await api(`/api/households/${hh.id}/lines`, {
          method: "POST",
          body: JSON.stringify({ name: byId("line-name").value || "Softphone", type: "softphone" }),
        })
      ).line;
      state.activeLineId = line.id;
      localStorage.setItem("kl_line", line.id);
      await refresh();
      ensureWs();
    };
  }
  if (byId("line-select")) {
    byId("line-select").onchange = () => {
      state.activeLineId = byId("line-select").value;
      localStorage.setItem("kl_line", state.activeLineId);
      if (state.ws) state.ws.close();
      ensureWs();
    };
  }
  if (byId("invite")) {
    byId("invite").onclick = async () => {
      const data = await api(`/api/households/${hh.id}/invites`, { method: "POST", body: "{}" });
      byId("invite-out").textContent = `${data.invite.code} — ${data.shareUrl}`;
    };
  }
  if (byId("add-al")) {
    byId("add-al").onclick = async () => {
      await api(`/api/households/${hh.id}/allowlist`, {
        method: "POST",
        body: JSON.stringify({
          targetLineId: byId("dir-select").value,
          label: byId("al-label").value || "Contact",
        }),
      });
      await refresh();
    };
  }
  if (byId("toggle-kill")) {
    byId("toggle-kill").onclick = async () => {
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ kill_switch: !hh.kill_switch }),
      });
      await refresh();
    };
  }
  if (byId("set-quiet")) {
    byId("set-quiet").onclick = async () => {
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ quiet_start: "21:00", quiet_end: "07:00" }),
      });
      await refresh();
    };
  }
  if (byId("clear-quiet")) {
    byId("clear-quiet").onclick = async () => {
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ quiet_start: null, quiet_end: null }),
      });
      await refresh();
    };
  }
  document.querySelectorAll("[data-call]").forEach((btn) => {
    btn.onclick = () => placeCall(btn.getAttribute("data-call"));
  });
  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/households/${hh.id}/allowlist/${btn.getAttribute("data-del")}`, {
        method: "DELETE",
      });
      await refresh();
    };
  });
}

async function boot() {
  state.boot = await api("/api/bootstrap").catch(() => ({ initialized: false }));
  if (state.sessionId) {
    try {
      await refresh();
      return;
    } catch {
      state.sessionId = "";
      localStorage.removeItem("kl_session");
    }
  }
  renderAuth();
}

boot();
