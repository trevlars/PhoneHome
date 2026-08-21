const app = document.getElementById("app");

const TUTORIAL_KEY = "kl_tutorial_v6";
/** Dismiss only — step done/todo always comes from server household state. */
const SETUP_DISMISS_KEY = "kl_setup_dismissed_v1";
/** Parent dismissed the Analog Phone “what is an adapter?” intro. */
const ATA_INTRO_KEY = "ph_ata_intro_dismissed";
const ATA_SHOP_AMAZON = "https://www.amazon.com/s?k=Grandstream+HT801";
const ATA_SHOP_EBAY = "https://www.ebay.com/sch/i.html?_nkw=Grandstream+HT801";

const TUTORIAL_SLIDES = [
  {
    id: "brand",
    kicker: "PhoneHome",
    title: "The home phone, remixed",
    body: "A real phone for your people — no feeds, no strangers. Softphone or analog. Just rings, voices, and the family circle.",
  },
  {
    id: "lines",
    kicker: "Parent & kid",
    title: "Lines with a face",
    body: "Each line gets a name, picture, and greeting. Parents run the household; kid lines stay simple on purpose.",
  },
  {
    id: "analog",
    kicker: "Analog phone",
    title: "A real handset still works",
    body: "Plug a kid phone into the adapter. Always on — no tablet. Speed dial 1–9 from the family list; 0 is always parent.",
  },
  {
    id: "dial",
    kicker: "Speed dial",
    title: "Tap a face to call",
    body: "Photos on the pad, glow when they’re online. Share an invite, both say yes, then you’re on each other’s dial.",
  },
  {
    id: "sounds",
    kicker: "Landline vibes",
    title: "Dial tone to ringback",
    body: "Classic progress tones — dial, DTMF, and ringback — so it feels like a house phone, not a chat app.",
  },
  {
    id: "messages",
    kicker: "Answering machine",
    title: "Miss a call? Leave a message",
    body: "Greeting, beep, record. Play, skip, or delete on the Messages tab — not a chat inbox.",
  },
  {
    id: "safety",
    kicker: "You’re in charge",
    title: "Quiet Time, PIN, Activity",
    body: "Quiet Time and schedules, Child mode behind a PIN, and Activity so you can see who called.",
  },
];

/** @type {null | { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }} */
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
});

function isPhoneHomeStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    /** @type {Navigator & { standalone?: boolean }} */ (navigator).standalone === true
  );
}

document.documentElement.classList.toggle("ph-standalone", isPhoneHomeStandalone());

/**
 * Subtle DeviceOrientation → CSS vars for atmosphere + presence-ring specular.
 * Heavily damped; iOS permission on first tap; off for reduced-motion / hidden tab.
 */
const specularTilt = {
  armed: false,
  listening: false,
  denied: false,
  enabling: false,
  raf: 0,
  /** @type {{ x: number, y: number }} */
  target: { x: 0, y: 0 },
  /** @type {{ x: number, y: number }} */
  current: { x: 0, y: 0 },
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clampTilt(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function applySpecularTiltVars(x, y) {
  const root = document.documentElement.style;
  // Atmosphere blobs drift a few %; rings rotate ~±14° with a soft glow offset.
  root.setProperty("--tilt-ax", `${(x * 5.5).toFixed(2)}%`);
  root.setProperty("--tilt-ay", `${(y * 4.2).toFixed(2)}%`);
  root.setProperty("--tilt-bx", `${(x * -4.5).toFixed(2)}%`);
  root.setProperty("--tilt-by", `${(y * 3.5).toFixed(2)}%`);
  root.setProperty("--tilt-cx", `${(x * 3.2).toFixed(2)}%`);
  root.setProperty("--tilt-cy", `${(y * -3.8).toFixed(2)}%`);
  root.setProperty("--tilt-ring", `${(x * -14 + y * 6).toFixed(2)}deg`);
  root.setProperty("--tilt-glow-x", `${(x * 2.8).toFixed(2)}px`);
  root.setProperty("--tilt-glow-y", `${(y * 2.4).toFixed(2)}px`);
}

function resetSpecularTiltVars() {
  specularTilt.target.x = 0;
  specularTilt.target.y = 0;
  specularTilt.current.x = 0;
  specularTilt.current.y = 0;
  applySpecularTiltVars(0, 0);
}

function onDeviceOrientationTilt(e) {
  if (document.hidden || prefersReducedMotion()) return;
  // Portrait phone: gamma = left/right, beta = front/back (rest ~45–70°).
  const x = clampTilt((e.gamma || 0) / 28, -1, 1);
  const y = clampTilt(((e.beta || 45) - 55) / 28, -1, 1);
  specularTilt.target.x = x;
  specularTilt.target.y = y;
}

function tickSpecularTilt() {
  const { current, target } = specularTilt;
  // Heavy damp — Apple-like lag, not 1:1 tracking.
  const lerp = document.hidden ? 0.18 : 0.075;
  current.x += (target.x - current.x) * lerp;
  current.y += (target.y - current.y) * lerp;
  if (document.hidden) {
    target.x *= 0.92;
    target.y *= 0.92;
  }
  applySpecularTiltVars(current.x, current.y);
  const settled =
    Math.abs(current.x) < 0.001 &&
    Math.abs(current.y) < 0.001 &&
    Math.abs(target.x) < 0.001 &&
    Math.abs(target.y) < 0.001;
  if (settled && document.hidden) {
    specularTilt.raf = 0;
    resetSpecularTiltVars();
    return;
  }
  specularTilt.raf = requestAnimationFrame(tickSpecularTilt);
}

function startSpecularTiltLoop() {
  if (specularTilt.raf) return;
  specularTilt.raf = requestAnimationFrame(tickSpecularTilt);
}

function attachDeviceOrientationTilt() {
  if (specularTilt.listening || specularTilt.denied || prefersReducedMotion()) return;
  window.addEventListener("deviceorientation", onDeviceOrientationTilt, { passive: true });
  specularTilt.listening = true;
  startSpecularTiltLoop();
}

async function enableSpecularTiltFromGesture() {
  if (specularTilt.listening || specularTilt.denied || specularTilt.enabling || prefersReducedMotion()) {
    return;
  }
  specularTilt.enabling = true;
  try {
    const DOE = /** @type {typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> }} */ (
      window.DeviceOrientationEvent
    );
    if (typeof DOE?.requestPermission === "function") {
      const perm = await DOE.requestPermission();
      if (perm !== "granted") {
        specularTilt.denied = true;
        return;
      }
    }
  } catch {
    specularTilt.denied = true;
    return;
  } finally {
    specularTilt.enabling = false;
  }
  attachDeviceOrientationTilt();
}

function armSpecularTilt() {
  if (specularTilt.armed || prefersReducedMotion()) return;
  if (typeof window.DeviceOrientationEvent === "undefined") return;
  specularTilt.armed = true;

  const DOE = /** @type {typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> }} */ (
    window.DeviceOrientationEvent
  );
  // Non-iOS: listen immediately. iOS: wait for a tap (permission requires gesture).
  if (typeof DOE.requestPermission !== "function") {
    attachDeviceOrientationTilt();
    return;
  }

  const onGesture = () => {
    document.removeEventListener("pointerdown", onGesture, true);
    document.removeEventListener("touchend", onGesture, true);
    void enableSpecularTiltFromGesture();
  };
  document.addEventListener("pointerdown", onGesture, { capture: true, once: true });
  document.addEventListener("touchend", onGesture, { capture: true, once: true });
}

function initSpecularTilt() {
  if (prefersReducedMotion()) return;
  armSpecularTilt();
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (ev) => {
    if (ev.matches) {
      if (specularTilt.listening) {
        window.removeEventListener("deviceorientation", onDeviceOrientationTilt);
        specularTilt.listening = false;
      }
      if (specularTilt.raf) {
        cancelAnimationFrame(specularTilt.raf);
        specularTilt.raf = 0;
      }
      resetSpecularTiltVars();
    } else {
      specularTilt.armed = false;
      armSpecularTilt();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      specularTilt.target.x = 0;
      specularTilt.target.y = 0;
      startSpecularTiltLoop();
    } else if (specularTilt.listening) {
      startSpecularTiltLoop();
    }
  });
}

/** @returns {"ios" | "android" | "desktop"} */
function installPlatform() {
  const ua = navigator.userAgent || "";
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function installSlide() {
  const platform = installPlatform();
  const canQuickInstall = Boolean(deferredInstallPrompt);
  if (platform === "ios") {
    return {
      id: "install",
      kicker: "Home screen",
      title: "Add it like an app",
      body: "In Safari, tap Share → Add to Home Screen. Opening from the home screen keeps mic Allow across calls better than a Safari tab.",
      platform,
      canQuickInstall: false,
    };
  }
  if (platform === "android") {
    return {
      id: "install",
      kicker: "Home screen",
      title: "Add it like an app",
      body: canQuickInstall
        ? "Tap Install to put PhoneHome on your home screen. Or use Chrome’s menu ⋮ → Install app / Add to Home screen."
        : "In Chrome, open the menu ⋮ and tap Install app or Add to Home screen. Then open PhoneHome from there.",
      platform,
      canQuickInstall,
    };
  }
  return {
    id: "install",
    kicker: "Home screen",
    title: "Add it like an app",
    body: "On iPhone: Safari Share → Add to Home Screen. On Android: Chrome menu ⋮ → Install app. Best on a phone.",
    platform,
    canQuickInstall,
  };
}

function getTutorialSlides() {
  const slides = [...TUTORIAL_SLIDES];
  if (isPhoneHomeStandalone()) return slides;
  // One focused beat near the end — after safety, before “Let’s go”.
  slides.push(installSlide());
  return slides;
}

const state = {
  sessionId: localStorage.getItem("kl_session") || "",
  user: null,
  households: [],
  directory: [],
  activeLineId: localStorage.getItem("kl_line") || "",
  /** Profile/controls edit target — does not change softphone WS registration. */
  editLineId: "",
  ws: null,
  /**
   * True after session.replaced / close 4000 — do not auto-reconnect (refresh/ensureWs
   * used to revive the loser and fight the winner every few seconds).
   */
  wsReplaced: false,
  /** Softphone on a line whose analog adapter is preferred for inbound. */
  ataPreferred: false,
  pc: null,
  /** Page-lifetime mic stream — never stop between calls (iOS re-prompts on getUserMedia). */
  localStream: null,
  /** Cloned tracks attached to live PeerConnections; stopped on hangup, master kept. */
  pcMicTracks: [],
  pendingIce: [],
  remoteReady: false,
  muted: false,
  onHold: false,
  call: null,
  callStartedAt: 0,
  iceState: "",
  iceGatherHint: "",
  wakeLock: null,
  /** Parent Analog Phone adapter picker (ht801 | g100s) before save. */
  ataModelDraft: "",
  /**
   * Parent → Analog Phone: which kid line the adapter form targets.
   * Syncs with Active line when idle; source of truth for Save / Set up / Download.
   */
  ataTargetLineId: "",
  /**
   * In-progress Analog form fields. Survives Parent remounts (presence WS, status polls,
   * validation flashes) so typing IP/passwords isn’t wiped mid-entry.
   */
  ataFormDraft: {
    ip: "",
    boxPass: "",
    newPass: "",
    newPass2: "",
    server: "",
    mac: "",
    name: "",
    reconnectOpen: false,
    advancedOpen: false,
  },
  ringTimer: null,
  /** Outbound no-answer → voicemail timer */
  ringTimeout: null,
  tickTimer: null,
  connectWatch: null,
  audioCtx: null,
  dialTone: null,
  ringback: null,
  outboundSeqTimers: null,
  outboundSeqId: 0,
  holdMusic: null,
  silenceTimer: null,
  stillReplyTimer: null,
  silenceAnalyser: null,
  silencePoll: null,
  stillPrompt: false,
  presenceTimer: null,
  flashTimer: null,
  celebrate: "",
  /** Hide new-message banner until unread count rises again */
  vmBannerDismissedCount: 0,
  /** After * / banner — Messages should start Play on mount. */
  autoPlayVm: false,
  /** Last outbound target for classic # redial (session). */
  lastRedialLineId: null,
  /** True while answering-machine greeting is being recorded (blocks remounts). */
  greetingRecording: false,
  /**
   * Parent Home: HT801 / kid ATA health by line id.
   * @type {Record<string, { status: string, fetchedAt: number, sip_extension?: string|null }>}
   */
  ataStatusByLine: {},
  /** In-flight ata-status fetches (dedupe). */
  ataStatusFetching: {},
  /**
   * From /api/health — whether this PhoneHome home hub can one-tap push to an HT801 on LAN.
   * null = not loaded yet; false = remote/shared host (use Download config).
   * Parent app being on Wi‑Fi is irrelevant — only the hub↔ATA LAN matters.
   * @type {boolean|null}
   */
  ataLanPush: null,
  /** Epoch ms — disable Set up adapter after remainN/locked (no password retry loops). */
  ataPushCooldownUntil: 0,
  nav: localStorage.getItem("kl_nav") || "phone",
  /** Session flag after PIN verify — only used when needsParentPinGate() is true. */
  parentUnlocked: false,
  /** After opening Parent, scroll to this section id (e.g. parent-ata). */
  parentScrollTo: "",
  /** Open this Help article id once after jumping from Analog intro. */
  parentHelpFocus: "",
  /** Parent settings search query (session; survives re-render). */
  parentSearch: "",
  /** Profile settings search query (session; survives re-render). */
  profileSearch: "",
  /** Session unlock for speed-dial drag when household layout_locked is on. */
  layoutUnlocked: false,
  /** Home pad jiggle/edit mode (rearrange + delete badges). */
  speedDialEditing: false,
  childMode: localStorage.getItem("kl_child_mode") === "1",
  error: "",
  screen: "boot",
  mode: "host",
  flash: "",
  /** @type {"info"|"ok"|"warn"|"error"} */
  flashKind: "info",
  /** Waiting-contact explainer sheet (avoid full remount). */
  waitSheet: null,
  tutorialIndex: 0,
  tutorialFromSettings: false,
  /** Open setup board even if previously dismissed (Help / Parent re-entry). */
  setupForceShow: false,
  leaveFor: null,
  editContactId: null,
  splashTimer: null,
  group: null,
  groupPeers: {},
  groupPick: [],
  pinModal: null,
  pendingGuardianCode: "",
  /** Activity call-log filter: null = all, or "completed" | "missed" | "blocked" (Stopped; only when count > 0). */
  activityFilter: null,
  /** Live answering-machine speaker session (opt-in recipient). */
  vmMonitor: null,
  vmMonitorPc: null,
  vmMonitorPendingIce: [],
  vmMonitorRemoteReady: false,
};

const callRoot = () => document.getElementById("call-root");
const remoteAudio = () => document.getElementById("remote-audio");
const groupAudioRoot = () => document.getElementById("group-audio-root");
const MAX_GROUP = 4;

/** Status toast: only pass kind "error" for real failures (red). Lives in #toast-root (not #app). */
function setFlash(msg, kind = "info") {
  state.flash = msg || "";
  state.flashKind = msg ? kind || "info" : "info";
  paintToast();
}

function flashKindClass() {
  return state.flashKind === "error" || state.flashKind === "ok" || state.flashKind === "warn"
    ? state.flashKind
    : "info";
}

function paintToast() {
  const root = document.getElementById("toast-root");
  if (!root) return;
  if (state.flashTimer) {
    clearTimeout(state.flashTimer);
    state.flashTimer = null;
  }
  if (!state.flash) {
    root.innerHTML = "";
    root.hidden = true;
    return;
  }
  root.hidden = false;
  root.innerHTML = `<p class="flash-toast ${flashKindClass()}" role="status">${state.flash}</p>`;
  state.flashTimer = setTimeout(() => {
    state.flash = "";
    state.flashKind = "info";
    paintToast();
  }, 5000);
}

/** Inline flash for auth sheets that replace #app (toast still preferred on home). */
function flashHtml(variant = "banner") {
  if (!state.flash) return "";
  const kind = flashKindClass();
  if (variant === "inline") {
    return `<p class="flash-inline ${kind}">${state.flash}</p>`;
  }
  return `<p class="flash-banner ${kind}">${state.flash}</p>`;
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (state.sessionId) headers["X-Session-Id"] = state.sessionId;
  const res = await fetch(path, { ...opts, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    if (data.abort_retries || data.lockout || res.status === 423) {
      err.abortRetries = true;
      err.lockout = Boolean(data.lockout);
      err.cooldownMs = Number(data.cooldown_ms) || 130000;
    }
    throw err;
  }
  return data;
}

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

/** Stable per-tab id — same-browser tabs coordinate so they don't reclaim-storm. */
const KL_TAB_ID =
  sessionStorage.getItem("kl_tab") ||
  (() => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `tab_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem("kl_tab", id);
    return id;
  })();

let lineChannel = null;
try {
  lineChannel = new BroadcastChannel("phonehome-line");
  lineChannel.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || msg.tabId === KL_TAB_ID) return;
    if (msg.type === "hello" && msg.lineId && msg.lineId === state.activeLineId) {
      // Deterministic yield — lexicographically greater tabId wins so two
      // simultaneous opens don't both close and leave the line offline.
      if (String(msg.tabId) <= String(KL_TAB_ID)) return;
      markWsReplaced("Another PhoneHome tab is using this line");
      const ws = state.ws;
      if (ws && ws.readyState <= 1) {
        try {
          ws.close(4000, "replaced-local");
        } catch {
          /* ignore */
        }
      }
    }
  };
} catch {
  /* BroadcastChannel unavailable */
}

function announceLineClaim(lineId) {
  if (!lineId || !lineChannel) return;
  try {
    lineChannel.postMessage({ type: "hello", lineId, tabId: KL_TAB_ID });
  } catch {
    /* ignore */
  }
}

function markWsReplaced(reason) {
  state.wsReplaced = true;
  if (reason) setFlash(reason, "warn");
}

function ensureWs() {
  if (!state.sessionId || !state.activeLineId) return;
  // Kicked by another device/tab — stay quiet until reconnectWs / placeCall reclaim.
  if (state.wsReplaced) return;
  if (state.ws && state.ws.readyState <= 1) return;
  const ws = new WebSocket(wsUrl());
  state.ws = ws;
  let replaced = false;
  let chain = Promise.resolve();
  ws.onopen = () => {
    announceLineClaim(state.activeLineId);
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
      .then(() => {
        const msg = JSON.parse(ev.data);
        // Another tab/device took this line — stay quiet so we don't thrash WS/ICE.
        if (msg.type === "session.replaced") {
          replaced = true;
          markWsReplaced("This line opened on another phone or tab");
          return;
        }
        if (msg.type === "session.ata_preferred") {
          state.ataPreferred = true;
          if (msg.message) setFlash(String(msg.message), "info");
          if (state.screen === "home") render();
          return;
        }
        if (msg.type === "session.ata_cleared") {
          state.ataPreferred = false;
          if (state.screen === "home") render();
          return;
        }
        if (msg.type === "welcome" && msg.ataPreferred) {
          state.ataPreferred = true;
        }
        return handleSignal(msg);
      })
      .catch((err) => console.warn("[signal]", err));
  };
  ws.onclose = (ev) => {
    if (state.ws !== ws) return; // superseded by reconnectWs / new socket
    // 4000 = claimLine replaced us — don't reconnect (message can race the close).
    if (replaced || state.wsReplaced || ev.code === 4000) {
      state.wsReplaced = true;
      return;
    }
    setTimeout(ensureWs, 1500);
  };
}

/** Close current signaling socket (if any) and open a fresh one for activeLineId. */
function reconnectWs() {
  state.wsReplaced = false;
  state.ataPreferred = false;
  const prev = state.ws;
  state.ws = null;
  if (prev) {
    try {
      prev.close();
    } catch {
      /* ignore */
    }
  }
  ensureWs();
}

/** Wait until signaling WS is OPEN (or fail). Used before call.offer. */
function waitForWsOpen(ms = 2500) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (state.ws && state.ws.readyState === 1 && !state.wsReplaced) {
        resolve();
        return;
      }
      if (Date.now() - start >= ms) {
        reject(
          new Error(
            state.wsReplaced
              ? "This line is open on another phone or tab — hang up there, or call again to take over"
              : "Not connected to the network yet — wait a second and try again"
          )
        );
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function handleSignal(msg) {
  if (msg.type === "call.offer") await onIncomingOffer(msg);
  else if (msg.type === "call.answer") await onAnswer(msg);
  else if (msg.type === "call.ice") await addRemoteIce(msg.candidate);
  else if (msg.type === "call.hangup") {
    if (state.group) return;
    // Already cleaned up locally (e.g. ring timeout → leave-message).
    if (!state.call) return;
    const outboundMiss =
      (state.call.status === "calling" || state.call.status === "ringing") &&
      state.call.fromLineId === state.activeLineId;
    const toLineId = state.call.toLineId;
    stopRing();
    stopDialTone();
    endCallUi(outboundMiss ? "No answer" : "Call ended");
    if (outboundMiss && toLineId) {
      state.leaveFor = { toLineId, hint: "They didn’t pick up" };
      state.screen = "leave-message";
    }
    render();
  } else if (msg.type === "call.hold") {
    // Analog # hold — peer already hears Asterisk MOH; update UI only.
    if (!state.call || state.group) return;
    if (msg.callId && state.call.callId && msg.callId !== state.call.callId) return;
    const on = Boolean(msg.onHold);
    if (state.onHold === on) {
      paintCallLayer();
      return;
    }
    state.onHold = on;
    // Don't run applyHoldAudio — that would inject a second hold track.
    if (!on) setOutboundMicEnabled(!state.muted);
    else setOutboundMicEnabled(false);
    paintCallLayer();
  } else if (msg.type === "call.rejected") {
    if (state.group) return;
    if (!state.call) return;
    const toLineId = state.call.toLineId;
    const reason = msg.reason || "Call could not connect";
    const blocked =
      /quiet|pause|limit|Quiet Time|paused|talk time|timeout|Bedtime|School|not available/i.test(
        reason
      ) || Boolean(msg.voice && msg.voice !== "allowlist" && msg.voice !== "self");
    const noAnswer = /^no answer$/i.test(String(reason || "").trim());
    stopRing();
    stopDialTone();
    if (!noAnswer) setFlash(reason, blocked ? "warn" : "error");
    endCallUi(noAnswer ? "No answer" : undefined);
    if (blocked && msg.spoken) {
      void speakUnavailablePrompt(String(msg.spoken));
    } else if (blocked && reason) {
      void speakUnavailablePrompt(reason);
    }
    if (toLineId && !blocked) {
      state.leaveFor = {
        toLineId,
        hint: noAnswer ? "They didn’t pick up" : reason,
      };
      state.screen = "leave-message";
    }
    render();
  } else if (msg.type === "call.ringing") {
    state.call = { ...(state.call || {}), status: "ringing", callId: msg.callId };
    paintCallLayer();
  } else if (msg.type === "group.started") onGroupStarted(msg);
  else if (msg.type === "group.invite") onGroupInvite(msg);
  else if (msg.type === "group.peer-joined") await onGroupPeerJoined(msg);
  else if (msg.type === "group.peer-left") onGroupPeerLeft(msg);
  else if (msg.type === "group.peer-declined") onGroupPeerDeclined(msg);
  else if (msg.type === "group.ended") onGroupEnded(msg);
  else if (msg.type === "group.error") {
    setFlash(msg.error || "Group call failed", "error");
    leaveGroup(true);
    render();
  }   else if (msg.type === "group.offer") await onGroupOffer(msg);
  else if (msg.type === "group.answer") await onGroupAnswer(msg);
  else if (msg.type === "group.ice") await onGroupIce(msg);
  else if (msg.type === "voicemail.monitor.offer") await onVmMonitorOffer(msg);
  else if (msg.type === "voicemail.monitor.answer") await onVmMonitorAnswer(msg);
  else if (msg.type === "voicemail.monitor.ice") await onVmMonitorIce(msg);
  else if (msg.type === "voicemail.monitor.stop") onVmMonitorStop(msg);
  else if (msg.type === "voicemail.monitor.skip") onVmMonitorSkip(msg);
  else if (msg.type === "presence.call") {
    const hh = state.households[0];
    if (hh && (!msg.householdId || msg.householdId === hh.id)) {
      hh.live_calls = msg.live_calls || [];
      // Parent Analog form must not remount on live-call chatter — that wiped IP/passwords.
      if (state.nav === "controls") {
        captureAtaFormDraftFromDom();
        return;
      }
      if (!isChildMode() && (state.screen === "home" || state.nav === "phone")) {
        render();
      }
    }
  } else if (msg.type === "voicemail.new") {
    onVoicemailNew(msg);
  }
}

/** Recipient household got a new answering-machine message. */
function onVoicemailNew(msg) {
  const hh = state.households[0];
  if (!hh || (msg.householdId && msg.householdId !== hh.id)) return;
  const vm = msg.voicemail;
  // Caller softphone must stay silent for the message they just left (no remount /
  // banner / flash that can restart greeting playback on this device).
  const ownOutbound =
    !!vm?.from_line_id && !!state.activeLineId && vm.from_line_id === state.activeLineId;
  if (ownOutbound || state.screen === "leave-message") return;
  // Only light the Messages LED for the recipient line (Active line mailbox).
  const forActive =
    !vm?.to_line_id || !state.activeLineId || vm.to_line_id === state.activeLineId;
  if (vm?.id) {
    hh.voicemails = hh.voicemails || [];
    if (!hh.voicemails.some((v) => v.id === vm.id)) {
      hh.voicemails = [vm, ...hh.voicemails];
    }
  }
  if (!forActive) return;
  // New message always re-shows the banner (classic “messages” light).
  state.vmBannerDismissedCount = 0;
  const who = vm?.from_label || "Someone";
  if (state.nav !== "voicemail") {
    setFlash(`${who} left a message`, "info");
  }
  if (state.screen === "home" || state.nav === "phone" || state.nav === "activity" || state.nav === "voicemail") {
    if (state.nav === "phone" && patchHomePresence()) {
      patchNewVmBanner(hh);
      patchDockVmBadge(hh);
      return;
    }
    render();
  }
}

function sdpPayload(desc) {
  return { type: desc.type, sdp: desc.sdp };
}

function icePayload(candidate) {
  if (!candidate) return null;
  return typeof candidate.toJSON === "function" ? candidate.toJSON() : candidate;
}

/** Child login line, or the only child-mode line this user owns (never a parent’s line). */
function preferredChildLineId() {
  const uid = state.user?.id;
  if (!uid) return "";
  const lines = (state.households || []).flatMap((h) => h.lines || []);
  const linked = lines.find((l) => l.child_user_id === uid || l.child_user?.id === uid);
  if (linked) return linked.id;
  const ownedChild = lines.filter((l) => l.owner_user_id === uid && l.mode === "child");
  const ownedParent = lines.some(
    (l) => l.owner_user_id === uid && (l.mode || "parent") !== "child"
  );
  if (ownedChild.length && !ownedParent) return ownedChild[0].id;
  return "";
}

function allAccessibleLines() {
  return (state.households || []).flatMap((h) => h.lines || []);
}

async function refresh() {
  await refreshHealthCaps();
  const data = await api("/api/me");
  state.user = data.user;
  state.households = data.households || [];
  state.directory = data.directory || [];
  const lines = allAccessibleLines();
  const kidLineId = preferredChildLineId();
  const activeOk = lines.some((l) => l.id === state.activeLineId);
  // Child sessions must not keep a stale parent kl_line from a shared device.
  if (kidLineId && (!activeOk || state.activeLineId !== kidLineId)) {
    state.activeLineId = kidLineId;
    localStorage.setItem("kl_line", kidLineId);
  } else if (!activeOk) {
    const line = lines[0];
    if (line) {
      state.activeLineId = line.id;
      localStorage.setItem("kl_line", line.id);
    } else {
      state.activeLineId = "";
      localStorage.removeItem("kl_line");
    }
  }
  const hh = state.households[0];
  const line = (hh?.lines || []).find((l) => l.id === state.activeLineId);
  if (localStorage.getItem("kl_child_mode") === "1") {
    state.childMode = true;
  } else if (line?.mode === "child" && localStorage.getItem("kl_child_line") === line.id) {
    state.childMode = true;
    localStorage.setItem("kl_child_mode", "1");
  }
  if (!hh) state.screen = state.mode === "join" ? "join" : "host";
  else if (!hh.lines.length) state.screen = state.mode === "join" ? "join" : "host";
  else if (
    state.screen === "boot" ||
    state.screen === "welcome" ||
    state.screen === "host" ||
    state.screen === "join" ||
    state.screen === "returning" ||
    state.screen === "register" ||
    state.screen === "set-password"
  ) {
    // First landing after auth — show setup board if required steps remain.
    state.screen = shouldShowSetupBoard(hh) ? "setup" : "home";
  } else if (state.screen === "setup" && !shouldShowSetupBoard(hh)) {
    state.screen = "home";
  }
  ensureWs();
  render();
}

/** Pull-to-refresh on main app-shell surfaces (Home / Activity / Messages / Parent). */
const PTR_THRESHOLD = 132;
const ptr = {
  tracking: false,
  startY: 0,
  pull: 0,
  refreshing: false,
};

function ptrRoot() {
  return document.getElementById("ptr-root");
}

function canPullToRefresh() {
  if (ptr.refreshing) return false;
  if (!state.sessionId || !state.user) return false;
  if (state.call || state.group) return false;
  if (state.greetingRecording) return false;
  if (state.screen === "splash" || state.screen === "tutorial" || state.screen === "setup") return false;
  if (!document.querySelector(".app-shell")) return false;
  if ((window.scrollY || document.documentElement.scrollTop || 0) > 2) return false;
  if (document.getElementById("speed-drag-ghost")) return false;
  if (document.querySelector(".speed-slot.dragging, .contact-tile.dragging")) return false;
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) {
    return false;
  }
  return true;
}

function paintPtr(pull, { refreshing = false } = {}) {
  const root = ptrRoot();
  if (!root) return;
  const label = root.querySelector(".ptr-label");
  const armed = pull >= PTR_THRESHOLD;
  const y = Math.min(pull * 0.55, 88);
  root.hidden = false;
  root.classList.toggle("visible", pull > 8 || refreshing);
  root.classList.toggle("armed", armed && !refreshing);
  root.classList.toggle("refreshing", refreshing);
  root.style.setProperty("--ptr-y", `${y}px`);
  root.style.setProperty("--ptr-rot", String(Math.min(pull * 2.4, 220)));
  if (label) {
    label.textContent = refreshing ? "Refreshing…" : armed ? "Release to refresh" : "Pull to refresh";
  }
  if (!refreshing && pull <= 0) {
    root.classList.remove("visible", "armed", "refreshing");
    root.hidden = true;
    root.style.setProperty("--ptr-y", "0px");
  }
}

async function runPullRefresh() {
  if (ptr.refreshing) return;
  ptr.refreshing = true;
  ptr.pull = PTR_THRESHOLD;
  paintPtr(PTR_THRESHOLD, { refreshing: true });
  // Full document reload so deploy UI/asset updates show up (not just /api/me soft refresh).
  location.reload();
}

function bindPullToRefresh() {
  if (bindPullToRefresh._bound) return;
  bindPullToRefresh._bound = true;

  const onStart = (y) => {
    if (!canPullToRefresh()) {
      ptr.tracking = false;
      return;
    }
    ptr.tracking = true;
    ptr.startY = y;
    ptr.pull = 0;
  };

  const onMove = (y, e) => {
    if (!ptr.tracking || ptr.refreshing) return;
    if (!canPullToRefresh() && ptr.pull <= 0) {
      ptr.tracking = false;
      paintPtr(0);
      return;
    }
    const dy = y - ptr.startY;
    if (dy <= 0) {
      ptr.pull = 0;
      paintPtr(0);
      return;
    }
    // Resist after threshold so the gesture feels springy, not infinite.
    ptr.pull = dy < PTR_THRESHOLD ? dy : PTR_THRESHOLD + (dy - PTR_THRESHOLD) * 0.28;
    paintPtr(ptr.pull);
    if (ptr.pull > 10 && e?.cancelable) e.preventDefault();
  };

  const onEnd = () => {
    if (!ptr.tracking) return;
    const shouldRefresh = ptr.pull >= PTR_THRESHOLD && !ptr.refreshing;
    ptr.tracking = false;
    if (shouldRefresh) {
      void runPullRefresh();
      return;
    }
    ptr.pull = 0;
    paintPtr(0);
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      onStart(e.touches[0].clientY);
    },
    { passive: true }
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!ptr.tracking || e.touches.length !== 1) return;
      onMove(e.touches[0].clientY, e);
    },
    { passive: false }
  );
  document.addEventListener("touchend", onEnd, { passive: true });
  document.addEventListener("touchcancel", onEnd, { passive: true });
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

/** Match server RING_TIMEOUT_MS — unanswered outbound → leave-a-message. */
const RING_TIMEOUT_MS = 40_000;

function clearConnectWatch() {
  if (state.connectWatch) clearTimeout(state.connectWatch);
  state.connectWatch = null;
}

/** ICE connect timeout — only after answer (not while still ringing). */
function armConnectWatch() {
  clearConnectWatch();
  state.connectWatch = setTimeout(() => {
    if (!state.call) return;
    if (state.iceState === "connected") return;
    const st = state.call.status;
    if (st === "calling" || st === "ringing" || st === "incoming") return;
    const onlyHost = state.iceGatherHint === "host-only";
    setFlash(
      onlyHost
        ? "Couldn’t connect — network may need TURN (relay). Try again on Wi‑Fi or cellular, or ask the host to check TURN."
        : "Couldn’t connect — network may need TURN. Hang up and try again with both phones on a solid network.",
      "error");
    hangup();
    render();
  }, 25_000);
}

function clearRingTimeout() {
  if (state.ringTimeout) clearTimeout(state.ringTimeout);
  state.ringTimeout = null;
}

function armRingTimeout() {
  clearRingTimeout();
  state.ringTimeout = setTimeout(() => {
    state.ringTimeout = null;
    if (!state.call) return;
    const st = state.call.status;
    if (st !== "calling" && st !== "ringing") return;
    if (state.call.fromLineId !== state.activeLineId) return;
    noAnswerHangup();
  }, RING_TIMEOUT_MS);
}

/** Outbound ring timed out — hang up as missed and open voicemail. */
function noAnswerHangup() {
  const call = state.call;
  if (!call) return;
  const toLineId = call.toLineId;
  stopRing();
  stopDialTone();
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(
      JSON.stringify({
        type: "call.hangup",
        callId: call.callId,
        fromLineId: call.fromLineId || state.activeLineId,
        toLineId:
          call.toLineId === state.activeLineId ? call.fromLineId : call.toLineId,
        reason: "no-answer",
      })
    );
  }
  endCallUi("No answer");
  if (toLineId) {
    state.leaveFor = { toLineId, hint: "They didn’t pick up" };
    state.screen = "leave-message";
  }
  render();
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
  stopOutboundProgress();
  const epoch = (state.ringEpoch = (state.ringEpoch || 0) + 1);
  try {
    void unlockAudioCtx().then((ctx) => {
      if (!ctx) return;
      // Answer/decline often happens while unlockAudioCtx is still pending — don't
      // restart the ringer after stopRing() already ran on that gesture.
      if (epoch !== state.ringEpoch) return;
      const inbound =
        (state.call && state.call.status === "incoming") ||
        (state.group && state.group.status === "incoming");
      if (!inbound) return;
      const style = householdRingerStyle();
      const pattern = ringPattern(style);
      const beep = () => {
        if (epoch !== state.ringEpoch) return;
        pattern();
      };
      beep();
      if (state.ringTimer) clearInterval(state.ringTimer);
      state.ringTimer = setInterval(beep, ringIntervalMs(style));
    });
    if (navigator.vibrate) {
      const style = householdRingerStyle();
      const vib =
        style === "urgent"
          ? [120, 40, 120, 40, 120, 40, 200]
          : style === "chime"
            ? [80, 100, 80]
            : style === "classic"
              ? [280, 220, 280, 4200]
              : [180, 80, 180, 80, 240];
      navigator.vibrate(vib);
    }
  } catch {}
}

function stopRing() {
  state.ringEpoch = (state.ringEpoch || 0) + 1;
  if (state.ringTimer) clearInterval(state.ringTimer);
  state.ringTimer = null;
  if (state.ringSampleTimers?.length) {
    state.ringSampleTimers.forEach((t) => clearTimeout(t));
  }
  state.ringSampleTimers = null;
  try {
    state.ringLive?.forEach((s) => s.stop?.());
  } catch {}
  state.ringLive = null;
  try {
    navigator.vibrate?.(0);
  } catch {}
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

/** Household quiet_tz when set; otherwise this device’s timezone. */
function activityTimeZone(hh = state.households[0]) {
  const tz = hh?.quiet_tz;
  if (tz) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
      return tz;
    } catch {}
  }
  return browserTimeZone();
}

/** YYYY-MM-DD in an IANA timezone. */
function calendarDayKeyLocal(date, tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDayKey(dayKey, deltaDays) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function isSecureMicContext() {
  if (typeof window.isSecureContext === "boolean") return window.isSecureContext;
  return location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function getUserMediaFn() {
  const md = navigator.mediaDevices;
  if (md && typeof md.getUserMedia === "function") {
    return (constraints) => md.getUserMedia(constraints);
  }
  const legacy =
    navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.getUserMedia;
  if (typeof legacy === "function") {
    return (constraints) =>
      new Promise((resolve, reject) => {
        legacy.call(navigator, constraints, resolve, reject);
      });
  }
  return null;
}

function micUnavailableReason() {
  if (!isSecureMicContext()) {
    return "This page isn’t HTTPS, so iPhone/iPad block the mic. Use https://….trycloudflare.com (or wait for the auto-redirect from the LAN link).";
  }
  if (!getUserMediaFn()) {
    return "This browser can’t use the microphone. Open in Safari (not an in-app browser), allow Microphone, then try again.";
  }
  return "";
}

/**
 * Keep constraints minimal + frozen. Complex constraint objects can make iOS treat
 * each getUserMedia as a new request; we only call gum once per page load.
 */
const MIC_CONSTRAINTS = Object.freeze({ audio: true, video: false });

async function acquireMic() {
  const reason = micUnavailableReason();
  if (reason) throw new Error(reason);
  const gum = getUserMediaFn();
  if (!gum) throw new Error("Microphone API missing — open the HTTPS link in Safari.");
  state.gumCount = (state.gumCount || 0) + 1;
  // Temporary visibility: if this logs on every call, reuse is broken.
  console.warn(`[mic] getUserMedia #${state.gumCount}`, { stack: new Error().stack?.split("\n").slice(0, 6) });
  try {
    return await gum(MIC_CONSTRAINTS);
  } catch (e) {
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error("Microphone blocked — tap aA → Website Settings → allow Microphone, then try again.");
    }
    if (name === "NotFoundError") {
      throw new Error("No microphone found on this device.");
    }
    // Never surface raw "undefined is not an object" to parents
    const msg = String(e?.message || "");
    if (/mediaDevices|getUserMedia|undefined/i.test(msg)) {
      throw new Error("Mic unavailable — open https://….trycloudflare.com in Safari and allow Microphone.");
    }
    throw new Error(msg || "Could not open the microphone");
  }
}

/** Live audio tracks still usable — iOS re-prompts if we stop() then call getUserMedia again. */
function micStreamUsable(stream) {
  if (!stream) return false;
  const tracks = stream.getAudioTracks();
  return tracks.length > 0 && tracks.some((t) => t.readyState === "live");
}

/** Master tracks must stay enabled=true — iOS often ends disabled capture tracks. */
function keepMasterMicEnabled() {
  state.localStream?.getAudioTracks().forEach((t) => {
    if (t.readyState === "live") t.enabled = true;
  });
}

function watchMasterMicTracks(stream) {
  if (!stream) return;
  for (const t of stream.getAudioTracks()) {
    t.addEventListener("ended", () => {
      console.warn("[mic] master track ended — next call may re-prompt", t.id);
    });
    t.addEventListener("mute", () => {
      console.warn("[mic] master track muted by system", t.id);
    });
  }
}

/**
 * Keep a muted audio element + zero-gain AudioContext graph on the master stream so
 * iOS Safari / PWA does not tear down capture between PeerConnections.
 */
function ensureMicKeepalive() {
  if (!micStreamUsable(state.localStream)) return;
  keepMasterMicEnabled();
  let el = document.getElementById("mic-keepalive");
  if (!el) {
    el = document.createElement("audio");
    el.id = "mic-keepalive";
    el.muted = true;
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none";
    document.body.appendChild(el);
  }
  if (el.srcObject !== state.localStream) {
    el.srcObject = state.localStream;
  }
  el.play().catch(() => {});
  try {
    const ctx = ensureAudioCtx();
    if (ctx && !state.micKeepaliveGraph) {
      void ctx.resume?.();
      const src = ctx.createMediaStreamSource(state.localStream);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(ctx.destination);
      state.micKeepaliveGraph = { src, gain };
    }
  } catch (err) {
    console.warn("[mic] AudioContext keepalive failed", err);
  }
}

function clearMicKeepalive() {
  const el = document.getElementById("mic-keepalive");
  if (el) {
    try {
      el.srcObject = null;
      el.remove();
    } catch {}
  }
  if (state.micKeepaliveGraph) {
    try {
      state.micKeepaliveGraph.src.disconnect();
      state.micKeepaliveGraph.gain.disconnect();
    } catch {}
    state.micKeepaliveGraph = null;
  }
}

/**
 * Reuse the page-lifetime mic stream when possible. First grant needs Allow once;
 * later calls must not call getUserMedia again (iOS re-prompts).
 */
async function ensureMicStream() {
  if (micStreamUsable(state.localStream)) {
    ensureMicKeepalive();
    return state.localStream;
  }
  const reacquire = (state.gumCount || 0) > 0;
  if (state.localStream) {
    try {
      state.localStream.getTracks().forEach((t) => t.stop());
    } catch {}
    state.localStream = null;
    clearMicKeepalive();
  }
  state.localStream = await acquireMic();
  watchMasterMicTracks(state.localStream);
  keepMasterMicEnabled();
  ensureMicKeepalive();
  try {
    localStorage.setItem("kl_mic_armed", "1");
  } catch {}
  if (reacquire) {
    console.warn(`[mic] RE-ACQUIRE getUserMedia #${state.gumCount} — prior track was not live`);
  }
  return state.localStream;
}

/** Mute only PC clones (outbound). Never disable the page-lifetime master track on iOS. */
function setOutboundMicEnabled(enabled) {
  for (const t of state.pcMicTracks || []) {
    if (t.readyState === "live") t.enabled = enabled;
  }
}

/**
 * Between calls: keep master live+enabled (no stop, no enabled=false).
 * Outbound clones are already released on hangup.
 */
function parkMicStream() {
  if (!state.localStream) return;
  keepMasterMicEnabled();
  ensureMicKeepalive();
}

function armMicForCall() {
  if (!state.localStream) return;
  keepMasterMicEnabled();
  setOutboundMicEnabled(!state.muted && !state.onHold);
  ensureMicKeepalive();
}

/**
 * Clone master tracks onto a PC. Closing the PC must not end the master stream —
 * that was the remaining iOS re-prompt (park alone was not enough).
 */
function attachLocalMicToPc(pc) {
  if (!pc || !micStreamUsable(state.localStream)) return;
  if (!Array.isArray(state.pcMicTracks)) state.pcMicTracks = [];
  for (const track of state.localStream.getAudioTracks()) {
    if (track.readyState !== "live") continue;
    let clone;
    try {
      clone = track.clone();
    } catch (err) {
      console.warn("[mic] track.clone failed — refusing to attach master (iOS re-prompt)", err);
      continue;
    }
    clone.enabled = !state.muted && !state.onHold;
    state.pcMicTracks.push(clone);
    pc.addTrack(clone, new MediaStream([clone]));
  }
}

/** Stop clones tied to one PC (or all senders on it). Master stream stays parked. */
function releaseMicForPc(pc) {
  if (!pc) return;
  const stopSet = new Set();
  try {
    for (const sender of pc.getSenders()) {
      const t = sender.track;
      if (!t || t.kind !== "audio") continue;
      if ((state.pcMicTracks || []).includes(t)) stopSet.add(t);
    }
  } catch {}
  for (const t of stopSet) {
    try {
      t.stop();
    } catch {}
  }
  state.pcMicTracks = (state.pcMicTracks || []).filter((t) => !stopSet.has(t) && t.readyState === "live");
}

function releaseAllPcMicTracks() {
  for (const t of state.pcMicTracks || []) {
    try {
      t.stop();
    } catch {}
  }
  state.pcMicTracks = [];
}

/** True stop — logout / dead tracks. Prefer parkMicStream between calls. */
function hardReleaseMicStream() {
  releaseAllPcMicTracks();
  clearMicKeepalive();
  if (!state.localStream) return;
  try {
    state.localStream.getTracks().forEach((t) => t.stop());
  } catch {}
  state.localStream = null;
}

/** Greeting / VM recorders share the softphone stream — never stop those tracks here. */
function releaseRecorderMicRef(streamRef) {
  if (!streamRef) return;
  if (streamRef === state.localStream) {
    parkMicStream();
    return;
  }
  try {
    streamRef.getTracks().forEach((t) => t.stop());
  } catch {}
}

/** If someone is still on LAN http://10.x, bounce to the public HTTPS origin. */
async function ensurePublicHttps() {
  try {
    const data = await fetch("/api/health").then((r) => r.json());
    if (typeof data.ataLanPush === "boolean") state.ataLanPush = data.ataLanPush;
    const base = String(data.publicBaseUrl || "").replace(/\/$/, "");
    const host = location.hostname;
    const privateHost =
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host) || host.endsWith(".local");
    if (location.protocol === "https:" || !privateHost) return;
    if (base && base !== location.origin) {
      location.replace(`${base}${location.pathname}${location.search}${location.hash}`);
    }
  } catch {
    /* stay put; server redirect should still help */
  }
}

/** Refresh ATA LAN-push capability (and other health flags) without navigating. */
async function refreshHealthCaps() {
  try {
    const data = await fetch("/api/health").then((r) => r.json());
    if (typeof data.ataLanPush === "boolean") state.ataLanPush = data.ataLanPush;
  } catch {
    /* leave previous value */
  }
}

async function makePc(peer) {
  state.remoteReady = false;
  state.iceState = "starting";
  state.iceGatherHint = "";
  state.muted = false;
  let sawSrflxOrRelay = false;
  let sawAnyCandidate = false;
  const pc = new RTCPeerConnection({
    iceServers: await iceServers(),
    iceCandidatePoolSize: 4,
  });
  state.pc = pc;
  // Keep any ICE that arrived before Answer / before PC existed.
  // Clone mic onto PC — closing PC must not end the page-lifetime master stream (iOS).
  await ensureMicStream();
  armMicForCall();
  attachLocalMicToPc(pc);

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
    if (ev.candidate) {
      sawAnyCandidate = true;
      const candStr = ev.candidate.candidate || "";
      const t = ev.candidate.type || (candStr.match(/ typ (\w+)/) || [])[1] || "";
      if (t === "srflx" || t === "relay" || t === "prflx") sawSrflxOrRelay = true;
    } else if (sawAnyCandidate && !sawSrflxOrRelay) {
      state.iceGatherHint = "host-only";
      console.warn("[ice] only host candidates gathered — STUN/TURN may be blocked");
    }
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
  pc.oniceconnectionstatechange = () => {
    console.warn("[ice] iceConnectionState", pc.iceConnectionState);
    if (pc.iceConnectionState === "failed") {
      clearConnectWatch();
      setFlash(
      state.iceGatherHint === "host-only"
        ? "Couldn’t connect — network may need TURN (relay)."
        : "Couldn’t connect — network may need TURN. Try Wi‑Fi or cellular, then call again.",
      "error");
      hangup();
      render();
    }
  };
  pc.onconnectionstatechange = () => {
    state.iceState = pc.connectionState;
    if (pc.connectionState === "connected") {
      clearConnectWatch();
      stopDialTone();
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
      startSilenceWatch();
      paintCallLayer();
    }
    if (pc.connectionState === "failed") {
      clearConnectWatch();
      setFlash(
      state.iceGatherHint === "host-only"
        ? "Couldn’t connect — network may need TURN (relay)."
        : "Couldn’t connect — network may need TURN. Try Wi‑Fi or cellular, then call again.",
      "error");
      hangup();
      render();
    }
    // Remote peer (e.g. analog hangup) closed media but signaling hangup was lost.
    if (pc.connectionState === "closed" && state.call && state.pc === pc) {
      stopRing();
      endCallUi("Call ended");
      render();
    }
    if (pc.connectionState === "disconnected") {
      paintCallLayer();
    }
  };
  return pc;
}

async function placeCall(toLineId) {
  if (state.call || state.group) return;
  if (!toLineId || toLineId === state.activeLineId) return;
  exitSpeedDialEditMode();
  setFlash("");
  state.lastRedialLineId = toLineId;
  state.callStartedAt = 0;
  state.pendingIce = [];
  state.onHold = false;
  state.call = { status: "calling", toLineId, fromLineId: state.activeLineId };
  // Kick AudioContext on the user-gesture stack before getUserMedia can suspend it.
  void unlockAudioCtx();
  beginOutboundCallAudio(outboundDigitsFor(toLineId));
  paintCallLayer();
  try {
    await requestWakeLock();
    const pc = await makePc(toLineId);
    // Mic open often leaves Web Audio suspended — re-unlock so DTMF/ringback stay audible.
    await unlockAudioCtx();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // Calling is an explicit take-over: reclaim if another tab/device kicked us,
    // or if the socket dropped during getUserMedia.
    if (state.wsReplaced || !state.ws || state.ws.readyState !== 1) {
      reconnectWs();
    }
    await waitForWsOpen(3000);
    state.ws.send(
      JSON.stringify({
        type: "call.offer",
        fromLineId: state.activeLineId,
        toLineId,
        sdp: sdpPayload(offer),
      })
    );
    // Wait for answer before ICE connect watch; ring timeout → voicemail.
    armRingTimeout();
  } catch (e) {
    setFlash(e.message || "Microphone permission needed", "error");
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
  // Flip off "incoming" before any await so a late startRing() unlock can't restart audio.
  stopRing();
  state.call = { ...msg, status: "connecting" };
  paintCallLayer();
  try {
    await requestWakeLock();
    const pc = await makePc(msg.fromLineId);
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    stopRing();
    state.ws.send(
      JSON.stringify({
        type: "call.answer",
        callId: msg.callId,
        fromLineId: msg.fromLineId,
        toLineId: msg.toLineId,
        sdp: sdpPayload(answer),
      })
    );
    if (state.call?.callId === msg.callId) {
      state.call = { ...state.call, status: "connecting" };
    }
    armConnectWatch();
    paintCallLayer();
  } catch (e) {
    setFlash(e.message || "Could not answer", "error");
    hangup();
    render();
  }
}

async function onAnswer(msg) {
  if (!state.pc) return;
  if (state.pc.signalingState !== "have-local-offer") {
    console.warn("[signal] unexpected answer in state", state.pc.signalingState);
  }
  clearRingTimeout();
  stopDialTone();
  await state.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
  await flushIce();
  state.call = { ...(state.call || {}), status: "connecting", callId: msg.callId };
  armConnectWatch();
  paintCallLayer();
}

function toggleMute() {
  noteCallActivity();
  state.muted = !state.muted;
  if (!state.onHold) setOutboundMicEnabled(!state.muted);
  paintCallLayer();
}

function hangup() {
  if (state.group) {
    leaveGroup();
    return;
  }
  stopRing();
  const kit = nativeCallKit();
  if (kit && isNativeIosShell()) {
    try {
      void kit.endCall({ callId: state.call?.callId || state.pendingNativeCallId });
    } catch {}
  }
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
  if (state.endingCall) return;
  state.endingCall = true;
  try {
  stopRing();
  stopDialTone();
  stopHoldMusic();
  clearSilenceWatch();
  state.onHold = false;
  state.stillPrompt = false;
  stopCallTicker();
  clearConnectWatch();
  clearRingTimeout();
  releaseWakeLock();
  if (state.pc) {
    releaseMicForPc(state.pc);
    try {
      state.pc.close();
    } catch {}
  }
  state.pc = null;
  releaseAllPcMicTracks();
  if (state.localStream && !state.group) {
    parkMicStream();
  }
  state.pendingIce = [];
  state.remoteReady = false;
  state.call = null;
  state.callStartedAt = 0;
  state.iceState = "";
  state.muted = false;
  const audio = remoteAudio();
  if (audio) audio.srcObject = null;
  if (flash) setFlash(flash, "info");
  paintCallLayer();
  } finally {
    state.endingCall = false;
  }
}

function peerAudioEl(lineId) {
  const root = groupAudioRoot();
  if (!root) return null;
  let el = root.querySelector(`audio[data-peer="${lineId}"]`);
  if (!el) {
    el = document.createElement("audio");
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    el.dataset.peer = lineId;
    root.appendChild(el);
  }
  return el;
}

function clearGroupAudio() {
  const root = groupAudioRoot();
  if (root) root.innerHTML = "";
}

function leaveGroup(silent) {
  stopRing();
  stopDialTone();
  stopHoldMusic();
  clearSilenceWatch();
  state.onHold = false;
  state.stillPrompt = false;
  if (!silent && state.ws && state.group?.roomId) {
    state.ws.send(
      JSON.stringify({
        type: "group.leave",
        roomId: state.group.roomId,
        lineId: state.activeLineId,
      })
    );
  }
  for (const peer of Object.values(state.groupPeers)) {
    releaseMicForPc(peer.pc);
    try {
      peer.pc?.close();
    } catch {}
  }
  state.groupPeers = {};
  clearGroupAudio();
  releaseAllPcMicTracks();
  parkMicStream();
  state.group = null;
  state.callStartedAt = 0;
  state.muted = false;
  stopCallTicker();
  clearConnectWatch();
  releaseWakeLock();
  paintCallLayer();
}

function onGroupStarted(msg) {
  state.group = {
    roomId: msg.roomId,
    status: "calling",
    hostLineId: msg.hostLineId,
    members: msg.members || [],
    invited: msg.invited || [],
  };
  paintCallLayer();
}

function onGroupInvite(msg) {
  if (state.call || state.group) {
    state.ws?.send(
      JSON.stringify({ type: "group.reject", roomId: msg.roomId, lineId: state.activeLineId })
    );
    return;
  }
  state.group = {
    roomId: msg.roomId,
    status: "incoming",
    hostLineId: msg.hostLineId,
    fromLineId: msg.fromLineId,
    members: msg.members || [],
    invited: msg.invited || [],
  };
  startRing();
  paintCallLayer();
}

function onGroupPeerDeclined(msg) {
  if (!state.group || state.group.roomId !== msg.roomId) return;
  state.group.invited = msg.invited || [];
  state.group.members = msg.members || state.group.members;
  paintCallLayer();
}

function onGroupPeerLeft(msg) {
  if (!state.group || state.group.roomId !== msg.roomId) return;
  state.group.members = msg.members || [];
  state.group.invited = msg.invited || [];
  const peer = state.groupPeers[msg.lineId];
  if (peer) {
    releaseMicForPc(peer.pc);
    try {
      peer.pc?.close();
    } catch {}
    delete state.groupPeers[msg.lineId];
  }
  const el = groupAudioRoot()?.querySelector(`audio[data-peer="${msg.lineId}"]`);
  el?.remove();
  paintCallLayer();
}

function onGroupEnded(msg) {
  if (state.group && msg.roomId && state.group.roomId !== msg.roomId) return;
  stopRing();
  setFlash(msg.reason || "Group call ended", "info");
  leaveGroup(true);
  render();
}

async function ensureGroupMic() {
  await ensureMicStream();
  armMicForCall();
  return state.localStream;
}

async function makeGroupPc(peerLineId) {
  if (state.groupPeers[peerLineId]?.pc) return state.groupPeers[peerLineId];
  const stream = await ensureGroupMic();
  const pc = new RTCPeerConnection({
    iceServers: await iceServers(),
    iceCandidatePoolSize: 4,
  });
  const stub = state.groupPeers[peerLineId];
  const peer = {
    pc,
    pendingIce: stub?.pendingIce?.length ? [...stub.pendingIce] : [],
    remoteReady: false,
  };
  state.groupPeers[peerLineId] = peer;
  attachLocalMicToPc(pc);
  pc.ontrack = (ev) => {
    const audio = peerAudioEl(peerLineId);
    if (audio) {
      audio.srcObject = ev.streams[0] || new MediaStream([ev.track]);
      audio.play().catch(() => {});
    }
  };
  pc.onicecandidate = (ev) => {
    if (!state.ws || state.ws.readyState !== 1 || !state.group) return;
    state.ws.send(
      JSON.stringify({
        type: "group.ice",
        roomId: state.group.roomId,
        fromLineId: state.activeLineId,
        toLineId: peerLineId,
        candidate: icePayload(ev.candidate),
      })
    );
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      if (!state.callStartedAt) {
        state.callStartedAt = Date.now();
        startCallTicker();
      }
      if (state.group && state.group.status !== "active") {
        state.group.status = "active";
        playConnectChime();
      }
      paintCallLayer();
    }
    paintCallLayer();
  };
  return peer;
}

async function flushGroupIce(peerLineId) {
  const peer = state.groupPeers[peerLineId];
  if (!peer) return;
  peer.remoteReady = true;
  const queued = peer.pendingIce.splice(0);
  for (const c of queued) {
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      console.warn("[group-ice] flush", e);
    }
  }
}

async function groupOfferTo(peerLineId) {
  if (peerLineId === state.activeLineId) return;
  const peer = await makeGroupPc(peerLineId);
  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  state.ws.send(
    JSON.stringify({
      type: "group.offer",
      roomId: state.group.roomId,
      fromLineId: state.activeLineId,
      toLineId: peerLineId,
      sdp: sdpPayload(offer),
    })
  );
}

async function onGroupPeerJoined(msg) {
  if (!state.group || state.group.roomId !== msg.roomId) return;
  state.group.members = msg.members || [];
  state.group.invited = msg.invited || [];
  // Joiner creates offers to everyone already in the room
  if (msg.lineId === state.activeLineId) {
    state.group.status = "connecting";
    stopRing();
    stopDialTone();
    try {
      await ensureGroupMic();
      await requestWakeLock();
      for (const other of state.group.members) {
        if (other !== state.activeLineId) await groupOfferTo(other);
      }
    } catch (e) {
      setFlash(e.message || "Could not join group call", "error");
      leaveGroup();
      render();
      return;
    }
  }
  paintCallLayer();
}

async function onGroupOffer(msg) {
  if (!state.group || state.group.roomId !== msg.roomId) return;
  if (msg.toLineId !== state.activeLineId) return;
  try {
    await ensureGroupMic();
    await requestWakeLock();
    const peer = await makeGroupPc(msg.fromLineId);
    await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await flushGroupIce(msg.fromLineId);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    state.ws.send(
      JSON.stringify({
        type: "group.answer",
        roomId: state.group.roomId,
        fromLineId: state.activeLineId,
        toLineId: msg.fromLineId,
        sdp: sdpPayload(answer),
      })
    );
    if (state.group.status === "calling" || state.group.status === "connecting") {
      state.group.status = "active";
    }
    paintCallLayer();
  } catch (e) {
    console.warn("[group] offer failed", e);
  }
}

async function onGroupAnswer(msg) {
  if (!state.group || state.group.roomId !== msg.roomId) return;
  if (msg.toLineId !== state.activeLineId) return;
  const peer = state.groupPeers[msg.fromLineId];
  if (!peer) return;
  await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
  await flushGroupIce(msg.fromLineId);
  if (state.group.status !== "active") state.group.status = "active";
  paintCallLayer();
}

async function onGroupIce(msg) {
  if (!state.group || state.group.roomId !== msg.roomId) return;
  if (msg.toLineId !== state.activeLineId) return;
  const peer = state.groupPeers[msg.fromLineId];
  if (!peer || !peer.remoteReady) {
    if (msg.candidate) {
      if (!peer) state.groupPeers[msg.fromLineId] = { pc: null, pendingIce: [msg.candidate], remoteReady: false };
      else peer.pendingIce.push(msg.candidate);
    }
    return;
  }
  try {
    await peer.pc.addIceCandidate(msg.candidate ? new RTCIceCandidate(msg.candidate) : null);
  } catch (e) {
    console.warn("[group-ice]", e);
  }
}

async function acceptGroupCall() {
  if (!state.group?.roomId) return;
  stopRing();
  try {
    await ensureGroupMic();
    await requestWakeLock();
    state.group.status = "connecting";
    paintCallLayer();
    state.ws.send(
      JSON.stringify({
        type: "group.accept",
        roomId: state.group.roomId,
        lineId: state.activeLineId,
      })
    );
  } catch (e) {
    setFlash(e.message || "Could not answer", "error");
    leaveGroup();
    render();
  }
}

function startGroupCall(toLineIds) {
  if (state.call || state.group) return;
  if (state.wsReplaced || !state.ws || state.ws.readyState !== 1) {
    reconnectWs();
  }
  if (!state.ws || state.ws.readyState !== 1) {
    setFlash("Not connected yet — wait a second", "warn");
    render();
    return;
  }
  const ids = [...new Set((toLineIds || []).filter((id) => id && id !== state.activeLineId))].slice(
    0,
    MAX_GROUP - 1
  );
  if (!ids.length) {
    setFlash("Pick at least one contact", "warn");
    render();
    return;
  }
  setFlash("");
  state.groupPick = [];
  state.group = {
    roomId: null,
    status: "calling",
    hostLineId: state.activeLineId,
    members: [state.activeLineId],
    invited: ids,
  };
  state.groupPeers = {};
  state.onHold = false;
  state.screen = "home";
  beginOutboundCallAudio(ids.map((_, i) => String((i % 9) + 1)).join("").slice(0, 3) || "1");
  paintCallLayer();
  requestWakeLock().catch(() => {});
  ensureGroupMic()
    .then(() => unlockAudioCtx())
    .catch((e) => {
      setFlash(e.message || "Microphone needed", "error");
      leaveGroup(true);
      render();
    });
  state.ws.send(
    JSON.stringify({
      type: "group.start",
      fromLineId: state.activeLineId,
      toLineIds: ids,
    })
  );
}

function rejectGroupCall() {
  if (state.group?.roomId && state.ws?.readyState === 1) {
    state.ws.send(
      JSON.stringify({
        type: "group.reject",
        roomId: state.group.roomId,
        lineId: state.activeLineId,
      })
    );
  }
  leaveGroup(true);
}

const vmMonitorAudio = () => document.getElementById("vm-monitor-audio");

function paintVmMonitor() {
  const root = callRoot();
  if (!root) return;
  if (state.call || state.group) return;
  const mon = state.vmMonitor;
  if (!mon || mon.role !== "callee") {
    if (!state.call && !state.group && root.querySelector(".vm-monitor-stage")) {
      root.innerHTML = "";
    }
    return;
  }
  const who = mon.fromLabel || lineName(mon.fromLineId);
  root.innerHTML = `
    <div id="call-layer" class="call-stage vm-monitor-stage">
      <div class="call-stage-bg vm-monitor-bg" aria-hidden="true"></div>
      <div class="call-card vm-monitor-card">
        <p class="call-kicker">Answering machine…</p>
        <div class="call-avatar-wrap pulse">
          <span class="call-ring"></span>
          ${avatarHtml(who, mon.fromLineId, "lg")}
        </div>
        <h2 class="call-who">${who}</h2>
        <p class="call-media">Playing message out loud as it’s left</p>
        <div class="call-actions in-call">
          <button class="ghost" id="vm-monitor-ignore">Stop speaker</button>
        </div>
      </div>
    </div>`;
  document.getElementById("vm-monitor-ignore")?.addEventListener("click", () => {
    // Stops local speaker only — voicemail is still saved by the caller.
    stopVmMonitor({ notifyPeer: true });
  });
}

function stopVmMonitor({ notifyPeer = false } = {}) {
  const mon = state.vmMonitor;
  if (notifyPeer && mon && state.ws && state.ws.readyState === 1) {
    state.ws.send(
      JSON.stringify({
        type: "voicemail.monitor.stop",
        fromLineId: mon.fromLineId,
        toLineId: mon.toLineId,
      })
    );
  }
  try {
    state.vmMonitorPc?.close();
  } catch {}
  state.vmMonitorPc = null;
  state.vmMonitorPendingIce = [];
  state.vmMonitorRemoteReady = false;
  state.vmMonitor = null;
  const audio = vmMonitorAudio();
  if (audio) {
    audio.srcObject = null;
    try {
      audio.pause();
    } catch {}
  }
  if (!state.call && !state.group) {
    const root = callRoot();
    if (root) root.innerHTML = "";
  }
}

/** Silence persistent call/monitor speakers — leave-a-message must not leave audio playing on the caller. */
function silenceCallerSoftphoneAudio() {
  stopVmMonitor({ notifyPeer: false });
  for (const el of [remoteAudio(), vmMonitorAudio()]) {
    if (!el) continue;
    try {
      el.srcObject = null;
      el.removeAttribute("src");
      el.pause();
      el.load?.();
    } catch {}
  }
}

async function startVmMonitorAsCaller(toLineId, stream) {
  if (!state.ws || state.ws.readyState !== 1 || !toLineId || !stream) return;
  // Never stream-monitor to our own line (would play the recording on the caller).
  if (toLineId === state.activeLineId) return;
  stopVmMonitor({ notifyPeer: false });
  const fromLineId = state.activeLineId;
  state.vmMonitor = { role: "caller", fromLineId, toLineId };
  state.vmMonitorPendingIce = [];
  state.vmMonitorRemoteReady = false;
  try {
    const pc = new RTCPeerConnection({
      iceServers: await iceServers(),
      iceCandidatePoolSize: 2,
    });
    state.vmMonitorPc = pc;
    for (const track of stream.getAudioTracks()) {
      pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    }
    // One-way only — ignore any remote track so the caller never hears themselves.
    pc.ontrack = () => {};
    pc.onicecandidate = (ev) => {
      if (!state.ws || state.ws.readyState !== 1 || !state.vmMonitor) return;
      state.ws.send(
        JSON.stringify({
          type: "voicemail.monitor.ice",
          fromLineId,
          toLineId,
          candidate: icePayload(ev.candidate),
        })
      );
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    state.ws.send(
      JSON.stringify({
        type: "voicemail.monitor.offer",
        fromLineId,
        toLineId,
        sdp: sdpPayload(offer),
      })
    );
  } catch (e) {
    console.warn("[vm-monitor] caller start failed", e);
    stopVmMonitor({ notifyPeer: false });
  }
}

async function onVmMonitorOffer(msg) {
  if (!msg?.toLineId || msg.toLineId !== state.activeLineId) return;
  // Never live-play our own outbound leave-a-message on this device.
  if (!msg.fromLineId || msg.fromLineId === state.activeLineId) return;
  if (state.screen === "leave-message") return;
  const line = activeLine();
  // Opt-in only — never auto-play if this line left answering machine off.
  if (!line?.answering_machine) return;
  if (state.call || state.group) return;
  stopVmMonitor({ notifyPeer: false });
  const fromLineId = msg.fromLineId;
  const toLineId = msg.toLineId;
  state.vmMonitor = {
    role: "callee",
    fromLineId,
    toLineId,
    fromLabel: friendlyPersonName(lineName(fromLineId)),
  };
  state.vmMonitorPendingIce = [];
  state.vmMonitorRemoteReady = false;
  try {
    await unlockAudioCtx();
    const pc = new RTCPeerConnection({
      iceServers: await iceServers(),
      iceCandidatePoolSize: 2,
    });
    state.vmMonitorPc = pc;
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (ev) => {
      const audio = vmMonitorAudio();
      if (!audio) return;
      audio.srcObject = ev.streams[0] || new MediaStream([ev.track]);
      const kick = () => audio.play().catch(() => {});
      kick();
      audio.onloadedmetadata = kick;
    };
    pc.onicecandidate = (ev) => {
      if (!state.ws || state.ws.readyState !== 1 || !state.vmMonitor) return;
      state.ws.send(
        JSON.stringify({
          type: "voicemail.monitor.ice",
          fromLineId,
          toLineId,
          candidate: icePayload(ev.candidate),
        })
      );
    };
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    state.vmMonitorRemoteReady = true;
    const queued = state.vmMonitorPendingIce.splice(0);
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c ? new RTCIceCandidate(c) : null);
      } catch {}
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    state.ws.send(
      JSON.stringify({
        type: "voicemail.monitor.answer",
        fromLineId,
        toLineId,
        sdp: sdpPayload(answer),
      })
    );
    paintVmMonitor();
  } catch (e) {
    console.warn("[vm-monitor] callee offer failed", e);
    stopVmMonitor({ notifyPeer: false });
  }
}

async function onVmMonitorAnswer(msg) {
  const pc = state.vmMonitorPc;
  const mon = state.vmMonitor;
  if (!pc || !mon || mon.role !== "caller") return;
  if (msg.toLineId !== mon.toLineId || msg.fromLineId !== mon.fromLineId) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    state.vmMonitorRemoteReady = true;
    const queued = state.vmMonitorPendingIce.splice(0);
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c ? new RTCIceCandidate(c) : null);
      } catch {}
    }
  } catch (e) {
    console.warn("[vm-monitor] answer failed", e);
  }
}

async function onVmMonitorIce(msg) {
  const pc = state.vmMonitorPc;
  const mon = state.vmMonitor;
  if (!mon) return;
  if (!pc || !state.vmMonitorRemoteReady) {
    state.vmMonitorPendingIce.push(msg.candidate);
    return;
  }
  try {
    await pc.addIceCandidate(msg.candidate ? new RTCIceCandidate(msg.candidate) : null);
  } catch {}
}

function onVmMonitorStop(_msg) {
  stopVmMonitor({ notifyPeer: false });
}

function onVmMonitorSkip(_msg) {
  // Recipient offline or answering machine off — leave-a-message still works silently.
  if (state.vmMonitor?.role === "caller") {
    try {
      state.vmMonitorPc?.close();
    } catch {}
    state.vmMonitorPc = null;
    state.vmMonitor = null;
    state.vmMonitorPendingIce = [];
    state.vmMonitorRemoteReady = false;
  }
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

function friendlyPersonName(raw) {
  return String(raw || "")
    .replace(/'s phone$/i, "")
    .replace(/\s+phone$/i, "")
    .trim() || "Friend";
}

/** Prefer custom label; fall back when old rows were saved as generic "Contact". */
function contactDisplayName(entry) {
  const label = String(entry?.label || "").trim();
  if (label && !/^contact$/i.test(label)) return label;
  return friendlyPersonName(lineName(entry?.target_line_id));
}

/** Short pad caption — name only (no slot digit). CSS ellipsis handles overflow. */
function speedPadLabel(name) {
  let s = String(name || "").trim();
  // Strip accidental slot prefixes like "1 Beckett" / "1 · Beckett" / "0 Parent".
  s = s.replace(/^\d+\s*[·.\-:]\s*/, "").replace(/^\d+\s+/, "").trim();
  return s;
}

/** External allowlist only — never the active softphone line or household siblings. */
function externalAllowlist(hh = state.households[0]) {
  const active = state.activeLineId;
  const ourIds = new Set((hh?.lines || []).map((l) => l.id));
  return (hh?.allowlist || []).filter(
    (a) => a.target_line_id && a.target_line_id !== active && !ourIds.has(a.target_line_id)
  );
}

/**
 * Designated Home / dial-0 parent: first household line with mode parent
 * (not child), ordered by created_at then id. Matches server householdHomeParentLine.
 */
function householdHomeParentLine(hh = state.households[0]) {
  return (
    (hh?.lines || [])
      .filter((l) => l.id && (l.mode || "parent") !== "child")
      .slice()
      .sort((a, b) =>
        String(a.created_at || a.id).localeCompare(String(b.created_at || b.id))
      )[0] || null
  );
}

/** Next free speed-dial 1–9; marks `taken`. */
function claimSpeedDialSlot(taken) {
  for (let s = 1; s <= 9; s++) {
    if (!taken.has(s)) {
      taken.add(s);
      return s;
    }
  }
  return null;
}

/**
 * Speed-dial / call targets for the active softphone:
 * Home (0) = designated parent, other household lines (1–9) + external allowlist, never self.
 *
 * On a parent line pad, household child lines always default to the earliest slots
 * (primary kid → 1). House lines are not rearrangeable; externals that collide are
 * shifted to the next free pad slots for display. Kid pads still respect stored
 * external speed dials first so parent-arranged contacts stay put.
 */
function dialableAllowlist(hh = state.households[0]) {
  const active = state.activeLineId;
  const external = externalAllowlist(hh);
  const homeParent = householdHomeParentLine(hh);
  const homeParentId = homeParent?.id || null;
  const activeLine = (hh?.lines || []).find((l) => l.id === active) || null;
  // Parent softphone: child line(s) own slot 1+ by default. Kid softphone: keep
  // external layout priority (parent may have arranged 1–9 for the handset).
  const parentPad = Boolean(activeLine) && (activeLine.mode || "parent") !== "child";

  const siblingLines = (hh?.lines || [])
    .filter((l) => l.id && l.id !== active)
    // Parent lives on locked slot 0 — do not also auto-place on 1–9.
    .filter((l) => l.id !== homeParentId)
    .slice()
    .sort((a, b) => {
      if (parentPad) {
        const aChild = (a.mode || "parent") === "child" ? 0 : 1;
        const bChild = (b.mode || "parent") === "child" ? 0 : 1;
        if (aChild !== bChild) return aChild - bChild;
      }
      return String(a.created_at || a.id).localeCompare(String(b.created_at || b.id));
    });

  const taken = new Set();
  const toSiblingEntry = (l, speed) => {
    const label = l.child_label || friendlyPersonName(l.name) || "Family";
    return {
      id: `hh-line-${l.id}`,
      target_line_id: l.id,
      label,
      speed_dial: speed,
      favorite: 1,
      always_allow: 1,
      mutual: true,
      household_line: true,
    };
  };

  let siblings;
  let externalsOut;
  if (parentPad) {
    siblings = siblingLines.map((l) => toSiblingEntry(l, claimSpeedDialSlot(taken)));
    externalsOut = external.map((a) => {
      const want = Number(a.speed_dial);
      let speed = Number.isInteger(want) && want >= 1 && want <= 9 ? want : null;
      if (speed == null || taken.has(speed)) {
        speed = claimSpeedDialSlot(taken);
      } else {
        taken.add(speed);
      }
      return speed === a.speed_dial ? a : { ...a, speed_dial: speed };
    });
  } else {
    for (const a of external) {
      const n = Number(a.speed_dial);
      if (Number.isInteger(n) && n >= 1 && n <= 9) taken.add(n);
    }
    siblings = siblingLines.map((l) => toSiblingEntry(l, claimSpeedDialSlot(taken)));
    externalsOut = external;
  }

  const out = [...siblings, ...externalsOut];
  // Slot 0: Home / parent — synthesized, locked. Skip when active line is that parent.
  if (homeParent && homeParent.id !== active) {
    out.unshift({
      id: `hh-home-0-${homeParent.id}`,
      target_line_id: homeParent.id,
      label: homeParent.child_label || friendlyPersonName(homeParent.name) || "Home",
      speed_dial: 0,
      favorite: 1,
      always_allow: 1,
      mutual: true,
      household_line: true,
      home_parent: true,
      locked_slot: true,
    });
  }
  return out;
}

function lineHasAvatar(lineId) {
  if (!lineId) return false;
  const fromDir = state.directory.find((x) => x.id === lineId);
  if (fromDir?.has_avatar) return true;
  for (const hh of state.households || []) {
    const line = (hh.lines || []).find((l) => l.id === lineId);
    if (line?.has_avatar) return true;
  }
  return false;
}

function lineAvatarUpdatedAt(lineId) {
  const fromDir = state.directory.find((x) => x.id === lineId);
  if (fromDir?.avatar_updated_at) return fromDir.avatar_updated_at;
  for (const hh of state.households || []) {
    const line = (hh.lines || []).find((l) => l.id === lineId);
    if (line?.avatar_updated_at) return line.avatar_updated_at;
  }
  return "";
}

/** Authenticated img URL for a line's profile picture (null if none). */
function lineAvatarUrl(lineId) {
  if (!lineId || !state.sessionId || !lineHasAvatar(lineId)) return null;
  const v = lineAvatarUpdatedAt(lineId);
  const q = v ? `&v=${encodeURIComponent(v)}` : "";
  return `/api/lines/${encodeURIComponent(lineId)}/avatar?sid=${encodeURIComponent(state.sessionId)}${q}`;
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

/** Name variants for speed-dial face — fullest first, then shorter fallbacks. */
function speedFaceNameVariants(name) {
  const cleaned = friendlyPersonName(name);
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return ["?"];
  const variants = [];
  const push = (s) => {
    const t = String(s || "").trim();
    if (t && !variants.includes(t)) variants.push(t);
  };
  push(parts.join(" "));
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    push(`${parts[0]} ${last[0].toUpperCase()}.`);
    push(parts[0]);
  }
  if (parts[0].length > 10) push(`${parts[0].slice(0, 9)}…`);
  return variants;
}

/**
 * Shrink / shorten .speed-initials text so as much of the name as possible
 * fits inside the dial circle (2–3 lines; ellipsis only as last resort).
 */
function fitSpeedFaceNames(root = document) {
  root.querySelectorAll(".speed-initials").forEach((el) => {
    const key = el.closest(".speed-initials-key");
    if (!key) return;
    const full = el.getAttribute("data-full-name") || el.textContent || "?";
    const variants = speedFaceNameVariants(full);
    const maxH = Math.max(24, key.clientHeight * 0.82);
    const maxW = Math.max(24, key.clientWidth * 0.88);
    el.style.maxWidth = `${maxW}px`;
    let chosen = { text: variants[variants.length - 1], size: 8 };
    for (const text of variants) {
      el.textContent = text;
      let size = Math.min(17, Math.max(11, key.clientWidth * 0.22));
      const min = 8;
      el.style.fontSize = `${size}px`;
      while (size > min && (el.scrollHeight > maxH + 1 || el.scrollWidth > maxW + 1)) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
      if (el.scrollHeight <= maxH + 1 && el.scrollWidth <= maxW + 1) {
        chosen = { text, size };
        break;
      }
      if (size >= chosen.size) chosen = { text, size };
    }
    el.textContent = chosen.text;
    el.style.fontSize = `${chosen.size}px`;
  });
}

/* PhoneHome palette variety: forest/sage/teal + panel-olive + --ok + accent gold. */
const AVATAR_HUES = [122, 138, 148, 160, 172, 145, 40, 46];

function avatarStyle(seed) {
  let h = 0;
  const s = String(seed || "x");
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * 17) % AVATAR_HUES.length;
  const hue = AVATAR_HUES[h];
  /* Amber needs a bit more sat so it reads gold (not mud); --ok a touch brighter. Dark enough for --ink. */
  const amber = hue < 60;
  const okish = hue >= 140 && hue <= 150;
  const satTop = amber ? 44 : okish ? 38 : 34;
  const lightTop = amber ? 28 : okish ? 34 : 30;
  const satBot = amber ? 38 : okish ? 32 : 28;
  const lightBot = amber ? 13 : okish ? 16 : 14;
  return `background: linear-gradient(145deg, hsl(${hue} ${satTop}% ${lightTop}%), hsl(${hue} ${satBot}% ${lightBot}%));`;
}

function avatarHtml(name, seed, sizeClass = "", photoUrl = null) {
  const url = photoUrl === undefined || photoUrl === null ? lineAvatarUrl(seed) : photoUrl;
  if (url) {
    return `<div class="avatar has-photo ${sizeClass}" aria-hidden="true"><img src="${url}" alt="" /></div>`;
  }
  return `<div class="avatar ${sizeClass}" style="${avatarStyle(seed)}" aria-hidden="true">${initials(name)}</div>`;
}

/** Center-crop to a square JPEG (nightwatch-style upload without a crop UI). */
function squareCropToJpeg(file, size = 512) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not prepare image");
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
        URL.revokeObjectURL(url);
        resolve({ dataUrl, mime: "image/jpeg" });
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}

function ensureAudioCtx() {
  try {
    const ctx = state.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    state.audioCtx = ctx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Await resume — getUserMedia / backgrounding often leaves the context suspended (silent tones). */
async function unlockAudioCtx() {
  const ctx = ensureAudioCtx();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {}
  }
  return ctx;
}

function householdRingVolume() {
  const v = Number(state.households[0]?.ring_volume);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 70;
}

function householdRingerStyle() {
  const s = state.households[0]?.ringer_style || "classic";
  return ["classic", "chirp", "modern", "chime", "urgent"].includes(s) ? s : "classic";
}

/** Map 0–100 household volume onto a base Web Audio gain (incoming ringer). */
function toneGain(base = 0.05) {
  return base * (householdRingVolume() / 70);
}

/**
 * Outbound progress (dial / DTMF / ringback) stays audible even when incoming
 * ring volume is turned down — that slider is for the room ringer, not the handset.
 */
function progressGain(base = 0.05) {
  return Math.max(base * 0.65, toneGain(base));
}

function ringIntervalMs(style) {
  if (style === "urgent") return 1100;
  if (style === "chirp") return 1600;
  if (style === "chime") return 2800;
  if (style === "modern") return 2000;
  // Mechanical bell double-ring + long rest (room ringer cadence)
  return 6000;
}

/**
 * One burst of a 90s electromechanical bell: dual gongs + ~20 Hz clapper AM.
 * Incoming only — never use network ringback (440+480) for the room ringer.
 */
function playMechanicalBellBurst(dur, gain) {
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const level = Math.max(0.0001, gain);
    const master = ctx.createGain();
    master.gain.value = level * 0.55;
    master.connect(ctx.destination);

    const t0 = ctx.currentTime;
    const stopAt = t0 + dur;
    const nodes = [];

    // Two brass gongs (slightly inharmonic partials — metallic, not sine progress tones)
    const gongs = [
      { base: 980, partials: [1, 2.05, 2.72, 3.85], amp: [0.55, 0.22, 0.14, 0.08] },
      { base: 1280, partials: [1, 1.97, 2.65, 3.7], amp: [0.5, 0.2, 0.12, 0.07] },
    ];
    for (const gong of gongs) {
      gong.partials.forEach((p, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = i === 0 ? "triangle" : "square";
        o.frequency.value = gong.base * p;
        g.gain.value = gong.amp[i] * 0.45;
        o.connect(g);
        g.connect(master);
        o.start(t0);
        o.stop(stopAt + 0.04);
        nodes.push(o, g);
      });
    }

    // Clapper driven by ~20 Hz ringing voltage
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.type = "square";
    lfo.frequency.value = 20;
    lfoDepth.gain.value = level * 0.45;
    lfo.connect(lfoDepth);
    lfoDepth.connect(master.gain);
    lfo.start(t0);
    lfo.stop(stopAt + 0.02);
    nodes.push(lfo, lfoDepth);

    master.gain.setValueAtTime(level * 0.55, t0);
    master.gain.setValueAtTime(level * 0.55, Math.max(t0 + 0.05, stopAt - 0.06));
    master.gain.exponentialRampToValueAtTime(0.001, stopAt);

    const handle = {
      stop() {
        for (const n of nodes) {
          try {
            n.stop?.();
          } catch {}
          try {
            n.disconnect?.();
          } catch {}
        }
        try {
          master.disconnect();
        } catch {}
      },
    };
    if (!state.ringLive) state.ringLive = [];
    state.ringLive.push(handle);
    setTimeout(() => {
      if (state.ringLive) state.ringLive = state.ringLive.filter((h) => h !== handle);
    }, (dur + 0.08) * 1000);
  } catch {}
}

/** One cycle of the selected incoming ringer (no assets — pure oscillators). */
function ringPattern(style = householdRingerStyle()) {
  const g = (base) => toneGain(base);
  if (style === "chirp") {
    return () => {
      playTone(880, 0.08, g(0.05), "sine");
      setTimeout(() => playTone(1175, 0.1, g(0.045), "sine"), 90);
      setTimeout(() => playTone(1480, 0.12, g(0.04), "sine"), 200);
    };
  }
  if (style === "modern") {
    return () => {
      playDualTone(520, 780, 0.28, g(0.05));
      setTimeout(() => playDualTone(520, 780, 0.28, g(0.045)), 380);
    };
  }
  if (style === "chime") {
    return () => {
      playTone(523, 0.35, g(0.04), "sine");
      setTimeout(() => playTone(659, 0.4, g(0.035), "sine"), 180);
      setTimeout(() => playTone(784, 0.5, g(0.03), "sine"), 400);
    };
  }
  if (style === "urgent") {
    return () => {
      playTone(880, 0.12, g(0.07), "square");
      setTimeout(() => playTone(880, 0.12, g(0.065), "square"), 160);
      setTimeout(() => playTone(880, 0.18, g(0.06), "square"), 320);
    };
  }
  // Default / classic: 90s room bell — mechanical double-ring (not US ringback 440+480).
  return () => {
    playMechanicalBellBurst(0.55, g(0.085));
    const t = setTimeout(() => playMechanicalBellBurst(0.55, g(0.08)), 800);
    if (!state.ringSampleTimers) state.ringSampleTimers = [];
    state.ringSampleTimers.push(t);
  };
}

function playRingerSample(style) {
  stopRing();
  void unlockAudioCtx().then(() => {
    const s = style || householdRingerStyle();
    ringPattern(s)();
  });
}

function playTone(freq, dur = 0.18, gain = 0.06, type = "sine") {
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    const level = Math.max(0.0001, gain);
    g.gain.value = level;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.stop(ctx.currentTime + dur);
  } catch {}
}

/**
 * Dual sine sum with a near-rectangular envelope (telephony, not a soft beep).
 * Optional highTwistDb boosts f2 (DTMF high group is typically ~2 dB hotter).
 */
function playDualTone(f1, f2, dur = 0.16, gain = 0.05, { highTwistDb = 0 } = {}) {
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const level = Math.max(0.0001, gain);
    const twist = Math.pow(10, highTwistDb / 20);
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    // Split level across the two tones so peaks stay ~level (not 2×).
    g1.gain.value = 0.5;
    g2.gain.value = 0.5 * twist;
    g1.connect(master);
    g2.connect(master);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = "sine";
    o2.type = "sine";
    o1.frequency.value = f1;
    o2.frequency.value = f2;
    o1.connect(g1);
    o2.connect(g2);
    const t0 = ctx.currentTime;
    const attack = Math.min(0.005, dur * 0.15);
    const release = Math.min(0.008, dur * 0.2);
    const sustainEnd = Math.max(t0 + attack, t0 + dur - release);
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.linearRampToValueAtTime(level, t0 + attack);
    master.gain.setValueAtTime(level, sustainEnd);
    master.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o1.start(t0);
    o2.start(t0);
    o1.stop(t0 + dur + 0.02);
    o2.stop(t0 + dur + 0.02);
  } catch {}
}

/**
 * ITU-T Q.23 / Bell DTMF matrix (low group × high group).
 * Rows: 697, 770, 852, 941 Hz — Cols: 1209, 1336, 1477 Hz (1633 = A–D unused here).
 */
const DTMF_FREQS = {
  1: [697, 1209],
  2: [697, 1336],
  3: [697, 1477],
  4: [770, 1209],
  5: [770, 1336],
  6: [770, 1477],
  7: [852, 1209],
  8: [852, 1336],
  9: [852, 1477],
  "*": [941, 1209],
  0: [941, 1336],
  "#": [941, 1477],
};

/** One DTMF key: dual tones + ~2 dB high-group twist (North American practice). */
function playDtmf(digit, dur = 0.1, gain) {
  const pair = DTMF_FREQS[String(digit)] || DTMF_FREQS["0"];
  playDualTone(pair[0], pair[1], dur, gain ?? progressGain(0.07), { highTwistDb: 2 });
}

/**
 * Play a DTMF digit string; returns ms until the last digit finishes (no trailing gap).
 * Defaults ~100 ms tone / 100 ms gap (landline auto-dial feel; ITU Q.24 mins are 40/40).
 * Outbound call path passes longer digitMs/gapMs for deliberate pacing before ringback.
 */
function playDtmfSequence(digits, { digitMs = 100, gapMs = 100 } = {}) {
  const keys = String(digits || "").split("").filter((d) => DTMF_FREQS[d]);
  if (!keys.length) return 0;
  const timers = [];
  keys.forEach((d, i) => {
    const t = setTimeout(() => {
      void unlockAudioCtx().then(() => playDtmf(d, digitMs / 1000));
    }, i * (digitMs + gapMs));
    timers.push(t);
  });
  if (!state.outboundSeqTimers) state.outboundSeqTimers = [];
  state.outboundSeqTimers.push(...timers);
  // Last digit starts at (n-1)*(digit+gap) and lasts digitMs.
  return (keys.length - 1) * (digitMs + gapMs) + digitMs;
}

function playConnectChime() {
  playTone(523, 0.12, toneGain(0.05));
  setTimeout(() => playTone(784, 0.18, toneGain(0.05)), 90);
}

function clearOutboundSeqTimers() {
  if (state.outboundSeqTimers?.length) {
    state.outboundSeqTimers.forEach((t) => clearTimeout(t));
  }
  state.outboundSeqTimers = null;
}

/** Stop dial tone, ringback, and any pending outbound dial sequence. */
function stopDialTone() {
  stopOutboundProgress();
}

function stopOutboundProgress() {
  clearOutboundSeqTimers();
  // Invalidate in-flight async unlock → dial → DTMF → ringback steps
  state.outboundSeqId = (state.outboundSeqId || 0) + 1;
  try {
    state.dialTone?.stop?.();
  } catch {}
  state.dialTone = null;
  try {
    if (state.ringback?.timer) clearInterval(state.ringback.timer);
    if (state.ringback?.offTimer) clearTimeout(state.ringback.offTimer);
    state.ringback?.stop?.();
  } catch {}
  state.ringback = null;
}

/**
 * North American Precise Tone Plan dial tone: continuous 350 Hz + 440 Hz
 * (equal amplitude). Plays steady until stop / durationSec (off-hook before digits).
 */
function startDialTone(durationSec = 1.5) {
  try {
    state.dialTone?.stop?.();
  } catch {}
  state.dialTone = null;
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const master = ctx.createGain();
    const level = Math.max(0.0001, progressGain(0.055));
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    g1.gain.value = 0.5;
    g2.gain.value = 0.5;
    g1.connect(master);
    g2.connect(master);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = "sine";
    o2.type = "sine";
    o1.frequency.value = 350;
    o2.frequency.value = 440;
    o1.connect(g1);
    o2.connect(g2);
    const t0 = ctx.currentTime;
    const stopAt = t0 + durationSec;
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.linearRampToValueAtTime(level, t0 + 0.01);
    master.gain.setValueAtTime(level, Math.max(t0 + 0.01, stopAt - 0.04));
    master.gain.linearRampToValueAtTime(0.0001, stopAt);
    o1.start(t0);
    o2.start(t0);
    o1.stop(stopAt + 0.02);
    o2.stop(stopAt + 0.02);
    const auto = setTimeout(() => {
      try {
        state.dialTone?.stop?.();
      } catch {}
      if (state.dialTone?.auto === auto) state.dialTone = null;
    }, durationSec * 1000 + 40);
    state.dialTone = {
      auto,
      stop() {
        clearTimeout(auto);
        try {
          o1.stop();
          o2.stop();
        } catch {}
        try {
          master.disconnect();
        } catch {}
      },
    };
  } catch {}
}

/**
 * Classic US ringback: 440 + 480 Hz, ~2s on / 4s silence, until answer/hangup.
 * Caller only — do not use for incoming room ringer.
 */
function startRingback() {
  try {
    if (state.ringback?.timer) clearInterval(state.ringback.timer);
    if (state.ringback?.offTimer) clearTimeout(state.ringback.offTimer);
    state.ringback?.stop?.();
  } catch {}
  state.ringback = null;
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    let live = null;
    const handle = {
      timer: null,
      offTimer: null,
      stop() {
        if (handle.timer) clearInterval(handle.timer);
        if (handle.offTimer) clearTimeout(handle.offTimer);
        handle.timer = null;
        handle.offTimer = null;
        try {
          live?.stop?.();
        } catch {}
        live = null;
      },
    };
    const stopBurst = () => {
      if (handle.offTimer) clearTimeout(handle.offTimer);
      handle.offTimer = null;
      try {
        live?.stop?.();
      } catch {}
      live = null;
    };
    const startBurst = () => {
      stopBurst();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const g = ctx.createGain();
      const level = Math.max(0.0001, progressGain(0.045));
      g.gain.value = level;
      g.connect(ctx.destination);
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = "sine";
      o2.type = "sine";
      o1.frequency.value = 440;
      o2.frequency.value = 480;
      o1.connect(g);
      o2.connect(g);
      o1.start();
      o2.start();
      live = {
        stop() {
          try {
            o1.stop();
            o2.stop();
          } catch {}
          try {
            g.disconnect();
          } catch {}
        },
      };
      handle.offTimer = setTimeout(stopBurst, 2000);
    };
    startBurst();
    handle.timer = setInterval(startBurst, 6000);
    state.ringback = handle;
  } catch {}
}

function outboundStillWaiting() {
  if (state.group) {
    const st = state.group.status;
    return st === "calling";
  }
  if (!state.call) return false;
  const st = state.call.status;
  if (st !== "calling" && st !== "ringing") return false;
  return state.call.fromLineId === state.activeLineId;
}

/**
 * Digits to play when placing a call — always a multi-digit landline-ish train
 * (7 digits) so DTMF cadence is audible; speed-dial slot becomes the last digit.
 */
function outboundDigitsFor(toLineId) {
  const hh = state.households?.[0];
  const entry = (hh?.allowlist || []).find((a) => a.target_line_id === toLineId);
  let n = 0;
  const s = String(toLineId || "0");
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  // Local-looking 7-digit body (avoid leading 0/1); not a real NANP number.
  let body = String(2000000 + (n % 8000000)).padStart(7, "2").slice(0, 7);
  if (entry?.speed_dial != null && entry.speed_dial !== "") {
    const slot = String(entry.speed_dial).replace(/\D/g, "").slice(-1) || "0";
    body = body.slice(0, 6) + slot;
  }
  return body;
}

/**
 * Landline outbound progress: dial tone → DTMF train → US ringback until answer/end.
 * Uses a sequence id so stale timers from a prior call cannot clobber a new one.
 */
function beginOutboundCallAudio(digits) {
  stopOutboundProgress();
  const seqId = (state.outboundSeqId = (state.outboundSeqId || 0) + 1);
  const stillMine = () => state.outboundSeqId === seqId && outboundStillWaiting();

  // Longer off-hook + deliberate digit train before ringback (landline feel).
  // Digit timing above ITU mins (40/40) — closer to human keypad / theatrical dial.
  const dialMs = 1600;
  const digitMs = 220;
  const gapMs = 120;
  const afterDtmfPadMs = 480;

  const armTimers = (timers) => {
    if (!state.outboundSeqTimers) state.outboundSeqTimers = [];
    state.outboundSeqTimers.push(...timers);
  };

  void unlockAudioCtx().then((ctx) => {
    if (!stillMine() || !ctx) return;
    startDialTone(dialMs / 1000);
    const afterDial = setTimeout(() => {
      try {
        state.dialTone?.stop?.();
      } catch {}
      state.dialTone = null;
      if (!stillMine()) return;
      void unlockAudioCtx().then(() => {
        if (!stillMine()) return;
        const dtmfMs = playDtmfSequence(digits, { digitMs, gapMs });
        const afterDtmf = setTimeout(() => {
          if (!stillMine()) return;
          void unlockAudioCtx().then(() => {
            if (!stillMine()) return;
            startRingback();
          });
        }, Math.max(dtmfMs, 80) + afterDtmfPadMs);
        armTimers([afterDtmf]);
      });
    }, dialMs);
    armTimers([afterDial]);
  });
}

function stopHoldMusic() {
  try {
    if (state.holdMusic?.timer) clearInterval(state.holdMusic.timer);
    if (state.holdMusic?.raf) cancelAnimationFrame(state.holdMusic.raf);
    state.holdMusic?.stop?.();
  } catch {}
  state.holdMusic = null;
}

/** Active PeerConnections that send our mic (1:1 + group mesh). */
function outboundPeerConnections() {
  const pcs = [];
  if (state.pc) pcs.push(state.pc);
  for (const peer of Object.values(state.groupPeers || {})) {
    if (peer?.pc) pcs.push(peer.pc);
  }
  return pcs;
}

/** Swap the outbound audio track on every call PC (mic ↔ hold music). */
async function replaceOutboundAudio(track) {
  const jobs = [];
  for (const pc of outboundPeerConnections()) {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "audio") continue;
      jobs.push(sender.replaceTrack(track));
    }
  }
  try {
    await Promise.all(jobs);
  } catch (err) {
    console.warn("[hold] replaceTrack failed", err);
  }
}

/**
 * 90s office hold music (synthesized) — soft electric-piano muzak loop.
 * Routed to a MediaStreamTrack for the *remote* party via replaceTrack — not local speakers.
 * Not Cisco “Opus Number One”; same era vibe: easy-listening I–vi–IV–V, tinny and endless.
 * @returns {MediaStreamTrack | null}
 */
function startHoldMusic() {
  stopHoldMusic();
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return null;
    void ctx.resume?.();

    const master = ctx.createGain();
    master.gain.value = 0.22;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.7;
    const dest = ctx.createMediaStreamDestination();
    master.connect(filter);
    filter.connect(dest);
    // Zero-gain tap keeps some engines processing without audible local playback.
    const silent = ctx.createGain();
    silent.gain.value = 0;
    filter.connect(silent);
    silent.connect(ctx.destination);

    // Chord beds (Hz): Cmaj7 · Am7 · Fmaj7 · G7 — classic easy-listening hold loop
    const chords = [
      [261.63, 329.63, 392.0, 493.88], // C E G B
      [220.0, 261.63, 329.63, 415.3], // A C E G#
      [174.61, 220.0, 261.63, 349.23], // F A C F
      [196.0, 246.94, 293.66, 349.23], // G B D F
    ];
    // Melody over the loop (relative to chord bars)
    const melody = [
      523.25, 587.33, 659.25, 587.33, 523.25, 392.0, 440.0, 493.88, 523.25, 493.88, 440.0, 392.0, 349.23, 392.0, 440.0,
      523.25,
    ];

    const barSec = 2.4;
    const beatSec = barSec / 4;
    let bar = 0;
    let melodyIdx = 0;
    const oscillators = new Set();

    const playPartial = (freq, type, when, dur, peak, nodeDest) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(peak, when + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g);
      g.connect(nodeDest);
      o.start(when);
      o.stop(when + dur + 0.02);
      oscillators.add(o);
      o.onended = () => oscillators.delete(o);
    };

    const scheduleBar = (barIndex, startAt) => {
      const chord = chords[barIndex % chords.length];
      // Soft pad
      for (const f of chord) {
        playPartial(f, "triangle", startAt, barSec * 0.95, 0.028, master);
        playPartial(f * 2, "sine", startAt, barSec * 0.95, 0.012, master);
      }
      // Cheesy 90s electric-piano melody (4 notes per bar)
      for (let b = 0; b < 4; b++) {
        const f = melody[melodyIdx % melody.length];
        melodyIdx += 1;
        const t = startAt + b * beatSec;
        playPartial(f, "sine", t, beatSec * 0.85, 0.055, master);
        playPartial(f, "triangle", t, beatSec * 0.85, 0.025, master);
      }
      // Light “hold desk” tick on beat 1
      playPartial(880, "square", startAt, 0.04, 0.012, master);
    };

    const t0 = ctx.currentTime + 0.05;
    scheduleBar(bar++, t0);
    scheduleBar(bar++, t0 + barSec);

    let nextAt = t0 + barSec * 2;
    const timer = setInterval(() => {
      try {
        const now = ctx.currentTime;
        while (nextAt < now + barSec * 2.5) {
          scheduleBar(bar++, nextAt);
          nextAt += barSec;
        }
      } catch {
        stopHoldMusic();
      }
    }, 500);

    const track = dest.stream.getAudioTracks()[0] || null;
    if (track) track.enabled = true;

    state.holdMusic = {
      timer,
      track,
      stop() {
        clearInterval(timer);
        try {
          master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
        } catch {}
        for (const o of [...oscillators]) {
          try {
            o.stop();
          } catch {}
        }
        oscillators.clear();
        try {
          track?.stop?.();
        } catch {}
      },
    };
    return track;
  } catch {
    return null;
  }
}

function clearSilenceWatch() {
  if (state.silenceTimer) clearTimeout(state.silenceTimer);
  if (state.stillReplyTimer) clearTimeout(state.stillReplyTimer);
  if (state.silencePoll) clearInterval(state.silencePoll);
  state.silenceTimer = null;
  state.stillReplyTimer = null;
  state.silencePoll = null;
  state.silenceAnalyser = null;
  state.stillPrompt = false;
}

function speakStillThere() {
  speakUnavailablePrompt("Are you still there?");
}

/** Policy-block / system prompt on the line (caller just tapped Call → gesture OK). */
function speakUnavailablePrompt(phrase) {
  const text = String(phrase || "").trim();
  if (!text) return;
  try {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.pitch = 1;
      window.speechSynthesis.speak(u);
      return;
    }
  } catch {}
  playTone(660, 0.2, 0.07, "triangle");
  setTimeout(() => playTone(520, 0.25, 0.06, "triangle"), 280);
  setTimeout(() => playTone(660, 0.2, 0.07, "triangle"), 560);
}

function noteCallActivity() {
  if (state.onHold) return;
  const active =
    (state.call && state.call.status === "active") ||
    (state.group && state.group.status === "active");
  if (!active) return;
  if (state.stillPrompt) {
    state.stillPrompt = false;
    if (state.stillReplyTimer) clearTimeout(state.stillReplyTimer);
    state.stillReplyTimer = null;
    paintCallLayer();
  }
  armSilenceIdle();
}

function armSilenceIdle() {
  if (state.silenceTimer) clearTimeout(state.silenceTimer);
  state.silenceTimer = setTimeout(() => {
    state.silenceTimer = null;
    const active =
      (state.call && state.call.status === "active" && !state.onHold) ||
      (state.group && state.group.status === "active" && !state.onHold);
    if (!active) return;
    state.stillPrompt = true;
    speakStillThere();
    paintCallLayer();
    state.stillReplyTimer = setTimeout(() => {
      state.stillReplyTimer = null;
      setFlash("Hung up — no reply to “Are you still there?”", "warn");
      hangup();
      render();
    }, 20_000);
  }, 30_000);
}

function rmsFromAnalyser(analyser) {
  if (!analyser) return 0;
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

function startSilenceWatch() {
  clearSilenceWatch();
  const active =
    (state.call && state.call.status === "active") ||
    (state.group && state.group.status === "active");
  if (!active || state.onHold) return;
  try {
    const ctx = ensureAudioCtx();
    if (ctx && state.localStream) {
      const src = ctx.createMediaStreamSource(state.localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      state.silenceAnalyser = { local: analyser, remote: null };
      const remoteEl = remoteAudio();
      if (remoteEl?.srcObject) {
        try {
          const rSrc = ctx.createMediaStreamSource(remoteEl.srcObject);
          const rAn = ctx.createAnalyser();
          rAn.fftSize = 512;
          rSrc.connect(rAn);
          state.silenceAnalyser.remote = rAn;
        } catch {}
      }
    }
  } catch {}
  armSilenceIdle();
  state.silencePoll = setInterval(() => {
    if (state.onHold) return;
    const local = rmsFromAnalyser(state.silenceAnalyser?.local);
    const remote = rmsFromAnalyser(state.silenceAnalyser?.remote);
    if (local > 0.028 || remote > 0.028) noteCallActivity();
  }, 400);
}

async function applyHoldAudio() {
  if (state.onHold) {
    // Holder: silence remote earpiece + stop sending mic; peer gets hold music instead.
    setOutboundMicEnabled(false);
    const audio = remoteAudio();
    if (audio) audio.muted = true;
    for (const el of groupAudioRoot()?.querySelectorAll("audio") || []) el.muted = true;
    const musicTrack = startHoldMusic();
    if (musicTrack) await replaceOutboundAudio(musicTrack);
    clearSilenceWatch();
  } else {
    // Resume with the PC clone (not master) so hangup never ends the page-lifetime stream.
    const mic =
      (state.pcMicTracks || []).find((t) => t.readyState === "live") ||
      state.localStream?.getAudioTracks()?.[0] ||
      null;
    if (mic) {
      mic.enabled = !state.muted;
      await replaceOutboundAudio(mic);
    }
    armMicForCall();
    stopHoldMusic();
    const audio = remoteAudio();
    if (audio) audio.muted = false;
    for (const el of groupAudioRoot()?.querySelectorAll("audio") || []) el.muted = false;
    if (
      (state.call && state.call.status === "active") ||
      (state.group && state.group.status === "active")
    ) {
      startSilenceWatch();
    }
  }
}

function toggleHold() {
  state.onHold = !state.onHold;
  void applyHoldAudio();
  noteCallActivity();
  paintCallLayer();
}

function isChildMode() {
  return Boolean(state.childMode);
}

/**
 * Kid UX: device Child mode, dedicated child login, or a child-only account.
 * Parents/guardians who own or manage a child line stay in parent chrome so they
 * can switch to that line and edit photo / greeting without the kid’s login.
 * Server `user.is_child_only` is authoritative when present (/api/me).
 */
function isKidExperience() {
  if (isChildMode()) return true;
  if (state.user?.is_child_only === true) return true;
  if (state.user?.is_child_only === false) {
    // Explicit parent/guardian from server — still allow child-mode device lock above.
    return false;
  }
  const uid = state.user?.id;
  if (!uid) return false;
  const lines = (state.households || []).flatMap((h) => h.lines || []);
  if (lines.some((l) => l.child_user_id === uid || l.child_user?.id === uid)) return true;
  const ownsChild = lines.some((l) => l.owner_user_id === uid && l.mode === "child");
  if (!ownsChild) return false;
  const ownsParent = lines.some(
    (l) => l.owner_user_id === uid && (l.mode || "parent") !== "child"
  );
  return !ownsParent;
}

/** Family invites are parent-only (never kid line accounts). */
function canInviteFamily() {
  return Boolean(state.user) && !isKidExperience();
}

function shellModeClass() {
  return isKidExperience() ? "child-chrome" : "parent-chrome";
}

function syncPhoneRoleChrome() {
  const role = state.user ? (isKidExperience() ? "child" : "parent") : "";
  if (role) document.body.dataset.phoneRole = role;
  else delete document.body.dataset.phoneRole;
}

/** Home dial pad: lock document scroll so the pad is one viewport (PTR still works). */
function syncPhoneHomeLock() {
  const lock =
    state.screen === "home" &&
    state.user &&
    (!state.nav || state.nav === "phone") &&
    !state.waitSheet &&
    !state.pinModal;
  document.documentElement.classList.toggle("phone-home", lock);
  if (lock && (window.scrollY || document.documentElement.scrollTop)) {
    window.scrollTo(0, 0);
  }
}

function childLineLabel() {
  const line = activeLine();
  return line?.child_label || line?.name || "Kid line";
}

/** Display name for the child who-line (login name, else line label). */
function childWhoName() {
  // Device Child mode keeps the parent session — never show the parent’s name.
  if (isChildMode()) {
    const uid = state.user?.id;
    const linked =
      uid &&
      (state.households || [])
        .flatMap((h) => h.lines || [])
        .some((l) => l.child_user_id === uid || l.child_user?.id === uid);
    if (!linked) return childLineLabel();
  }
  const person = state.user?.display_name?.trim();
  if (person) return person;
  return childLineLabel();
}

/** Escape text for safe insertion into HTML text nodes. */
function escapeWho(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Home topbar brand — PhoneHome wordmark + short who-line.
 * Kid account/device: line / kid name only (never “Parent · …”).
 * Parent account: always “Parent · {household}” — not the active softphone line.
 * (Active line is the top-right pill; do not duplicate it under the logo.)
 */
function homeBrandHtml() {
  const hh = state.households[0];
  const family = hh?.name || "Family";
  const who = isKidExperience()
    ? childWhoName()
    : `Parent · ${family}`;
  return `
    <div class="home-brand">
      <div class="mark wordmark home-wordmark">Phone<span>Home</span></div>
      <div class="who">${escapeWho(who)}</div>
    </div>`;
}

/** Dock / section pages — always show PhoneHome, with the page name as subtitle. */
function pageBrandHtml(sectionWho) {
  return `
    <div class="home-brand">
      <div class="mark wordmark home-wordmark">Phone<span>Home</span></div>
      <div class="who">${sectionWho}</div>
    </div>`;
}

/** Topbar Profile entry — active line avatar (photo or initials); Parent household controls stay in the dock. */
function parentLineBadgeBtnHtml() {
  const line = activeLine();
  const label = line?.child_label || line?.name || lineName(line?.id) || "Line";
  const avatar = avatarHtml(label, line?.id);
  // PIN-locked Child mode: top avatar unlocks Parent.
  if (isChildMode()) {
    return `<button type="button" class="icon-btn parent-entry parent-entry-avatar" id="exit-child" title="Parent unlock" aria-label="Unlock Parent">${avatar}</button>`;
  }
  // Kid line account (or unlocked): open their profile (photo / greeting) — no parent PIN.
  return `<button type="button" class="icon-btn parent-entry parent-entry-avatar" id="open-profile" title="Profile settings" aria-label="Open profile settings">${avatar}</button>`;
}

function bindParentLineBadge() {
  document.getElementById("open-profile")?.addEventListener("click", () => openProfilePanel());
  document.getElementById("exit-child")?.addEventListener("click", () => exitChildMode());
}

function activeLine() {
  const hh = state.households[0];
  return (hh?.lines || []).find((l) => l.id === state.activeLineId) || (hh?.lines || [])[0];
}

/** Child lines this parent can manage (HT801 / Analog Phone targets). */
function manageKidLines(hh) {
  return (hh?.lines || []).filter((l) => l.mode === "child" && l.can_manage);
}

/** Strong-confirm delete for a specific kid line (type name or DELETE). */
async function confirmAndDeleteChildLine(hh, lineId) {
  const line = (hh?.lines || []).find((l) => l.id === lineId);
  if (!line || !hh) return false;
  const label = line.child_label || line.name || "this kid";
  if (
    !confirm(
      `Delete ${label}’s line permanently?\n\nThis erases their login, adapter, greetings, call history for this line, and removes them from other families’ contacts. Other kids stay.`
    )
  ) {
    return false;
  }
  const typed = prompt(`Type DELETE or “${label}” to confirm:`);
  if (typed == null) return false;
  try {
    await api(`/api/households/${hh.id}/lines/${lineId}/delete`, {
      method: "POST",
      body: JSON.stringify({ confirm: typed }),
    });
    if (state.activeLineId === lineId) {
      const next = (hh.lines || []).find((l) => l.id !== lineId);
      state.activeLineId = next?.id || "";
      if (next?.id) localStorage.setItem("kl_line", next.id);
      else localStorage.removeItem("kl_line");
    }
    if (state.editLineId === lineId) state.editLineId = "";
    setFlash(`${label} deleted`, "ok");
    await refresh();
    return true;
  } catch (e) {
    setFlash(e.message || "Could not delete kid line", "error");
    render();
    return false;
  }
}

async function confirmAndDeleteParentAccount() {
  if (
    !confirm(
      "Delete your parent account permanently?\n\nIf you’re the only parent here, the whole household (kids, contacts, voicemails) is wiped. Type DELETE on the next step."
    )
  ) {
    return false;
  }
  const typed = prompt("Type DELETE to erase your account:");
  if (typed == null) return false;
  try {
    await api("/api/account/delete", {
      method: "POST",
      body: JSON.stringify({ confirm: typed }),
    });
    hardReleaseMicStream();
    state.sessionId = "";
    state.user = null;
    state.households = [];
    state.childMode = false;
    localStorage.removeItem("kl_session");
    localStorage.removeItem("kl_line");
    localStorage.removeItem("kl_child_mode");
    localStorage.removeItem("kl_child_line");
    state.screen = "welcome";
    setFlash("Account deleted", "ok");
    render();
    return true;
  } catch (e) {
    setFlash(e.message || "Could not delete account", "error");
    render();
    return false;
  }
}

/**
 * Line the Analog Phone form configures (Save / Set up / Download).
 * Prefers explicit picker → active child → child that already has an ATA → first kid.
 */
function resolveAtaTargetLine(hh) {
  const kids = manageKidLines(hh);
  if (state.ataTargetLineId) {
    const picked = kids.find((l) => l.id === state.ataTargetLineId);
    if (picked) return picked;
  }
  const active = activeLine();
  if (active && kids.some((l) => l.id === active.id)) return active;
  const withAta = kids.find((l) => l.ata);
  return withAta || kids[0] || active || null;
}

/** Short kid name for Home chips (strip trailing “phone”). */
function kidLineShortName(line) {
  return friendlyPersonName(line?.child_label || line?.name || "Kid");
}

/** Home line-pill face only: first token before space or `+` (e.g. “Gemma + Jude” → “Gemma”). */
function homeLinePillName(line) {
  const raw = friendlyPersonName(line?.child_label || line?.name || "Line");
  return raw.split(/[\s+]/).find(Boolean) || raw || "Line";
}

/**
 * Select the live softphone line — shared by Parent → Active line and Home top-right line pill.
 * Sets activeLineId, persists kl_line, claims signaling WS, clears Profile editLineId.
 * Dial pad, Talk today chrome, Analog Phone status, and topbar control all follow this.
 * @returns {boolean} true if the active line changed
 */
function selectActiveLine(lineId) {
  if (!lineId || lineId === state.activeLineId) return false;
  if (state.call || state.group) {
    setFlash("End the call before switching lines", "warn");
    return false;
  }
  state.editLineId = "";
  state.activeLineId = lineId;
  localStorage.setItem("kl_line", lineId);
  reconnectWs();
  return true;
}

/**
 * Home top-right control.
 * Parent: combined pill [name ▾ | avatar] — name/chevron → Active line picker, avatar → Profile
 * (same lines + selectActiveLine path as Parent → Active line). Kids keep a simple avatar.
 */
function homeTopRightControlHtml(hh) {
  if (isKidExperience()) return parentLineBadgeBtnHtml();
  const lines = hh?.lines || [];
  if (!lines.length) return parentLineBadgeBtnHtml();
  const active = lines.find((l) => l.id === state.activeLineId) || lines[0];
  const label = active?.child_label || active?.name || lineName(active?.id) || "Line";
  const name = homeLinePillName(active);
  const full = (active?.child_label || active?.name || kidLineShortName(active)).replace(/"/g, "&quot;");
  const avatar = avatarHtml(label, active?.id);
  return `
    <div class="home-line-pill" role="group" aria-label="Active line and profile">
      <div class="home-line-pill-select-wrap">
        <div class="home-line-pill-face" aria-hidden="true">
          <span class="home-line-pill-name">${name.replace(/</g, "&lt;")}</span>
          <span class="home-line-picker-chevron">▾</span>
        </div>
        <select id="home-active-line" class="home-line-picker-select" aria-label="Active line" title="Active line: ${full}">
          ${lines
            .map(
              (l) =>
                `<option value="${l.id}" ${l.id === state.activeLineId ? "selected" : ""}>${(
                  l.child_label ||
                  l.name ||
                  "Line"
                ).replace(/</g, "&lt;")}${l.mode === "child" ? " · child" : ""}</option>`
            )
            .join("")}
        </select>
      </div>
      <button type="button" class="home-line-pill-avatar" id="open-profile" title="Profile settings" aria-label="Open profile settings">${avatar}</button>
    </div>`;
}

function bindHomeActiveLinePicker() {
  const sel = document.getElementById("home-active-line");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const next = sel.value;
    if (!selectActiveLine(next)) {
      sel.value = state.activeLineId;
      render(); // flash from call-in-progress / no-op revert
      return;
    }
    render();
  });
}

function lineAtaReady(line) {
  return Boolean(line?.ata?.sip_extension && line.ata.has_sip_password);
}

function ataIntroDismissed() {
  try {
    return localStorage.getItem(ATA_INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

function dismissAtaIntro() {
  try {
    localStorage.setItem(ATA_INTRO_KEY, "1");
  } catch {
    /* private mode */
  }
}

/**
 * @returns {"full"|"compact"|"none"}
 * full — no adapter saved + first visit / not dismissed
 * compact — no adapter saved but parent dismissed the explainer
 * none — adapter already configured (shop link lives in Advanced / Help)
 */
function analogIntroMode(line) {
  if (line?.ata) return "none";
  return ataIntroDismissed() ? "compact" : "full";
}

function ataShopSearchLinksHtml(extraClass = "") {
  const cls = ["ata-shop-links", extraClass].filter(Boolean).join(" ");
  return `<div class="${cls}" role="group" aria-label="Search for Grandstream HT801">
    <a class="ghost ata-shop-btn" href="${ATA_SHOP_AMAZON}" target="_blank" rel="noopener noreferrer">Amazon</a>
    <a class="ghost ata-shop-btn" href="${ATA_SHOP_EBAY}" target="_blank" rel="noopener noreferrer">eBay</a>
  </div>`;
}

/** Prominent first-visit / empty-state explainer, or compact shop strip after dismiss. */
function analogPhoneIntroHtml(line) {
  const mode = analogIntroMode(line);
  if (mode === "none") return "";
  if (mode === "compact") {
    return `<div class="ata-intro ata-intro-compact" id="ata-intro">
      <p class="tiny ata-intro-compact-text"><strong>Need an adapter?</strong> Search for Grandstream HT801:</p>
      ${ataShopSearchLinksHtml("ata-shop-links-inline")}
    </div>`;
  }
  return `<div class="ata-intro" id="ata-intro" role="region" aria-labelledby="ata-intro-title">
    <h3 class="parent-subhead" id="ata-intro-title">What is Analog Phone?</h3>
    <p class="ata-intro-body">A regular house phone (corded or cordless) plugs into a small <strong>Grandstream HT801</strong> adapter. PhoneHome talks to that box — not a magic USB cable into the phone.</p>
    <p class="tiny">You’ll need one of those adapters (about the size of a deck of cards) on your home Wi‑Fi / Ethernet.</p>
    <p class="tiny ata-intro-shop-label">Find a Grandstream HT801:</p>
    ${ataShopSearchLinksHtml()}
    <div class="btn-row two ata-intro-actions">
      <button type="button" class="primary" id="ata-intro-dismiss">Got it — continue</button>
      <button type="button" class="ghost" id="ata-intro-help">Help article</button>
    </div>
  </div>`;
}

function analogNeedAdapterLinkHtml() {
  return `<p class="tiny ata-need-adapter">Need an adapter?
    <a href="${ATA_SHOP_AMAZON}" target="_blank" rel="noopener noreferrer">Amazon</a>
    ·
    <a href="${ATA_SHOP_EBAY}" target="_blank" rel="noopener noreferrer">eBay</a>
    (search: Grandstream HT801)
  </p>`;
}

const ATA_STATUS_CLIENT_TTL_MS = 18_000;

/**
 * "Working" needs a check that finished and found a registration.
 * The server already refuses to call an inconclusive check online; this keeps
 * the chip honest even if an older server (or a stale cache) says otherwise.
 */
function ataStatusIsWorking(st) {
  return Boolean(st && st.status === "online" && st.registered !== false);
}

/**
 * Parent-only Home chip for HT801 health.
 * When the active softphone is a kid line, prefer that line’s status; otherwise any managed kid.
 * - not-set-up: missing ATA / SIP password
 * - offline: configured but FreePBX PJSIP not registered
 * - unknown: ARI/bridge check failed (cautious — do not pretend OK)
 * - online / pending: hide chip
 * @returns {{ kind: "not-set-up"|"offline"|"unknown", lineId: string } | null}
 */
function kidPhoneHomeStatus(hh) {
  if (isKidExperience()) return null;
  const kids = manageKidLines(hh);
  if (!kids.length) return null;

  const activeKid = kids.find((l) => l.id === state.activeLineId);
  const focus = activeKid ? [activeKid] : kids;

  const needs = focus.find((l) => !lineAtaReady(l));
  if (needs) return { kind: "not-set-up", lineId: needs.id };

  let unknownId = null;
  for (const l of focus) {
    const st = state.ataStatusByLine[l.id];
    if (!st) continue; // still fetching — keep chip hidden until we know
    if (st.status === "offline") return { kind: "offline", lineId: l.id };
    if (st.status === "not_configured") return { kind: "not-set-up", lineId: l.id };
    // Anything that isn't a confirmed registration is "can't check", never silence.
    if (!ataStatusIsWorking(st) && !unknownId) unknownId = l.id;
  }
  if (unknownId) return { kind: "unknown", lineId: unknownId };
  return null;
}

function kidPhoneStatusHtml(hh) {
  const st = kidPhoneHomeStatus(hh);
  if (!st) return "";
  if (st.kind === "not-set-up") {
    return `<button type="button" class="kid-phone-status needs-setup" id="kid-phone-status" aria-label="Set up Analog Phone — open Parent Analog Phone">
    <span class="dot" aria-hidden="true"></span>
    <span>Set up Analog Phone</span>
  </button>`;
  }
  if (st.kind === "offline") {
    return `<button type="button" class="kid-phone-status offline" id="kid-phone-status" aria-label="Analog Phone offline — open Parent Analog Phone">
    <span class="dot" aria-hidden="true"></span>
    <span>Analog Phone offline</span>
  </button>`;
  }
  return `<button type="button" class="kid-phone-status unknown" id="kid-phone-status" aria-label="Can't check Analog Phone — open Parent Analog Phone">
    <span class="dot" aria-hidden="true"></span>
    <span>Can't check Analog Phone</span>
  </button>`;
}

function bindKidPhoneStatus(hh) {
  document.getElementById("kid-phone-status")?.addEventListener("click", () => {
    const st = kidPhoneHomeStatus(hh);
    void openParentPanel({ scrollTo: "parent-ata", lineId: st?.lineId });
  });
}

function patchKidPhoneStatusChip(hh) {
  // Analog Phone status lives above “Speed dial” (not in .home-pad-lead).
  const band = document.getElementById("kid-phone-status-mount");
  if (!band) return;
  const html = kidPhoneStatusHtml(hh);
  const existing = band.querySelector("#kid-phone-status");
  if (!html) {
    existing?.remove();
    return;
  }
  if (existing) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const next = wrap.firstElementChild;
    if (next) {
      existing.replaceWith(next);
      bindKidPhoneStatus(hh);
    }
  } else {
    band.insertAdjacentHTML("beforeend", html);
    bindKidPhoneStatus(hh);
  }
}

/**
 * Analog Phone section status for the selected adapter line (resolveAtaTargetLine).
 * Uses /api/lines/:id/ata-status (FreePBX/ARI via bridge) — same truth as Home chips.
 * @returns {{ kind: "no-line"|"not-set-up"|"checking"|"online"|"offline"|"unknown", short: string, detail: string, sip_extension: string|null }}
 */
function analogPhoneStatusInfo(line) {
  if (!line) {
    return {
      kind: "no-line",
      short: "No kid line",
      detail: "Add or lock a child line first, then link an adapter.",
      sip_extension: null,
    };
  }
  const savedExt = line.ata?.sip_extension ? String(line.ata.sip_extension) : null;
  if (!lineAtaReady(line)) {
    return {
      kind: "not-set-up",
      short: "Not set up",
      detail: "No adapter saved for this line yet.",
      sip_extension: savedExt,
    };
  }
  const st = state.ataStatusByLine[line.id];
  const ext = st?.sip_extension != null ? String(st.sip_extension) : savedExt;
  if (!st) {
    return {
      kind: "checking",
      short: "Checking…",
      detail: "Checking whether the adapter is registered…",
      sip_extension: ext,
    };
  }
  if (ataStatusIsWorking(st)) {
    return {
      kind: "online",
      short: "Working",
      detail: ext ? `Working — ext ${ext}` : "Working — adapter registered",
      sip_extension: ext,
    };
  }
  if (st.status === "not_configured") {
    return {
      kind: "not-set-up",
      short: "Not set up",
      detail: "No adapter saved for this line yet.",
      sip_extension: ext,
    };
  }
  if (st.status === "offline") {
    return {
      kind: "offline",
      short: "Offline",
      detail: ext
        ? `Offline — ext ${ext} saved, not registered`
        : "Offline — saved but not registered",
      sip_extension: ext,
    };
  }
  return {
    kind: "unknown",
    short: "Can't check",
    detail: "Can't check the adapter right now. Calls to it may not ring.",
    sip_extension: ext,
  };
}

function analogPhoneHeaderChipHtml(line) {
  const info = analogPhoneStatusInfo(line);
  const cls =
    info.kind === "online"
      ? "online"
      : info.kind === "offline"
        ? "offline"
        : info.kind === "not-set-up" || info.kind === "no-line"
          ? "needs-setup"
          : info.kind === "checking"
            ? "checking"
            : "unknown";
  return `<span class="parent-sec-status ${cls}" id="ata-header-status">${info.short.replace(/</g, "")}</span>`;
}

function analogPhoneStatusBannerHtml(line) {
  const info = analogPhoneStatusInfo(line);
  const cls =
    info.kind === "online"
      ? "online"
      : info.kind === "offline"
        ? "offline"
        : info.kind === "not-set-up" || info.kind === "no-line"
          ? "needs-setup"
          : info.kind === "checking"
            ? "checking"
            : "unknown";
  const detail = String(info.detail || "").replace(/</g, "");
  return `<div class="ata-status-banner ${cls}" id="ata-status-banner" role="status" aria-live="polite">
    <span class="dot" aria-hidden="true"></span>
    <span class="ata-status-banner-text">${detail}</span>
  </div>`;
}

function patchAnalogPhoneStatus(hh) {
  if (state.nav !== "controls") return;
  const line = resolveAtaTargetLine(hh);
  const banner = document.getElementById("ata-status-banner");
  if (banner) {
    const wrap = document.createElement("div");
    wrap.innerHTML = analogPhoneStatusBannerHtml(line);
    const next = wrap.firstElementChild;
    if (next) banner.replaceWith(next);
  }
  const chip = document.getElementById("ata-header-status");
  if (chip) {
    const wrap = document.createElement("div");
    wrap.innerHTML = analogPhoneHeaderChipHtml(line);
    const next = wrap.firstElementChild;
    if (next) chip.replaceWith(next);
  }
}

/** Snapshot Analog inputs before a remount so typing survives. */
function captureAtaFormDraftFromDom() {
  const d = state.ataFormDraft || (state.ataFormDraft = {});
  const ip = document.getElementById("ata-ip");
  const box = document.getElementById("ata-box-pass");
  const np = document.getElementById("ata-new-pass");
  const np2 = document.getElementById("ata-new-pass2");
  const server = document.getElementById("ata-server");
  const mac = document.getElementById("ata-mac");
  const name = document.getElementById("ata-name");
  if (ip) d.ip = ip.value;
  if (box) d.boxPass = box.value;
  if (np) d.newPass = np.value;
  if (np2) d.newPass2 = np2.value;
  if (server) d.server = server.value;
  if (mac) d.mac = mac.value;
  if (name) d.name = name.value;
  const reconnect = document.querySelector("details.ata-reconnect");
  if (reconnect) d.reconnectOpen = reconnect.open;
  const advanced = document.querySelector("details.ata-advanced");
  if (advanced) d.advancedOpen = advanced.open;
}

function clearAtaPushDrafts() {
  const d = state.ataFormDraft || (state.ataFormDraft = {});
  d.ip = "";
  d.boxPass = "";
  d.newPass = "";
  d.newPass2 = "";
  d.reconnectOpen = false;
}

function ataFormDraftActive() {
  const d = state.ataFormDraft || {};
  return Boolean(
    String(d.ip || "").trim() ||
      d.boxPass ||
      d.newPass ||
      d.newPass2 ||
      d.reconnectOpen ||
      d.advancedOpen
  );
}

function bindAtaFormDraftPersistence() {
  const ids = ["ata-ip", "ata-box-pass", "ata-new-pass", "ata-new-pass2", "ata-server", "ata-mac", "ata-name"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("input", () => captureAtaFormDraftFromDom());
    el.addEventListener("change", () => captureAtaFormDraftFromDom());
  }
  document.querySelector("details.ata-reconnect")?.addEventListener("toggle", () => captureAtaFormDraftFromDom());
  document.querySelector("details.ata-advanced")?.addEventListener("toggle", () => captureAtaFormDraftFromDom());
}

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Refresh ARI-backed ATA status for manage-able kid lines (deduped, ~18s client TTL). */
async function ensureKidPhoneStatuses(hh, { force = false } = {}) {
  if (isKidExperience()) return false;
  const kids = manageKidLines(hh).filter(lineAtaReady);
  if (!kids.length) return false;
  const now = Date.now();
  let changed = false;
  await Promise.all(
    kids.map(async (line) => {
      const prev = state.ataStatusByLine[line.id];
      if (!force && prev && now - prev.fetchedAt < ATA_STATUS_CLIENT_TTL_MS) return;
      if (state.ataStatusFetching[line.id]) return;
      state.ataStatusFetching[line.id] = true;
      try {
        const q = force ? "?refresh=1" : "";
        const data = await api(`/api/lines/${encodeURIComponent(line.id)}/ata-status${q}`);
        const next = {
          status: String(data.status || "unknown"),
          registered: data.registered === true,
          fetchedAt: Date.now(),
          sip_extension: data.sip_extension ?? null,
        };
        const was = state.ataStatusByLine[line.id];
        if (!was || was.status !== next.status) changed = true;
        state.ataStatusByLine[line.id] = next;
      } catch {
        const was = state.ataStatusByLine[line.id];
        if (!was || was.status !== "unknown") changed = true;
        state.ataStatusByLine[line.id] = {
          status: "unknown",
          registered: false,
          fetchedAt: Date.now(),
          sip_extension: line.ata?.sip_extension || null,
        };
      } finally {
        delete state.ataStatusFetching[line.id];
      }
    })
  );
  return changed;
}

/** Line shown in Profile editor — may differ from the live softphone (activeLineId). */
function lineBeingEdited() {
  const hh = state.households[0];
  const id = state.editLineId || state.activeLineId;
  return (hh?.lines || []).find((l) => l.id === id) || activeLine();
}

/**
 * Speed-dial rearrange lock — same audience as Parent PIN gate.
 * Parents on unlocked devices rearrange freely; kid/locked devices stay gated.
 * Child mode is hard-locked until Parent exit; other kid UX uses layout session unlock.
 */
function isSpeedDialLayoutLocked() {
  // Parent account / unlocked device: never PIN-gate layout (even if layout_locked is on).
  if (!needsParentPinGate()) return false;
  if (isChildMode()) return true;
  const hh = state.households[0];
  if (!hh?.has_parent_pin) return false;
  if (!(hh.layout_locked ?? 1)) return false;
  return !state.layoutUnlocked;
}

async function ensureLayoutUnlocked() {
  if (!isSpeedDialLayoutLocked()) return true;
  if (isChildMode()) {
    setFlash("Speed dial layout is locked in Child mode", "warn");
    render();
    return false;
  }
  const pin = await askParentPin("Unlock speed dial layout");
  if (pin == null) return false;
  state.layoutUnlocked = true;
  return true;
}

/** External allowlist rows only — not synthetic household / Home (0) tiles. */
function isRemovableSpeedDialEntry(entryOrId) {
  const id = typeof entryOrId === "string" || typeof entryOrId === "number"
    ? String(entryOrId)
    : String(entryOrId?.id || "");
  if (!id) return false;
  if (id.startsWith("hh-line-") || id.startsWith("hh-home-0-")) return false;
  if (entryOrId && typeof entryOrId === "object") {
    if (entryOrId.household_line || entryOrId.home_parent || entryOrId.locked_slot) return false;
  }
  return true;
}

function enterSpeedDialEditMode() {
  if (state.speedDialEditing || isChildMode()) return;
  state.speedDialEditing = true;
  const grid = document.querySelector(".speed-grid");
  grid?.classList.add("is-editing");
  const actions = document.querySelector(".home-pad-head-actions");
  if (actions && !document.getElementById("speed-dial-done")) {
    document.getElementById("invite")?.setAttribute("hidden", "");
    actions.insertAdjacentHTML(
      "afterbegin",
      `<button type="button" class="speed-dial-done" id="speed-dial-done">Done</button>`
    );
    document.getElementById("speed-dial-done")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      exitSpeedDialEditMode();
    });
  }
}

function exitSpeedDialEditMode() {
  if (!state.speedDialEditing) return;
  state.speedDialEditing = false;
  document.querySelector(".speed-grid")?.classList.remove("is-editing", "is-rearranging");
  document
    .querySelectorAll(".speed-slot.drop-target, .speed-slot.drop-ready, .speed-slot.dragging, .contact-tile.dragging")
    .forEach((el) => {
      el.classList.remove("drop-target", "drop-ready", "dragging");
      el.removeAttribute("data-drop-kind");
    });
  document.getElementById("speed-drag-ghost")?.remove();
  document.getElementById("speed-dial-done")?.remove();
  document.getElementById("invite")?.removeAttribute("hidden");
}

async function removeFromSpeedDial(entryId) {
  const hh = state.households[0];
  if (!hh || !entryId || !isRemovableSpeedDialEntry(entryId)) return;
  if (!(await ensureLayoutUnlocked())) return;
  const entry = (hh.allowlist || []).find((c) => c.id === entryId);
  const name = entry ? contactDisplayName(entry) : "this contact";
  if (!confirm(`Remove ${name} from speed dial?`)) return;
  try {
    await api(`/api/households/${hh.id}/allowlist/${entryId}`, {
      method: "PATCH",
      body: JSON.stringify({ speed_dial: null }),
    });
    setFlash(`Removed ${name} from speed dial`, "ok");
    await refresh();
  } catch (e) {
    setFlash(e.message || "Could not remove from speed dial", "error");
    render();
  }
}

async function moveContactToSpeedDial(entryId, toSlot) {
  const hh = state.households[0];
  if (!hh || !entryId) return;
  // Synthetic household-sibling tiles are not allowlist rows.
  if (String(entryId).startsWith("hh-line-") || String(entryId).startsWith("hh-home-0-")) {
    setFlash(
      String(entryId).startsWith("hh-home-0-")
        ? "Home (0) is locked to the parent line"
        : "House lines keep their own slots — drag external contacts only",
      "warn"
    );
    return;
  }
  const slot = Number(toSlot);
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
    if (slot === 0) setFlash("Home (0) is locked to the parent line", "warn");
    return;
  }
  if (!(await ensureLayoutUnlocked())) return;
  const list = hh.allowlist || [];
  const mover = list.find((c) => c.id === entryId);
  const occupant = list.find((c) => Number(c.speed_dial) === slot && c.id !== entryId);
  try {
    await api(`/api/households/${hh.id}/allowlist/${entryId}`, {
      method: "PATCH",
      body: JSON.stringify({ speed_dial: slot }),
    });
    if (occupant) {
      setFlash(`Swapped ${contactDisplayName(mover || { label: "Contact" })} ↔ ${contactDisplayName(occupant)}`, "ok");
    } else {
      setFlash(`Moved to speed dial ${slot}`, "ok");
    }
    await refresh();
  } catch (e) {
    setFlash(e.message || "Could not move contact", "error");
    render();
  }
}

/**
 * iOS homescreen-like long-press: enter edit (jiggle + X badges), drag to reorder 1–9.
 * Non-drag fallback: Parent → contacts → Edit → Speed dial (1–9).
 */
function bindSpeedDialDrag(root = document) {
  const LONG_MS = 1000;
  const EDIT_DRAG_MS = 220;
  const CANCEL_PX = 10;
  let drag = null;
  let suppressClickUntil = 0;

  const slotAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.(".speed-slot[data-slot]") || null;
  };

  const clearDropHints = () => {
    document.querySelectorAll(".speed-slot.drop-target, .speed-slot.drop-ready, .speed-slot.dragging, .contact-tile.dragging").forEach((el) => {
      el.classList.remove("drop-target", "drop-ready", "dragging");
      el.removeAttribute("data-drop-kind");
    });
    document.querySelector(".speed-grid")?.classList.remove("is-rearranging");
  };

  const cleanupGhost = () => {
    document.getElementById("speed-drag-ghost")?.remove();
    clearDropHints();
  };

  const positionGhost = (ghost, x, y) => {
    if (!ghost) return;
    ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -55%) scale(1.1)`;
  };

  const markDropTarget = (slotEl, fromSlot) => {
    document.querySelectorAll(".speed-slot.drop-target").forEach((s) => {
      s.classList.remove("drop-target");
      s.removeAttribute("data-drop-kind");
    });
    if (!slotEl) return;
    const toSlot = Number(slotEl.getAttribute("data-slot"));
    if (!Number.isInteger(toSlot) || toSlot < 1 || toSlot === fromSlot) return;
    slotEl.classList.add("drop-target");
    const occupied = slotEl.hasAttribute("data-entry");
    slotEl.setAttribute("data-drop-kind", occupied ? "swap" : "move");
  };

  const beginDragVisual = (el, entryId, fromSlot, pointerId, x, y) => {
    drag = { entryId, fromSlot, pointerId, sourceEl: el, armed: true };
    el.classList.add("dragging");
    document.querySelector(".speed-grid")?.classList.add("is-rearranging");
    document.querySelectorAll(".speed-slot[data-slot]").forEach((s) => {
      const slotN = Number(s.getAttribute("data-slot"));
      if (slotN === 0 || slotN === fromSlot) return;
      s.classList.add("drop-ready");
    });
    try {
      el.setPointerCapture?.(pointerId);
    } catch {}

    const ghost = document.createElement("div");
    ghost.id = "speed-drag-ghost";
    ghost.className = "speed-drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    const face = el.querySelector(".speed-face");
    const avatar = el.querySelector(".avatar");
    const cap = el.querySelector(".speed-cap");
    const faceLabel = el.querySelector(".speed-initials")?.getAttribute("data-full-name");
    const label =
      (faceLabel && faceLabel.trim()) ||
      el.querySelector(".speed-name, .contact-meta strong, strong")?.textContent?.replace(/^\d+\s*·\s*/, "") ||
      "Contact";
    const num = el.querySelector(".speed-cap .speed-num")?.textContent?.trim() || "";
    ghost.innerHTML = `
      <div class="speed-drag-ghost-card">
        ${face ? face.outerHTML : avatar ? avatar.outerHTML : ""}
        ${
          cap
            ? `<span class="speed-cap"><strong class="speed-name">${label}</strong>${
                num ? `<span class="speed-num" aria-hidden="true">${num}</span>` : ""
              }</span>`
            : `<strong class="speed-name">${label}</strong>`
        }
      </div>`;
    document.body.appendChild(ghost);
    positionGhost(ghost, x, y);
    markDropTarget(slotAt(x, y), fromSlot);
  };

  const endDrag = async (clientX, clientY, cancelled) => {
    if (!drag) return;
    const { entryId, fromSlot, pointerId, sourceEl, armed } = drag;
    try {
      sourceEl?.releasePointerCapture?.(pointerId);
    } catch {}
    const target = cancelled || !armed ? null : slotAt(clientX, clientY);
    const toSlot = target ? Number(target.getAttribute("data-slot")) : NaN;
    const willMove = !!(
      armed &&
      Number.isInteger(toSlot) &&
      toSlot >= 1 &&
      toSlot <= 9 &&
      toSlot !== fromSlot
    );
    cleanupGhost();
    drag = null;
    if (armed) suppressClickUntil = Date.now() + 450;
    if (!willMove) return;
    await moveContactToSpeedDial(entryId, toSlot);
  };

  // Swallow the synthetic click that follows a long-press / drop (call / Add).
  root.addEventListener(
    "click",
    (e) => {
      if (Date.now() > suppressClickUntil) return;
      if (e.target.closest?.(".speed-slot, .contact-tile")) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  // Tap outside the pad exits edit mode (Done / dock / hang-up also clear it).
  root.addEventListener(
    "click",
    (e) => {
      if (!state.speedDialEditing) return;
      if (e.target.closest?.(".speed-grid, #speed-dial-done, .speed-delete, #pin-modal, .pin-modal")) return;
      exitSpeedDialEditMode();
    },
    true
  );

  root.querySelectorAll(".speed-delete[data-delete-entry]").forEach((badge) => {
    const onDelete = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = badge.getAttribute("data-delete-entry");
      if (!id) return;
      suppressClickUntil = Date.now() + 450;
      void removeFromSpeedDial(id);
    };
    badge.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    badge.addEventListener("click", onDelete);
  });

  root.querySelectorAll(".speed-slot[data-entry], .contact-tile[data-entry]").forEach((el) => {
    const entryId = el.getAttribute("data-entry");
    if (!entryId) return;
    // Locked Home (0) parent slot — not rearrangeable.
    if (String(entryId).startsWith("hh-home-0-") || el.classList.contains("slot-locked")) return;
    const rawSlot = el.getAttribute("data-slot");
    const fromSlot = rawSlot != null && rawSlot !== "" ? Number(rawSlot) : null;
    if (fromSlot === 0) return;

    el.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      if (isChildMode()) return;
      if (e.target.closest?.(".speed-delete")) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      let editArmed = false;
      let cancelledEarly = false;
      const prevTouchAction = el.style.touchAction;
      el.style.touchAction = "none";
      const holdMs = state.speedDialEditing ? EDIT_DRAG_MS : LONG_MS;

      const armTimer = setTimeout(() => {
        if (cancelledEarly) return;
        editArmed = true;
        enterSpeedDialEditMode();
        suppressClickUntil = Date.now() + 450;
        if (navigator.vibrate) navigator.vibrate(28);
        try {
          el.setPointerCapture?.(pointerId);
        } catch {}
        // Already in edit mode: start drag immediately so rearrange feels snappy.
        if (state.speedDialEditing && holdMs === EDIT_DRAG_MS) {
          beginDragVisual(el, entryId, fromSlot, pointerId, startX, startY);
        }
      }, holdMs);

      const teardown = () => {
        clearTimeout(armTimer);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        el.style.touchAction = prevTouchAction;
      };

      const onMove = (ev) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dist = Math.hypot(dx, dy);
        if (!editArmed && dist > CANCEL_PX) {
          cancelledEarly = true;
          clearTimeout(armTimer);
          el.style.touchAction = prevTouchAction;
          return;
        }
        if (!editArmed) return;
        if (!drag && dist > CANCEL_PX) {
          beginDragVisual(el, entryId, fromSlot, pointerId, ev.clientX, ev.clientY);
        }
        if (!drag || drag.pointerId !== pointerId) return;
        ev.preventDefault();
        positionGhost(document.getElementById("speed-drag-ghost"), ev.clientX, ev.clientY);
        markDropTarget(slotAt(ev.clientX, ev.clientY), fromSlot);
      };
      const onUp = (ev) => {
        if (ev.pointerId !== pointerId) return;
        teardown();
        if (drag) {
          void endDrag(ev.clientX, ev.clientY, false);
          return;
        }
        if (editArmed) suppressClickUntil = Date.now() + 450;
      };
      const onCancel = (ev) => {
        if (ev.pointerId !== pointerId) return;
        teardown();
        if (drag) void endDrag(ev.clientX, ev.clientY, true);
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  });
}

function askParentPin(title = "Parent PIN") {
  return new Promise((resolve) => {
    const existing = document.getElementById("pin-modal");
    if (existing) existing.remove();
    const wrap = document.createElement("div");
    wrap.id = "pin-modal";
    wrap.className = "pin-modal";
    wrap.innerHTML = `
      <div class="pin-modal-card" role="dialog" aria-modal="true" aria-label="${title}">
        <h2>${title}</h2>
        <p>Enter the 4–6 digit parent PIN.</p>
        <input id="pin-modal-input" class="mono" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="····" />
        <p class="pin-modal-err" id="pin-modal-err" hidden></p>
        <div class="btn-row two">
          <button type="button" class="ghost" id="pin-modal-cancel">Cancel</button>
          <button type="button" class="primary" id="pin-modal-ok">Unlock</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector("#pin-modal-input");
    const err = wrap.querySelector("#pin-modal-err");
    const close = (val) => {
      wrap.remove();
      resolve(val);
    };
    wrap.querySelector("#pin-modal-cancel").onclick = () => close(null);
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) close(null);
    });
    const submit = async () => {
      const pin = String(input.value || "").trim();
      if (!/^\d{4,6}$/.test(pin)) {
        err.hidden = false;
        err.textContent = "PIN must be 4–6 digits";
        return;
      }
      const hh = state.households[0];
      if (!hh) return close(null);
      try {
        await api(`/api/households/${hh.id}/pin/verify`, {
          method: "POST",
          body: JSON.stringify({ pin }),
        });
        close(pin);
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message || "Incorrect PIN";
      }
    };
    wrap.querySelector("#pin-modal-ok").onclick = submit;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    setTimeout(() => input.focus(), 50);
  });
}

/**
 * When the Parent PIN gate should run.
 * PIN protects kid devices / kid accounts from Parent controls — not normal parent use.
 * - Child mode (Lock this device / kl_child_mode) → gate
 * - Kid experience (child login or child-only account) → gate
 * - Parent account on an unlocked device → no gate (even if a household PIN is set)
 */
function needsParentPinGate() {
  if (isChildMode()) return true;
  if (isKidExperience()) return true;
  return false;
}

/**
 * Ordered parent setup checklist (Night Watch–style status board).
 * Completion is derived from household / line / user API state — not localStorage.
 * Analog is optional and does not block “setup complete.”
 * @param {object} [hh]
 */
function parentSetupSteps(hh = state.households[0]) {
  const user = state.user;
  const lines = hh?.lines || [];
  const childLines = lines.filter((l) => (l.mode || "parent") === "child");
  const hasChild = childLines.length > 0;
  // Parent pad always synthesizes household kids onto earliest dial slots
  // (primary → 1). Do NOT use dialableAllowlist(activeLine): when Gemma’s line
  // is active, she is omitted from her own pad and this step never completes.
  const childOnDial1 = (() => {
    if (!hasChild) return false;
    if (householdHomeParentLine(hh)) return true;
    const parentLine = (hh?.lines || []).find((l) => (l.mode || "parent") !== "child");
    if (!parentLine) return true; // child-only household — pad synthesis still applies
    const saved = state.activeLineId;
    state.activeLineId = parentLine.id;
    try {
      const slot1 = dialableAllowlist(hh).find((a) => Number(a.speed_dial) === 1);
      return Boolean(slot1 && childLines.some((l) => l.id === slot1.target_line_id));
    } finally {
      state.activeLineId = saved;
    }
  })();
  const scheduleDone =
    (hh?.schedule_preset && hh.schedule_preset !== "open") ||
    Boolean(hh?.quiet_start && hh?.quiet_end);
  const hasAta = lines.some((l) => l.ata);
  const soundsDone =
    lines.some((l) => l.has_greeting || l.greeting_confirmed) ||
    (hh?.ringer_style && hh.ringer_style !== "classic") ||
    (hh?.ring_volume != null && Number(hh.ring_volume) !== 70);
  const accountDone = Boolean(user?.username && user?.has_password);

  return [
    {
      id: "account",
      label: "Create / sign in",
      detail: accountDone ? "Signed in with username" : "Username & password for next time",
      done: accountDone,
      scrollTo: "parent-account",
      required: true,
    },
    {
      id: "child",
      label: "Add child line",
      detail: hasChild
        ? childLines.length === 1
          ? childLines[0].child_label || childLines[0].name || "Child line ready"
          : `${childLines.length} child lines`
        : "A kid softphone or handset line",
      done: hasChild,
      scrollTo: "parent-line",
      required: true,
    },
    {
      id: "pin",
      label: "Parent PIN",
      detail: hh?.has_parent_pin ? "PIN is on" : "Locks Parent on kid devices",
      done: Boolean(hh?.has_parent_pin),
      scrollTo: "parent-pin",
      required: true,
    },
    {
      id: "contacts",
      label: "Contacts / allowlist",
      detail: childOnDial1
        ? "Child on speed dial 1"
        : hasChild
          ? "Put the child on speed dial 1"
          : "Invite family · child on dial 1",
      done: childOnDial1,
      scrollTo: "parent-people",
      required: true,
    },
    {
      id: "hours",
      label: "Quiet Time / Bedtime / School",
      detail: scheduleDone
        ? hh.schedule_preset && hh.schedule_preset !== "open"
          ? `Schedule · ${hh.schedule_preset}`
          : "Quiet Time set"
        : "Pick a schedule or Quiet Time",
      done: scheduleDone,
      scrollTo: "parent-hours",
      required: true,
    },
    {
      id: "analog",
      label: "Analog adapter",
      detail: hasAta ? "Adapter linked" : "Optional — set up later",
      done: hasAta,
      scrollTo: "parent-ata",
      required: false,
    },
    {
      id: "sounds",
      label: "Sounds / greeting",
      detail: soundsDone
        ? lines.some((l) => l.has_greeting)
          ? "Custom greeting set"
          : lines.some((l) => l.greeting_confirmed)
            ? "Default greeting confirmed"
            : "Ringer updated"
        : "Confirm default greeting or record your own",
      done: soundsDone,
      scrollTo: "parent-sounds",
      required: true,
    },
  ];
}

function parentSetupSummary(hh = state.households[0]) {
  const steps = parentSetupSteps(hh);
  const required = steps.filter((s) => s.required);
  const requiredDone = required.filter((s) => s.done).length;
  const openRequired = required.filter((s) => !s.done);
  const optional = steps.filter((s) => !s.required);
  return {
    steps,
    required,
    requiredDone,
    requiredTotal: required.length,
    openRequired,
    allRequiredDone: openRequired.length === 0,
    optionalOpen: optional.filter((s) => !s.done),
    pct: required.length ? Math.round((requiredDone / required.length) * 100) : 100,
  };
}

function setupChecklistDismissed() {
  return localStorage.getItem(SETUP_DISMISS_KEY) === "1";
}

function dismissSetupChecklist() {
  localStorage.setItem(SETUP_DISMISS_KEY, "1");
  state.setupForceShow = false;
}

function reopenSetupChecklist() {
  if (isKidExperience() || isChildMode()) {
    state.setupForceShow = false;
    state.screen = "home";
    state.nav = "phone";
    render();
    return;
  }
  localStorage.removeItem(SETUP_DISMISS_KEY);
  state.setupForceShow = true;
  state.screen = "setup";
  render();
}

/** Full setup board after sign-in when required steps remain (or Help re-entry). */
function shouldShowSetupBoard(hh = state.households[0]) {
  if (!state.user || !hh) return false;
  if (isKidExperience() || isChildMode()) return false;
  if (!hh.lines?.length) return false;
  const { allRequiredDone } = parentSetupSummary(hh);
  if (allRequiredDone && !state.setupForceShow) return false;
  if (state.setupForceShow) return true;
  return !setupChecklistDismissed() && !allRequiredDone;
}

/** Compact home banner when parent skipped the board but setup is still incomplete. */
function shouldShowSetupBanner(hh = state.households[0]) {
  if (!state.user || !hh) return false;
  if (isKidExperience() || isChildMode()) return false;
  if (!setupChecklistDismissed()) return false;
  return !parentSetupSummary(hh).allRequiredDone;
}

function setupBannerHtml(hh) {
  if (!shouldShowSetupBanner(hh)) return "";
  const { requiredDone, requiredTotal, openRequired, pct } = parentSetupSummary(hh);
  const next = openRequired[0];
  const nextLabel = next ? next.label : "Finish setup";
  return `<button type="button" class="setup-banner" id="open-setup-banner" aria-label="Finish setup, ${requiredDone} of ${requiredTotal} done. Next: ${nextLabel}">
    <span class="setup-banner-meta">
      <strong>Finish setup</strong>
      <small>${requiredDone}/${requiredTotal} · ${nextLabel}</small>
    </span>
    <span class="setup-banner-track" aria-hidden="true"><i style="width:${pct}%"></i></span>
  </button>`;
}

function bindSetupBanner() {
  document.getElementById("open-setup-banner")?.addEventListener("click", () => {
    reopenSetupChecklist();
  });
}

/**
 * @param {{ scrollTo?: string, lineId?: string }} [opts]
 * scrollTo — Parent section id (e.g. "parent-ata")
 * lineId — switch active softphone line before opening (Analog Phone targets that line)
 */
async function openParentPanel(opts = {}) {
  const hh = state.households[0];
  if (needsParentPinGate() && hh?.has_parent_pin) {
    if (!state.parentUnlocked) {
      const pin = await askParentPin("Unlock Parent");
      if (pin == null) return false;
      state.parentUnlocked = true;
    }
  } else {
    state.parentUnlocked = true;
  }
  if (opts.lineId) {
    state.ataTargetLineId = opts.lineId;
    selectActiveLine(opts.lineId);
  }
  if (opts.scrollTo) state.parentScrollTo = opts.scrollTo;
  state.nav = "controls";
  localStorage.setItem("kl_nav", "controls");
  state.screen = "home";
  render();
  return true;
}

/** Line profile (photo, greeting, ringer). No Parent PIN — kids edit their own line; parents use Profile freely. */
async function openProfilePanel() {
  state.screen = "profile";
  render();
  return true;
}

/** Fingerprint of pending approvals currently known (for one-shot auto-open). */
function pendingApprovalKey(hh) {
  return pendingApprovals(hh)
    .map((d) => d.id)
    .sort()
    .join(",");
}

/** Auto-open Approve callers when a new pending set appears (no static home card). */
function shouldAutoOpenApprovals(hh) {
  if (isKidExperience()) return false;
  if (state.screen !== "home" || (state.nav && state.nav !== "phone")) return false;
  if (state.call || state.group) return false;
  const key = pendingApprovalKey(hh);
  if (!key) {
    sessionStorage.removeItem("kl_pending_prompt");
    return false;
  }
  return sessionStorage.getItem("kl_pending_prompt") !== key;
}

function markApprovalsPrompted(hh) {
  const key = pendingApprovalKey(hh);
  if (key) sessionStorage.setItem("kl_pending_prompt", key);
  else sessionStorage.removeItem("kl_pending_prompt");
}

async function enableChildModeOnDevice() {
  const hh = state.households[0];
  const line = activeLine();
  if (!hh || !line) return;
  if (!hh.has_parent_pin) {
    setFlash("Set a parent PIN first so kids can’t exit Child mode", "warn");
    render();
    return;
  }
  try {
    await api(`/api/households/${hh.id}/lines/${line.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        mode: "child",
        child_label: line.child_label || `${line.name}`,
      }),
    });
    state.childMode = true;
    localStorage.setItem("kl_child_mode", "1");
    localStorage.setItem("kl_child_line", line.id);
    state.parentUnlocked = false;
    state.nav = "phone";
    localStorage.setItem("kl_nav", "phone");
    setFlash("Child mode on — speed dial only until a parent PIN unlocks", "ok");
    await refresh();
  } catch (e) {
    setFlash(e.message || "Could not enable Child mode", "error");
    render();
  }
}

async function exitChildMode() {
  const pin = await askParentPin("Exit Child mode");
  if (pin == null) return;
  const hh = state.households[0];
  const line = activeLine();
  try {
    if (hh && line) {
      await api(`/api/households/${hh.id}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ mode: "parent" }),
      });
    }
  } catch {}
  state.childMode = false;
  localStorage.removeItem("kl_child_mode");
  localStorage.removeItem("kl_child_line");
  state.parentUnlocked = false;
  setFlash("Parent mode restored", "ok");
  await refresh();
}

function dots(n, active) {
  return `<div class="step-dots">${Array.from({ length: n }, (_, i) => `<span class="${i === active ? "on" : ""}"></span>`).join("")}</div>`;
}

/**
 * Human-friendly local when: "Today 3:42 PM", "Yesterday 7:10 PM", or "Aug 12, 3:42 PM".
 * Uses household quiet_tz when available.
 */
function formatCallWhen(iso, tz = activityTimeZone()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  const dayKey = calendarDayKeyLocal(d, tz);
  const todayKey = calendarDayKeyLocal(new Date(), tz);
  if (dayKey === todayKey) return `Today ${time}`;
  if (dayKey === shiftDayKey(todayKey, -1)) return `Yesterday ${time}`;
  const sameYear = dayKey.slice(0, 4) === todayKey.slice(0, 4);
  const date = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: tz,
  });
  return `${date}, ${time}`;
}

function outcomeLabel(outcome) {
  if (outcome === "completed" || outcome === "answered") return "Talked";
  if (outcome === "missed") return "Missed";
  if (outcome === "cancelled") return "Cancelled";
  if (outcome === "offline") return "Away";
  if (outcome === "ringing") return "Ringing";
  // Policy reject (Quiet Time, pause, daily cap, not on allowlist) — not spam filter.
  if (outcome === "blocked") return "Stopped by rules";
  return "Call";
}

/** Wide hang-up control (icon + label) for outbound / in-call / answering machine. */
function hangupButtonHtml(id = "hangup", label = "Hang up") {
  return `<button type="button" class="danger call-hangup" id="${id}">
    <svg class="call-hangup-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-1.28.6-2.4 1.48-3.27 2.54-.23.28-.65.32-.95.1l-2.2-1.66c-.28-.21-.35-.6-.17-.9C2.92 10.38 7.14 7 12 7s9.08 3.38 11.75 7.8c.18.3.11.69-.17.9l-2.2 1.66c-.3.22-.72.18-.95-.1-.87-1.06-2-1.94-3.27-2.54-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
    </svg>
    <span>${label}</span>
  </button>`;
}

function paintCallLayer() {
  const root = callRoot();
  if (!root) return;
  if (state.group) {
    const status = state.group.status || "calling";
    const hostId = state.group.hostLineId || state.group.fromLineId;
    const who = lineName(hostId);
    const members = state.group.members || [];
    const invited = (state.group.invited || []).filter((id) => !members.includes(id));
    const people = [
      ...members.map((id) => ({ id, waiting: false })),
      ...invited.map((id) => ({ id, waiting: true })),
    ];
    const ringing = status === "incoming" || status === "calling";
    const inCall = status === "active" || status === "connecting";
    const title =
      status === "incoming"
        ? "Group call"
        : status === "active"
          ? "Group call"
          : status === "connecting"
            ? "Connecting…"
            : "Calling group…";
    const timer =
      state.callStartedAt && inCall
        ? formatDuration(Date.now() - state.callStartedAt)
        : inCall
          ? "0:00"
          : "";
    root.innerHTML = `
      <div id="call-layer" class="call-stage group ${status}">
        <div class="call-stage-bg" aria-hidden="true"></div>
        <div class="call-card cinematic">
          <div class="call-identity">
          <p class="call-kicker">${title}</p>
          <div class="group-avatars ${ringing ? "pulse" : ""}">
            ${people
              .map(
                (p) => `
              <div class="group-avatar-item ${p.waiting ? "waiting" : ""}">
                ${avatarHtml(lineName(p.id), p.id, "lg")}
                <span>${p.id === state.activeLineId ? "You" : lineName(p.id)}</span>
              </div>`
              )
              .join("")}
          </div>
          <h2 class="call-who">${status === "incoming" ? who : "Group"}</h2>
          <p class="call-media">${status === "incoming" ? "Join this group call?" : `${members.length} on the line`}</p>
          ${timer ? `<p class="call-timer" id="call-timer">${timer}</p>` : ""}
          ${state.stillPrompt ? `<p class="still-banner">Are you still there?</p>` : ""}
          ${state.onHold ? `<p class="hold-banner">On hold</p>` : ""}
          </div>
          <div class="call-actions ${status === "incoming" ? "incoming" : inCall ? "in-call" : "outbound"}">
            ${
              inCall
                ? `<div class="call-secondary">
            ${status === "active" ? `<button class="ghost" id="hold">${state.onHold ? "Resume" : "Hold"}</button>` : ""}
            <button class="ghost" id="mute">${state.muted ? "Unmute" : "Mute"}</button>
            </div>`
                : ""
            }
            ${status === "incoming" ? `<button type="button" class="danger call-hangup" id="hangup">Decline</button>` : ""}
            ${status === "incoming" ? `<button type="button" class="primary call-answer" id="accept">Answer</button>` : ""}
            ${status !== "incoming" ? hangupButtonHtml() : ""}
          </div>
        </div>
      </div>`;
    document.getElementById("hangup")?.addEventListener("click", () => {
      noteCallActivity();
      if (status === "incoming") rejectGroupCall();
      else hangup();
      render();
    });
    document.getElementById("accept")?.addEventListener("click", () => {
      noteCallActivity();
      acceptGroupCall();
    });
    document.getElementById("mute")?.addEventListener("click", toggleMute);
    document.getElementById("hold")?.addEventListener("click", toggleHold);
    return;
  }
  if (!state.call) {
    if (state.vmMonitor?.role === "callee") paintVmMonitor();
    else root.innerHTML = "";
    return;
  }
  const status = state.call.status;
  const title =
    status === "incoming"
      ? "Incoming call"
      : status === "active"
        ? state.onHold
          ? "On hold"
          : "Connected"
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
        <div class="call-identity">
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
        ${state.stillPrompt ? `<p class="still-banner">Are you still there?</p>` : ""}
        ${state.onHold ? `<p class="hold-banner">On hold</p>` : ""}
        </div>
        <div class="call-actions ${status === "incoming" ? "incoming" : status === "active" || status === "connecting" ? "in-call" : "outbound"}">
          ${
            status === "active" || status === "connecting"
              ? `<div class="call-secondary">
          ${status === "active" ? `<button class="ghost" id="hold">${state.onHold ? "Resume" : "Hold"}</button>` : ""}
          <button class="ghost" id="mute">${state.muted ? "Unmute" : "Mute"}</button>
          </div>`
              : ""
          }
          ${status === "incoming" ? `<button type="button" class="danger call-hangup" id="hangup">Decline</button>` : ""}
          ${status === "incoming" ? `<button type="button" class="primary call-answer" id="accept">Answer</button>` : ""}
          ${status !== "incoming" ? hangupButtonHtml() : ""}
        </div>
      </div>
    </div>`;

  document.getElementById("hangup")?.addEventListener("click", () => {
    noteCallActivity();
    hangup();
    render();
  });
  document.getElementById("accept")?.addEventListener("click", () => {
    noteCallActivity();
    acceptCall();
  });
  document.getElementById("mute")?.addEventListener("click", toggleMute);
  document.getElementById("hold")?.addEventListener("click", toggleHold);
}

function renderWelcome() {
  const invite = new URLSearchParams(location.search).get("invite") || "";
  const showHost = new URLSearchParams(location.search).get("host") === "1";
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-hero welcome-hero">
        <div class="splash-mark-wrap compact">
          <span class="splash-ring"></span>
          <div class="splash-mark sm">${logoMarkHtml()}</div>
        </div>
        ${brandWordmarkHtml("brand splash-brand")}
        <p class="auth-promise">The home phone, remixed.</p>
        <p class="auth-sub">Family calls · softphone or analog · no strangers</p>
      </div>
      <div class="sheet auth-sheet welcome-sheet">
        ${
          invite
            ? `<div class="invite-ready">Invite ready<strong>${invite}</strong></div>`
            : ""
        }
        ${flashHtml("inline")}
        <div class="auth-cta-stack">
          <button class="primary btn-block" type="button" id="go-returning">Sign in</button>
          <button class="ghost btn-block" type="button" id="go-join">Join with invite</button>
        </div>
        <nav class="auth-alt" aria-label="More options">
          <button class="linkish auth-link" type="button" id="go-register">Create account</button>
          <button class="linkish auth-link" type="button" id="replay-tutorial">See how it works</button>
        </nav>
        ${
          showHost
            ? `<button class="linkish auth-link" type="button" id="go-host">Host setup (bootstrap code)</button>`
            : `<details class="welcome-advanced"><summary>Advanced</summary>
                <button class="linkish auth-link" type="button" id="go-host">Host setup (bootstrap code)</button>
              </details>`
        }
      </div>
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
  document.getElementById("go-register").onclick = () => {
    state.mode = "join";
    state.screen = "register";
    render();
  };
  document.getElementById("go-returning").onclick = () => {
    state.screen = "returning";
    render();
  };
  document.getElementById("replay-tutorial").onclick = () => {
    state.tutorialFromSettings = false;
    state.tutorialIndex = 0;
    state.screen = "tutorial";
    render();
  };
}

function renderReturning() {
  app.innerHTML = `
    <div class="auth-screen">
      <div class="topbar">
        <button type="button" class="icon-btn" id="back" aria-label="Back">←</button>
        <div class="mark wordmark home-wordmark">Phone<span>Home</span></div>
        <span style="width:40px" aria-hidden="true"></span>
      </div>
      <div class="sheet auth-sheet">
        <div class="auth-head">
          <h2>Welcome back</h2>
          <p class="auth-lede">Sign in with your username and password.</p>
        </div>
        ${flashHtml("inline")}
        <form id="login-form" class="auth-form">
          <div class="auth-field">
            <label for="username">Username</label>
            <input id="username" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="e.g. trevor" />
            <p class="auth-field-hint">Not case-sensitive</p>
          </div>
          <div class="auth-field">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" enterkeyhint="go" placeholder="••••••••" />
          </div>
          <button class="primary btn-block" type="submit" id="login">Sign in</button>
        </form>
        <p class="tiny auth-hint">Forgot password? Ask the host — they can reset it.</p>
        <nav class="auth-alt" aria-label="Other sign-in options">
          <button type="button" class="linkish auth-link" id="go-register">Create an account</button>
          <button type="button" class="linkish auth-link" id="use-code">Use 6-digit code instead</button>
        </nav>
      </div>
      <div class="sheet auth-sheet auth-code-sheet" id="code-sheet" hidden>
        <div class="auth-head">
          <h2>6-digit code</h2>
          <p class="auth-lede">Host bootstrap, or an older one-time login code.</p>
        </div>
        <form id="login-code-form" class="auth-form">
          <div class="auth-field">
            <label for="code">Code</label>
            <input id="code" class="mono" inputmode="numeric" maxlength="6" placeholder="······" autocomplete="one-time-code" enterkeyhint="next" />
          </div>
          <div class="auth-field">
            <label for="name">Your name <span class="auth-optional">(optional)</span></label>
            <input id="name" placeholder="e.g. Trevor" enterkeyhint="go" autocomplete="name" />
          </div>
          <button class="primary btn-block" type="submit" id="login-code">Sign in with code</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById("back").onclick = () => {
    setFlash("");
    state.screen = "welcome";
    render();
  };
  document.getElementById("go-register").onclick = () => {
    setFlash("");
    state.screen = "register";
    render();
  };
  document.getElementById("use-code").onclick = () => {
    const sheet = document.getElementById("code-sheet");
    if (!sheet) return;
    sheet.hidden = !sheet.hidden;
    if (!sheet.hidden) {
      sheet.scrollIntoView({ behavior: "smooth", block: "nearest" });
      document.getElementById("code")?.focus();
    }
  };
  const doPasswordLogin = async () => {
    setFlash("");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: document.getElementById("username").value.trim(),
          password: document.getElementById("password").value,
        }),
      });
      state.sessionId = data.sessionId;
      localStorage.setItem("kl_session", data.sessionId);
      await refresh();
      if (state.pendingGuardianCode) {
        try {
          await api("/api/guardian-invites/redeem", {
            method: "POST",
            body: JSON.stringify({ code: state.pendingGuardianCode }),
          });
          setFlash("You’re now a guardian of that child line", "ok");
          state.pendingGuardianCode = "";
          history.replaceState({}, "", location.pathname);
          await refresh();
        } catch (e) {
          setFlash(e.message || "Could not accept guardian invite", "error");
          render();
        }
      }
    } catch (e) {
      setFlash(e.message || "Could not sign in", "error");
      render();
    }
  };
  document.getElementById("login-form").onsubmit = async (e) => {
    e.preventDefault();
    await doPasswordLogin();
  };
  const doCodeLogin = async () => {
    setFlash("");
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
      setFlash(e.message || "Could not sign in", "error");
      render();
    }
  };
  document.getElementById("login-code-form").onsubmit = async (e) => {
    e.preventDefault();
    await doCodeLogin();
  };
  queueMicrotask(() => document.getElementById("username")?.focus());
}

function renderRegister() {
  const invite = new URLSearchParams(location.search).get("invite") || "";
  app.innerHTML = `
    <div class="auth-screen">
      <div class="topbar">
        <button type="button" class="icon-btn" id="back" aria-label="Back">←</button>
        <div class="mark wordmark home-wordmark">Phone<span>Home</span></div>
        <span style="width:40px" aria-hidden="true"></span>
      </div>
      <div class="sheet auth-sheet">
        <div class="auth-head">
          <h2>Create account</h2>
          <p class="auth-lede">One username and password for every phone. Invite codes come next if you’re joining a family.</p>
        </div>
        ${flashHtml("inline")}
        ${invite ? `<div class="invite-ready compact">Invite ready<strong>${invite}</strong></div>` : ""}
        <form id="register-form" class="auth-form">
          <div class="auth-field">
            <label for="reg-name">Display name</label>
            <input id="reg-name" autocomplete="name" enterkeyhint="next" placeholder="e.g. Maya’s mom" />
          </div>
          <div class="auth-field">
            <label for="reg-user">Username</label>
            <input id="reg-user" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="e.g. mayamom" />
            <p class="auth-field-hint">Letters, numbers, . _ - · not case-sensitive</p>
          </div>
          <div class="auth-field">
            <label for="reg-pass">Password</label>
            <input id="reg-pass" type="password" autocomplete="new-password" enterkeyhint="go" placeholder="8+ characters" />
          </div>
          <button class="primary btn-block" type="submit" id="register">Create account</button>
        </form>
        <nav class="auth-alt" aria-label="Sign in instead">
          <p class="tiny">Already have an account? <button type="button" class="linkish inline" id="go-signin">Sign in</button></p>
        </nav>
      </div>
    </div>
  `;
  document.getElementById("back").onclick = () => {
    setFlash("");
    state.screen = "welcome";
    render();
  };
  document.getElementById("go-signin").onclick = () => {
    setFlash("");
    state.screen = "returning";
    render();
  };
  const doRegister = async () => {
    setFlash("");
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          displayName: document.getElementById("reg-name").value.trim(),
          username: document.getElementById("reg-user").value.trim(),
          password: document.getElementById("reg-pass").value,
        }),
      });
      state.sessionId = data.sessionId;
      localStorage.setItem("kl_session", data.sessionId);
      state.mode = invite ? "join" : state.mode || "join";
      state.screen = invite ? "join" : "home";
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not create account", "error");
      render();
    }
  };
  document.getElementById("register-form").onsubmit = async (e) => {
    e.preventDefault();
    await doRegister();
  };
  queueMicrotask(() => document.getElementById("reg-name")?.focus());
}

function renderSetPassword() {
  const needsUser = !state.user?.username;
  app.innerHTML = `
    <div class="auth-screen">
      <div class="topbar">
        <button type="button" class="icon-btn" id="back" aria-label="Back">←</button>
        <div class="mark wordmark home-wordmark">Phone<span>Home</span></div>
        <span style="width:40px" aria-hidden="true"></span>
      </div>
      <div class="sheet auth-sheet">
        <div class="auth-head">
          <h2>${state.user?.has_password ? "Change password" : "Create your login"}</h2>
          <p class="auth-lede">${
            needsUser
              ? "Your account still uses a one-time code. Pick a username and password for next time."
              : "Set a password so you can sign in without a 6-digit code."
          }</p>
        </div>
        ${flashHtml("inline")}
        <form id="set-pass-form" class="auth-form">
          ${
            needsUser
              ? `<div class="auth-field">
            <label for="set-user">Username</label>
            <input id="set-user" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="e.g. trevor" />
            <p class="auth-field-hint">Not case-sensitive</p>
          </div>`
              : `<p class="tiny auth-hint">Signed in as <strong>${state.user.username}</strong></p>`
          }
          <div class="auth-field">
            <label for="set-pass">New password</label>
            <input id="set-pass" type="password" autocomplete="new-password" enterkeyhint="go" placeholder="8+ characters" />
          </div>
          <button class="primary btn-block" type="submit" id="save-pass">Save</button>
        </form>
        <p class="tiny auth-hint">Forgot later? Ask the host to reset your password.</p>
      </div>
    </div>
  `;
  document.getElementById("back").onclick = () => {
    setFlash("");
    state.screen = state.user?.has_password ? "settings" : "home";
    render();
  };
  const savePass = async () => {
    setFlash("");
    try {
      const body = { password: document.getElementById("set-pass").value };
      if (needsUser) body.username = document.getElementById("set-user").value.trim();
      const data = await api("/api/auth/set-password", {
        method: "POST",
        body: JSON.stringify(body),
      });
      state.user = data.user;
      setFlash("Login saved — use username and password next time.", "ok");
      state.screen = "home";
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save password", "error");
      render();
    }
  };
  document.getElementById("set-pass-form").onsubmit = async (e) => {
    e.preventDefault();
    await savePass();
  };
}

function phoneSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8z"/></svg>`;
}

/** App logo mark — same asset as favicon / PWA icon (gold handset tile). */
function logoMarkHtml(extraClass = "") {
  const cls = extraClass ? `logo-mark ${extraClass}` : "logo-mark";
  return `<img class="${cls}" src="/icon.svg" alt="" width="128" height="128" decoding="async" />`;
}

/** Brand wordmark — matches home/topbar Phone<span>Home</span> treatment. */
function brandWordmarkHtml(extraClass = "") {
  const cls = ["mark", "wordmark", "home-wordmark", extraClass].filter(Boolean).join(" ");
  return `<div class="${cls}">Phone<span>Home</span></div>`;
}

/** Adult + child silhouettes — Profile topbar + Parent dock. */
function parentSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3.1"/><path d="M3.2 19.2v-2.1C3.2 14.6 5.6 13 9 13s5.8 1.6 5.8 4.1v2.1H3.2z"/><circle cx="17.2" cy="9" r="2.35"/><path d="M13.1 19.2v-1.4c0-1.8 1.6-3 4.1-3s4.1 1.2 4.1 3v1.4h-8.2z"/></svg>`;
}

/** Person + — invite family (Speed dial header, not topbar). */
function inviteSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M2.4 19.5v-1.9c0-2.5 2.8-4.2 6.6-4.2s6.6 1.7 6.6 4.2v1.9H2.4z"/><path d="M18 8h-2V6h2V4h2v2h2v2h-2v2h-2V8z"/></svg>`;
}

function activitySvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v2.2H4V5.5zm0 5.4h16v2.2H4v-2.2zm0 5.4h11v2.2H4v-2.2z"/><circle cx="18.2" cy="16.6" r="2.2"/></svg>`;
}

function voicemailSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7.2" cy="12" r="3.4"/><circle cx="16.8" cy="12" r="3.4"/><path d="M10.6 12h2.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
}

function tutorialScene(id) {
  if (id === "brand") {
    return `
      <div class="scene scene-brand">
        <div class="scene-brand-mark">${logoMarkHtml()}</div>
        ${brandWordmarkHtml("brand scene-brand-wordmark")}
        <p class="scene-caption">Home phone energy · family only</p>
      </div>`;
  }
  if (id === "lines") {
    return `
      <div class="scene scene-lines">
        <div class="scene-line-cards">
          <div class="scene-line parent">
            <div class="scene-avatar">P</div>
            <div>
              <strong>Parent</strong>
              <small>Picture · greeting · Parent tools</small>
            </div>
          </div>
          <div class="scene-line kid">
            <div class="scene-avatar kid">K</div>
            <div>
              <strong>Kid line</strong>
              <small>Pad · analog handset · Messages</small>
            </div>
          </div>
        </div>
        <p class="scene-caption">Name · photo · voicemail greeting</p>
      </div>`;
  }
  if (id === "analog") {
    return `
      <div class="scene scene-analog">
        <div class="scene-handset" aria-hidden="true">
          <span class="scene-handset-ear"></span>
          <span class="scene-handset-body">0</span>
          <span class="scene-handset-mouth"></span>
        </div>
        <div class="scene-controls">
          <div class="scene-chip accent">Always on</div>
          <div class="scene-chip">Dial 0 · Parent</div>
        </div>
        <p class="scene-caption">Kid line · analog handset</p>
      </div>`;
  }
  if (id === "dial") {
    return `
      <div class="scene scene-phone">
        <div class="scene-dial">
          <span class="on">1<div>Maya</div></span>
          <span>2<div>Gram</div></span>
          <span>3<div>Sam</div></span>
        </div>
        <p class="scene-caption">Photos on the pad · glow when online</p>
      </div>`;
  }
  if (id === "sounds") {
    return `
      <div class="scene scene-sounds">
        <div class="scene-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="scene-controls">
          <div class="scene-chip">Dial tone</div>
          <div class="scene-chip accent">DTMF</div>
          <div class="scene-chip">Ringback</div>
        </div>
        <p class="scene-caption">Sounds like the kitchen phone</p>
      </div>`;
  }
  if (id === "messages") {
    return `
      <div class="scene scene-messages">
        <div class="scene-vm">“Hi — leave a message after the beep.”</div>
        <div class="scene-controls" style="margin-top:14px">
          <div class="scene-chip accent">Play</div>
          <div class="scene-chip">Skip</div>
          <div class="scene-chip danger">Delete</div>
        </div>
        <p class="scene-caption">Answering machine, not chat</p>
      </div>`;
  }
  if (id === "install") {
    const platform = installPlatform();
    const canQuick = Boolean(deferredInstallPrompt);
    const chips =
      platform === "ios"
        ? `<div class="scene-chip">Safari</div><div class="scene-chip accent">Share</div><div class="scene-chip">Add to Home Screen</div>`
        : platform === "android"
          ? canQuick
            ? `<div class="scene-chip accent">Install</div><div class="scene-chip">Home screen</div>`
            : `<div class="scene-chip">Chrome</div><div class="scene-chip accent">⋮ Menu</div><div class="scene-chip">Install app</div>`
          : `<div class="scene-chip">iOS Share</div><div class="scene-chip accent">Add to Home</div><div class="scene-chip">Android Install</div>`;
    const caption =
      platform === "ios"
        ? "Safari · Share · Home Screen"
        : platform === "android"
          ? canQuick
            ? "One tap install when Chrome offers it"
            : "Chrome · menu · Install / Add to Home"
          : "Phone tip · works best on mobile";
    return `
      <div class="scene scene-install">
        <div class="scene-home-icon" aria-hidden="true">
          <span class="scene-home-glyph">${logoMarkHtml()}</span>
          <span class="scene-home-label">PhoneHome</span>
        </div>
        <div class="scene-controls">${chips}</div>
        <p class="scene-caption">${caption}</p>
      </div>`;
  }
  return `
    <div class="scene scene-safety">
      <div class="scene-lock"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2zm-8 0V7a3 3 0 0 1 6 0v2H9z"/></svg></div>
      <div class="scene-controls">
        <div class="scene-chip accent">Quiet Time</div>
        <div class="scene-chip danger">PIN</div>
        <div class="scene-chip">Child mode</div>
        <div class="scene-chip">Activity</div>
      </div>
      <p class="scene-caption">Parents hold the keys</p>
    </div>`;
}


function advanceFromSplash() {
  if (state.splashTimer) {
    clearTimeout(state.splashTimer);
    state.splashTimer = null;
  }
  const done = localStorage.getItem(TUTORIAL_KEY) === "1";
  state.screen = done ? "welcome" : "tutorial";
  if (!done) state.tutorialIndex = 0;
  render();
}

/**
 * Cold-start splash: iOS Add to Home Screen steps (or compact tip for parents on other devices).
 * Hidden when already running as an installed / standalone app.
 */
function splashHomescreenHtml() {
  if (isPhoneHomeStandalone()) return "";
  const onIos = installPlatform() === "ios";
  if (onIos) {
    const steps = ["Tap Share", "Add to Home Screen", "Tap Add"];
    return `<div class="splash-homescreen">
      <p class="splash-homescreen-title">Add to Home Screen</p>
      <p class="splash-homescreen-why">Helps mic Allow stick · feels like an app</p>
      <ol class="splash-setup" aria-label="Add to Home Screen">
        ${steps.map((label, i) => `<li><span class="splash-setup-n">${i + 1}</span>${label}</li>`).join("")}
      </ol>
    </div>`;
  }
  return `<p class="splash-homescreen-tip">On iPhone: Share → Add to Home Screen → Add. Helps mic stick · feels like an app.</p>`;
}

function renderSplash() {
  const homescreen = splashHomescreenHtml();
  app.innerHTML = `
    <div class="splash ${homescreen ? "splash-with-setup" : ""}" id="splash-root" role="button" tabindex="0" aria-label="Continue">
      <div class="splash-glow" aria-hidden="true"></div>
      <div class="splash-mark-wrap">
        <span class="splash-ring"></span>
        <span class="splash-ring delay"></span>
        <div class="splash-mark">${logoMarkHtml()}</div>
      </div>
      ${brandWordmarkHtml("brand splash-brand")}
      <p class="lede splash-lede">The home phone, remixed.</p>
      <p class="splash-sub">Softphone or analog. Family only.</p>
      ${homescreen}
      <div class="splash-progress" aria-hidden="true"><i></i></div>
      <p class="splash-hint">Tap to continue</p>
    </div>
  `;
  const go = () => advanceFromSplash();
  document.getElementById("splash-root")?.addEventListener("click", go);
  document.getElementById("splash-root")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go();
    }
  });
  state.splashTimer = setTimeout(go, homescreen ? 4800 : 3200);
}

/**
 * First-run / incomplete parent setup board (Night Watch–style).
 * Tap a step → Parent section; Skip keeps calling available.
 */
function renderSetupChecklist() {
  const hh = state.households[0];
  if (!hh || isKidExperience() || isChildMode()) {
    state.setupForceShow = false;
    state.screen = "home";
    render();
    return;
  }
  const summary = parentSetupSummary(hh);
  const { steps, requiredDone, requiredTotal, pct, allRequiredDone, openRequired } = summary;
  const next = openRequired[0] || steps.find((s) => !s.done) || null;
  const title = allRequiredDone ? "You’re set" : "Finish parent setup";
  const lede = allRequiredDone
    ? "Required steps are done. Analog is optional anytime."
    : `Progress from your family network — ${requiredDone} of ${requiredTotal} done. Tap a step to jump in.`;

  app.innerHTML = `
    <div class="setup-board" id="setup-board">
      <div class="setup-board-hero">
        ${brandWordmarkHtml("brand splash-brand")}
        <h1>${title}</h1>
        <p class="lede">${lede}</p>
        <div class="setup-board-progress" aria-label="${requiredDone} of ${requiredTotal} required steps">
          <div class="setup-board-progress-meta">
            <span>${allRequiredDone ? "All required done" : "Your progress"}</span>
            <strong>${pct}%</strong>
          </div>
          <div class="setup-board-track" aria-hidden="true"><i style="width:${pct}%"></i></div>
        </div>
      </div>
      <ol class="setup-steps setup-board-list" aria-label="Parent setup checklist">
        ${steps
          .map((step, i) => {
            const cls = step.done ? "done" : i === steps.findIndex((s) => !s.done) ? "now" : "";
            const status = step.done ? "Done" : step.required ? "To do" : "Optional";
            const detail = String(step.detail || "").replace(/</g, "&lt;");
            const label = String(step.label || "").replace(/</g, "&lt;");
            if (step.done) {
              return `<li class="${cls}" data-step="${step.id}">
                <div class="setup-step-go" aria-hidden="true">
                  <strong>${label}</strong>
                  <span>${detail}</span>
                  <em class="setup-step-status">${status}</em>
                </div>
              </li>`;
            }
            return `<li class="${cls}">
              <button type="button" class="setup-step-go" data-setup-step="${step.id}" data-scroll="${step.scrollTo}">
                <strong>${label}</strong>
                <span>${detail}</span>
                <em class="setup-step-status">${status}</em>
              </button>
            </li>`;
          })
          .join("")}
      </ol>
      <div class="btn-row ${next && !allRequiredDone ? "two" : ""} setup-board-actions">
        <button type="button" class="ghost" id="setup-skip">${allRequiredDone ? "Go to phone" : "Skip for now"}</button>
        ${
          next && !allRequiredDone
            ? `<button type="button" class="primary" id="setup-next">Continue · ${String(next.label).replace(/</g, "&lt;")}</button>`
            : ""
        }
      </div>
      <p class="tiny setup-board-note">Calling stays available — reopen anytime from Parent → Help → Finish setup.</p>
    </div>
  `;

  const goStep = async (scrollTo) => {
    state.setupForceShow = false;
    dismissSetupChecklist();
    await openParentPanel({ scrollTo });
  };

  document.querySelectorAll("[data-setup-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void goStep(btn.getAttribute("data-scroll") || "parent-line");
    });
  });
  document.getElementById("setup-next")?.addEventListener("click", () => {
    if (next) void goStep(next.scrollTo);
  });
  document.getElementById("setup-skip")?.addEventListener("click", () => {
    dismissSetupChecklist();
    state.screen = "home";
    state.nav = "phone";
    localStorage.setItem("kl_nav", "phone");
    render();
  });
}

function finishTutorial() {
  localStorage.setItem(TUTORIAL_KEY, "1");
  if (state.tutorialFromSettings) {
    state.tutorialFromSettings = false;
    if (state.user) {
      state.nav = "controls";
      state.parentScrollTo = "parent-help";
      state.screen = "home";
    } else state.screen = "welcome";
  } else {
    state.screen = "welcome";
  }
  render();
}

function renderTutorial() {
  const slides = getTutorialSlides();
  if (state.tutorialIndex >= slides.length) state.tutorialIndex = Math.max(0, slides.length - 1);
  const slide = slides[state.tutorialIndex];
  const last = state.tutorialIndex === slides.length - 1;
  const n = slides.length;
  const canQuickInstall = slide.id === "install" && Boolean(deferredInstallPrompt);
  app.innerHTML = `
    <div class="tutorial" id="tutorial-root">
      <div class="tutorial-top">
        <button type="button" class="linkish tutorial-skip-top" id="skip">Skip</button>
        <div class="tutorial-progress" aria-label="Step ${state.tutorialIndex + 1} of ${n}">
          ${Array.from({ length: n }, (_, i) => `<button type="button" class="tp-seg ${i === state.tutorialIndex ? "on" : i < state.tutorialIndex ? "done" : ""}" data-jump="${i}" aria-label="Go to step ${i + 1}"></button>`).join("")}
        </div>
      </div>
      <div class="tutorial-body">
        <div class="tutorial-visual scene-${slide.id}">
          ${tutorialScene(slide.id)}
        </div>
        <p class="tutorial-kicker">${slide.kicker}</p>
        <h2>${slide.title}</h2>
        <p>${slide.body}</p>
      </div>
      <div class="tutorial-footer">
        ${canQuickInstall ? `<button class="primary" id="pwa-install" type="button">Install</button>` : ""}
        <div class="btn-row ${state.tutorialIndex > 0 ? "two" : ""}">
          ${state.tutorialIndex > 0 ? `<button class="ghost" id="prev">Back</button>` : ""}
          <button class="${canQuickInstall ? "ghost" : "primary"}" id="next">${last ? "Let’s go" : "Next"}</button>
        </div>
      </div>
    </div>
  `;

  const goNext = () => {
    if (last) finishTutorial();
    else {
      state.tutorialIndex += 1;
      render();
    }
  };
  const goPrev = () => {
    state.tutorialIndex = Math.max(0, state.tutorialIndex - 1);
    render();
  };

  document.getElementById("pwa-install")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      /* user dismissed or browser blocked */
    }
    render();
  });
  document.getElementById("next").onclick = goNext;
  document.getElementById("prev")?.addEventListener("click", goPrev);
  document.getElementById("skip")?.addEventListener("click", finishTutorial);
  document.querySelectorAll("[data-jump]").forEach((btn) => {
    btn.onclick = () => {
      state.tutorialIndex = Number(btn.getAttribute("data-jump"));
      render();
    };
  });

  const root = document.getElementById("tutorial-root");
  let startX = 0;
  let startY = 0;
  root?.addEventListener(
    "touchstart",
    (e) => {
      startX = e.changedTouches[0].clientX;
      startY = e.changedTouches[0].clientY;
    },
    { passive: true }
  );
  root?.addEventListener(
    "touchend",
    (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) goNext();
      else goPrev();
    },
    { passive: true }
  );
}

function renderHost() {
  const hh = state.households[0];
  const needsAuth = !state.user;
  const needsFamily = state.user && !hh;
  const needsLine = hh && !hh.lines.length;
  const step = needsAuth ? 0 : needsFamily ? 1 : needsLine ? 2 : 3;

  app.innerHTML = `
    <div class="auth-screen">
      ${dots(3, Math.min(step, 2))}
      <div class="auth-head join-head">
        <h1 class="auth-title">Set up your network</h1>
        <p class="auth-lede">${needsAuth ? "Enter the host setup code from the server." : needsFamily ? "Name your household." : "Name this phone’s line."}</p>
      </div>
      <div class="sheet auth-sheet">
        ${flashHtml("inline")}
        ${
          needsAuth
            ? `
          <form id="host-login-form" class="auth-form">
            <div class="auth-field">
              <label for="code">Host setup code</label>
              <input id="code" class="mono" inputmode="numeric" maxlength="6" placeholder="······" autocomplete="one-time-code" enterkeyhint="next" />
            </div>
            <div class="auth-field">
              <label for="name">Your name</label>
              <input id="name" placeholder="e.g. Trevor" enterkeyhint="go" autocomplete="name" />
            </div>
            <button class="primary btn-block" type="submit" id="login">Continue</button>
          </form>
          <nav class="auth-alt"><button class="linkish auth-link" type="button" id="back">Back</button></nav>`
            : needsFamily
              ? `
          <form id="host-hh-form" class="auth-form">
            <div class="auth-field">
              <label for="hh-name">Family name</label>
              <input id="hh-name" placeholder="e.g. Carlston" enterkeyhint="go" />
            </div>
            <button class="primary btn-block" type="submit" id="create-hh">Create household</button>
          </form>`
              : needsLine
                ? `
          <form id="host-line-form" class="auth-form">
            <div class="auth-field">
              <label for="line-name">Line name</label>
              <input id="line-name" placeholder="e.g. Trevor’s phone" value="${state.user.display_name}'s phone" enterkeyhint="go" />
            </div>
            <button class="primary btn-block" type="submit" id="add-line">Add softphone</button>
          </form>`
                : `
          <div class="auth-head">
            <h2>You’re ready</h2>
            <p class="auth-lede">Invite another parent, add each other as contacts, then kids get speed dial. Set Quiet Time and caps anytime in Controls.</p>
          </div>
          <button class="primary btn-block" type="button" id="to-home">Open the phone</button>`
        }
      </div>
    </div>
  `;

  const back = document.getElementById("back");
  if (back)
    back.onclick = () => {
      state.screen = "welcome";
      render();
    };

  const doHostLogin = async () => {
    setFlash("");
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
      setFlash(e.message, "error");
      render();
    }
  };
  document.getElementById("host-login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await doHostLogin();
  });

  document.getElementById("host-hh-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/api/households", {
      method: "POST",
      body: JSON.stringify({ name: document.getElementById("hh-name").value }),
    });
    await refresh();
  });

  document.getElementById("host-line-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
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
    <div class="auth-screen">
      ${dots(3, needsAuth ? 0 : needsRedeem ? 1 : 2)}
      <div class="auth-head join-head">
        <h1 class="auth-title">Join a family</h1>
        <p class="auth-lede">${
          needsAuth
            ? "Create an account (or sign in), then enter the invite code."
            : needsRedeem
              ? "Enter the invite code you were sent."
              : "Name the phone you’ll use."
        }</p>
      </div>
      <div class="sheet auth-sheet">
        ${flashHtml("inline")}
        ${
          needsAuth
            ? `
          <form id="join-register-form" class="auth-form">
            <div class="auth-field">
              <label for="reg-name">Your name</label>
              <input id="reg-name" autocomplete="name" enterkeyhint="next" placeholder="e.g. Maya’s mom" />
            </div>
            <div class="auth-field">
              <label for="reg-user">Username</label>
              <input id="reg-user" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="e.g. mayamom" />
              <p class="auth-field-hint">Not case-sensitive</p>
            </div>
            <div class="auth-field">
              <label for="reg-pass">Password</label>
              <input id="reg-pass" type="password" autocomplete="new-password" enterkeyhint="go" placeholder="8+ characters" />
            </div>
            <button class="primary btn-block" type="submit" id="register">Create account</button>
          </form>
          <nav class="auth-alt" aria-label="Other options">
            <button class="linkish auth-link" type="button" id="have-account">Already have an account? Sign in</button>
            <button class="linkish auth-link" type="button" id="back">Back</button>
          </nav>`
            : needsRedeem
              ? `
          <form id="join-redeem-form" class="auth-form">
            <div class="auth-field">
              <label for="inv-code">Invite code</label>
              <input id="inv-code" class="mono" inputmode="numeric" maxlength="6" value="${invite}" placeholder="······" enterkeyhint="next" />
            </div>
            <div class="auth-field">
              <label for="inv-hh">Your family name</label>
              <input id="inv-hh" placeholder="e.g. Cousins" enterkeyhint="go" />
            </div>
            <button class="primary btn-block" type="submit" id="redeem">Join network</button>
          </form>`
              : needsLine
                ? `
          <form id="join-line-form" class="auth-form">
            <div class="auth-field">
              <label for="line-name">Line name</label>
              <input id="line-name" placeholder="e.g. Kitchen phone" value="${state.user.display_name}'s phone" enterkeyhint="go" />
            </div>
            <button class="primary btn-block" type="submit" id="add-line">Add softphone</button>
          </form>`
                : `
          <div class="auth-head">
            <h2>Joined</h2>
            <p class="auth-lede">Add each other to Contacts, then call.</p>
          </div>
          <button class="primary btn-block" type="button" id="to-home">Go to home</button>`
        }
      </div>
    </div>
  `;

  document.getElementById("back")?.addEventListener("click", () => {
    state.screen = "welcome";
    render();
  });
  document.getElementById("have-account")?.addEventListener("click", () => {
    state.screen = "returning";
    render();
  });

  document.getElementById("join-register-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setFlash("");
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          displayName: document.getElementById("reg-name").value.trim(),
          username: document.getElementById("reg-user").value.trim(),
          password: document.getElementById("reg-pass").value,
        }),
      });
      state.sessionId = data.sessionId;
      localStorage.setItem("kl_session", data.sessionId);
      setFlash("");
      await refresh();
    } catch (err) {
      setFlash(err.message, "error");
      render();
    }
  });

  document.getElementById("join-redeem-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/invites/redeem", {
        method: "POST",
        body: JSON.stringify({
          code: document.getElementById("inv-code").value.trim(),
          householdName: document.getElementById("inv-hh").value.trim(),
        }),
      });
      history.replaceState({}, "", "/");
      setFlash("");
      await refresh();
    } catch (err) {
      setFlash(err.message, "error");
      render();
    }
  });

  const addJoinLine = async () => {
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
  document.getElementById("join-line-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await addJoinLine();
  });

  document.getElementById("to-home")?.addEventListener("click", () => {
    state.screen = "home";
    render();
  });
}

function dockIndex(active) {
  if (active === "activity") return 1;
  if (active === "voicemail") return 2;
  if (active === "controls" || active === "parent-unlock") return 3;
  return 0;
}

function dockHtml(active) {
  const unreadVm = unreadVoicemailCount();
  const parentBtn = isChildMode()
    ? `<button type="button" class="dock-btn" data-nav="parent-unlock"><span>${parentSvg()}</span>Parent</button>`
    : `<button type="button" class="dock-btn ${active === "controls" ? "on" : ""}" data-nav="controls"><span>${parentSvg()}</span>Parent</button>`;
  return `
    <nav class="dock" style="--dock-i:${dockIndex(active)}" aria-label="Main">
      <i class="dock-indicator" aria-hidden="true"></i>
      <button type="button" class="dock-btn ${active === "phone" ? "on" : ""}" data-nav="phone"><span>${phoneSvg()}</span>Phone</button>
      <button type="button" class="dock-btn ${active === "activity" ? "on" : ""}" data-nav="activity"><span>${activitySvg()}</span>Activity</button>
      <button type="button" class="dock-btn ${active === "voicemail" ? "on" : ""}" data-nav="voicemail"><span>${voicemailSvg()}</span>Messages${unreadVm ? `<em class="${unreadVm ? "blink" : ""}">${Math.min(unreadVm, 9)}</em>` : ""}</button>
      ${parentBtn}
    </nav>`;
}

function chromeDockNav() {
  if (state.screen === "profile") return "phone";
  if (state.nav === "activity" || state.nav === "voicemail" || state.nav === "controls") return state.nav;
  return "phone";
}

function chromePageKey() {
  if (state.screen === "profile") return `profile:${state.editLineId || state.activeLineId || ""}`;
  return chromeDockNav();
}

function chromeWhoLabel() {
  if (state.screen === "profile") {
    const line = lineBeingEdited();
    const lineLabel = line?.child_label || line?.name || "This line";
    const person = state.user?.display_name || (isKidExperience() ? "Kid" : "Parent");
    return isKidExperience() ? `Profile · ${lineLabel}` : `Profile · ${person} · ${lineLabel}`;
  }
  if (state.nav === "activity") return "Activity";
  if (state.nav === "voicemail") return "Messages";
  if (state.nav === "controls") return "Parent";
  const hh = state.households[0];
  const family = hh?.name || "Family";
  if (isKidExperience()) {
    const person = childWhoName();
    return family.trim().toLowerCase() === String(person).trim().toLowerCase()
      ? `Child · ${person}`
      : `Child · ${family}`;
  }
  const active = activeLine();
  const asKid = active?.mode === "child" ? kidLineShortName(active) : null;
  return asKid ? `Parent · ${asKid}` : `Parent · ${family}`;
}

function chromeTopbarEndSignature() {
  const hh = state.households[0];
  const lineIds = (hh?.lines || []).map((l) => l.id).join(",");
  const line = activeLine();
  const av = `${lineHasAvatar(line?.id) ? "1" : "0"}:${lineAvatarUpdatedAt(line?.id) || ""}`;
  if (isKidExperience()) return `kid:${isChildMode() ? "pin" : "open"}:${line?.id || ""}:${av}`;
  return `pill:${lineIds}:${state.activeLineId || ""}:${av}`;
}

function patchChromeTopbarEnd() {
  const end = document.getElementById("app-topbar-end");
  if (!end) return;
  const sig = chromeTopbarEndSignature();
  if (end.dataset.sig === sig) {
    const nameEl = end.querySelector(".home-line-pill-name");
    if (nameEl) nameEl.textContent = homeLinePillName(activeLine());
    const sel = document.getElementById("home-active-line");
    if (sel && sel.value !== state.activeLineId) sel.value = state.activeLineId;
    return;
  }
  end.innerHTML = homeTopRightControlHtml(state.households[0]);
  end.dataset.sig = sig;
}

function syncPersistentTopbar() {
  const who = document.getElementById("app-topbar-who");
  if (who) {
    const label = chromeWhoLabel();
    if (who.textContent !== label) who.textContent = label;
  }
  patchChromeTopbarEnd();
}

function syncPersistentDock(active = chromeDockNav()) {
  const shell = document.getElementById("app-shell");
  const dock = shell?.querySelector(".dock");
  if (!dock) return;
  const wantUnlock = isChildMode();
  const hasUnlock = Boolean(dock.querySelector('[data-nav="parent-unlock"]'));
  if (wantUnlock !== hasUnlock) {
    dock.outerHTML = dockHtml(active);
    return;
  }
  dock.querySelectorAll(".dock-btn[data-nav]").forEach((btn) => {
    const nav = btn.getAttribute("data-nav");
    btn.classList.toggle("on", nav === active);
  });
  dock.style.setProperty("--dock-i", String(dockIndex(active)));
  patchDockVmBadge(state.households[0]);
  // Drop legacy "blocked" badge on Activity (policy rejects ≠ unread alerts).
  const actBtn = dock.querySelector('[data-nav="activity"]');
  actBtn?.querySelector("em")?.remove();
}

async function onDockNav(nav) {
  if (nav === "parent-unlock") {
    await exitChildMode();
    return;
  }
  if (nav === "controls") {
    // Kid / locked device: require PIN each time Parent opens. Parents: no re-prompt.
    if (needsParentPinGate()) state.parentUnlocked = false;
    const ok = await openParentPanel();
    if (!ok) return;
    return;
  }
  // Leaving Parent clears any kid-session unlock so the next elevate re-prompts.
  if (needsParentPinGate()) state.parentUnlocked = false;
  state.nav = nav;
  localStorage.setItem("kl_nav", nav);
  state.screen = "home";
  render();
}

function bindAppChrome(shell) {
  if (!shell || shell.dataset.chromeBound === "1") return;
  shell.dataset.chromeBound = "1";
  shell.addEventListener("click", (e) => {
    const dockBtn = e.target.closest(".dock [data-nav]");
    if (dockBtn) {
      void onDockNav(dockBtn.getAttribute("data-nav"));
      return;
    }
    if (e.target.closest("#open-profile")) {
      openProfilePanel();
      return;
    }
    if (e.target.closest("#exit-child")) {
      void exitChildMode();
    }
  });
  shell.addEventListener("change", (e) => {
    const sel = e.target;
    if (!(sel instanceof HTMLSelectElement) || sel.id !== "home-active-line") return;
    const next = sel.value;
    if (!selectActiveLine(next)) {
      sel.value = state.activeLineId;
      render();
      return;
    }
    render();
  });
}

function bindDock() {
  const shell = document.getElementById("app-shell");
  if (shell) {
    bindAppChrome(shell);
    return;
  }
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.onclick = () => void onDockNav(btn.getAttribute("data-nav"));
  });
}

function ensureAppChrome() {
  const phoneFit = state.screen === "home" && (!state.nav || state.nav === "phone");
  const dockNav = chromeDockNav();
  let shell = document.getElementById("app-shell");
  if (!shell || shell.parentElement !== app) {
    app.innerHTML = `
      <div class="app-shell ${phoneFit ? "phone-fit" : ""} ${shellModeClass()}" id="app-shell">
        <div class="topbar" id="app-topbar">
          <div class="home-brand">
            <div class="mark wordmark home-wordmark">Phone<span>Home</span></div>
            <div class="who" id="app-topbar-who"></div>
          </div>
          <div id="app-topbar-end"></div>
        </div>
        <div class="app-page" id="app-page"></div>
        ${dockHtml(dockNav)}
      </div>
    `;
    shell = document.getElementById("app-shell");
    bindAppChrome(shell);
  } else {
    shell.classList.toggle("phone-fit", phoneFit);
    shell.classList.toggle("parent-chrome", !isKidExperience());
    shell.classList.toggle("child-chrome", isKidExperience());
    syncPersistentDock(dockNav);
  }
  syncPersistentTopbar();
  return shell;
}

function setAppPage(html) {
  ensureAppChrome();
  const page = document.getElementById("app-page");
  if (!page) return;
  const key = chromePageKey();
  const changed = page.dataset.pageKey !== key;
  page.dataset.pageKey = key;
  page.innerHTML = html;
  page.classList.remove("app-page-enter");
  if (changed) {
    void page.offsetWidth;
    page.classList.add("app-page-enter");
    window.clearTimeout(setAppPage._enterTimer);
    setAppPage._enterTimer = window.setTimeout(() => {
      page.classList.remove("app-page-enter");
    }, 900);
  }
}

/**
 * Connected talk duration in ms (answered_at → ended_at, or → now if still live).
 * Missed / blocked / cancelled / no answered_at → null.
 */
function callTalkMs(log) {
  if (!log) return null;
  if (log.outcome !== "completed" && log.outcome !== "answered") return null;
  if (!log.answered_at) return null;
  const endMs = log.ended_at
    ? new Date(log.ended_at).getTime()
    : log.outcome === "answered"
      ? Date.now()
      : NaN;
  if (!Number.isFinite(endMs)) return null;
  const ms = endMs - new Date(log.answered_at).getTime();
  if (ms < 1000) return null;
  return ms;
}

/**
 * Talk length for connected calls only (answered_at → ended_at, or → now if still live).
 * Missed / blocked / cancelled / no answered_at → empty (status shown separately).
 */
function callDurationLabel(log) {
  const ms = callTalkMs(log);
  return ms == null ? "" : formatDuration(ms);
}

function isCompletedOutcome(outcome) {
  return outcome === "completed" || outcome === "answered";
}

function matchesActivityFilter(log, filter) {
  if (!filter) return true;
  if (filter === "completed") return isCompletedOutcome(log.outcome);
  return log.outcome === filter;
}

function activityFilterEmptyLabel(filter) {
  if (filter === "completed") return "No completed calls yet.";
  if (filter === "missed") return "No missed calls yet.";
  if (filter === "blocked") return "No calls stopped by Quiet Time, Timeout, or allowlist yet.";
  return "No activity yet. First calls show up here.";
}

/** Call logs involving the active softphone line (kid or parent Active line). */
function activityLogsForLine(logs, lineId) {
  if (!lineId) return [];
  return (logs || []).filter((l) => l.from_line_id === lineId || l.to_line_id === lineId);
}

function activityPeerId(log, lineId) {
  if (!log || !lineId) return "";
  return log.from_line_id === lineId ? log.to_line_id : log.from_line_id;
}

function activityPeerName(peerId, contacts) {
  return contactDisplayName(
    contacts.find((c) => c.target_line_id === peerId) || { target_line_id: peerId, label: "" }
  );
}

function topPeerFromMap(map) {
  let bestId = "";
  let bestVal = 0;
  for (const [id, val] of map) {
    if (!id || val <= bestVal) continue;
    bestId = id;
    bestVal = val;
  }
  return bestId ? { id: bestId, value: bestVal } : null;
}

function formatTalkMinutesLabel(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  return mins === 1 ? "1 min" : `${mins} min`;
}

/**
 * Compact Activity insights for the active line from household call_logs
 * (same rows as the feed; scoped client-side to activeLineId).
 */
function activityInsightItems(hh, lineId) {
  const contacts = hh?.allowlist || [];
  const logs = activityLogsForLine(hh?.call_logs, lineId);
  if (!logs.length) return [];

  const talkByPeer = new Map();
  const dialByPeer = new Map();
  const inboundByPeer = new Map();

  for (const log of logs) {
    const peer = activityPeerId(log, lineId);
    if (!peer) continue;

    const talkMs = callTalkMs(log);
    if (talkMs != null) talkByPeer.set(peer, (talkByPeer.get(peer) || 0) + talkMs);

    if (log.from_line_id === lineId) {
      dialByPeer.set(peer, (dialByPeer.get(peer) || 0) + 1);
    }
    if (log.to_line_id === lineId) {
      inboundByPeer.set(peer, (inboundByPeer.get(peer) || 0) + 1);
    }
  }

  const items = [];
  const talkTop = topPeerFromMap(talkByPeer);
  if (talkTop) {
    items.push({
      key: "talk",
      label: "Talks most",
      name: activityPeerName(talkTop.id, contacts),
      detail: formatTalkMinutesLabel(talkTop.value),
    });
  }
  const dialTop = topPeerFromMap(dialByPeer);
  if (dialTop) {
    items.push({
      key: "dial",
      label: "Dials most",
      name: activityPeerName(dialTop.id, contacts),
      detail: dialTop.value === 1 ? "1 try" : `${dialTop.value} tries`,
    });
  }
  const inTop = topPeerFromMap(inboundByPeer);
  if (inTop && (!dialTop || inTop.id !== dialTop.id || inTop.value >= 2)) {
    items.push({
      key: "inbound",
      label: "Calls you most",
      name: activityPeerName(inTop.id, contacts),
      detail: inTop.value === 1 ? "1 call" : `${inTop.value} calls`,
    });
  }
  return items.slice(0, 3);
}

function activityInsightsHtml(hh, lineId) {
  const items = activityInsightItems(hh, lineId);
  if (!items.length) {
    return `<div class="activity-insights empty" role="status">
      <p>Call a bit and we’ll show who you talk to most.</p>
    </div>`;
  }
  return `<div class="activity-insights" role="group" aria-label="Call highlights">
    ${items
      .map(
        (it) => `<div class="activity-insight">
      <span class="activity-insight-label">${it.label}</span>
      <strong class="activity-insight-name">${it.name}</strong>
      <span class="activity-insight-detail">${it.detail}</span>
    </div>`
      )
      .join("")}
  </div>`;
}

function usageBarHtml(hh) {
  const cap = hh?.daily_cap_minutes;
  const used = hh?.usage_today_minutes || 0;
  if (cap == null) {
    return `<div class="usage-bar open"><div class="usage-meta"><span>Talk today</span><strong>${used} min</strong></div></div>`;
  }
  const pct = Math.min(100, Math.round((used / Math.max(cap, 1)) * 100));
  const hot = pct >= 90;
  return `<div class="usage-bar ${hot ? "hot" : ""}">
    <div class="usage-meta"><span>Talk today</span><strong>${used} / ${cap} min</strong></div>
    <div class="usage-track"><i style="width:${pct}%"></i></div>
  </div>`;
}

function statusLine(hh, onlineCount) {
  if (hh.kill_switch) return { text: "Timeout is on", live: false, danger: true };
  if (hh.dnd) return { text: "Quiet Time on — VIP still ring", live: false, danger: true };
  if (isQuietHoursActiveClient(hh)) {
    const name = quietWindowName(hh);
    const range = `${formatQuietClock(hh.quiet_start)}–${formatQuietClock(hh.quiet_end)}`;
    return { text: `${name} · ${range}`, live: false };
  }
  if (state.ataPreferred) {
    return { text: "Calls ring the analog phone", live: true };
  }
  const cap = hh.daily_cap_minutes;
  const used = hh.usage_today_minutes || 0;
  if (cap != null) return { text: `${used}/${cap} min today · ${onlineCount} online`, live: onlineCount > 0 };
  return {
    text: onlineCount ? `${onlineCount} online` : "Waiting for family",
    live: onlineCount > 0,
  };
}

function approvalStatus(entry) {
  if (entry?.mutual) return { ready: true, label: "Ready to call", badge: "ok" };
  const who = contactDisplayName(entry || { label: "", target_line_id: "" }) || "them";
  if (isChildMode()) return { ready: false, label: `Waiting for ${who}`, badge: "wait" };
  return { ready: false, label: "Needs their OK", badge: "wait" };
}

/** Other households’ lines not yet on our allowlist (and not declined). */
function pendingApprovals(hh) {
  const approved = new Set((hh?.allowlist || []).map((a) => a.target_line_id));
  const declined = new Set(hh?.declined_line_ids || []);
  return (state.directory || []).filter(
    (d) => d.household_id !== hh?.id && !approved.has(d.id) && !declined.has(d.id)
  );
}

function liveCallBannerHtml(hh) {
  if (isKidExperience()) return "";
  const calls = hh?.live_calls || [];
  if (!calls.length) return "";
  return `<div class="live-child-banner">${calls
    .map((c) => {
      const who = c.lineName || "Child";
      const peer = c.peerLabel || "someone";
      const st = c.status === "active" ? "Talking" : "Ringing";
      const dir =
        c.direction === "inbound" ? `${who} is getting a call from ${peer}` : `${who} is on a call with ${peer}`;
      return `<div class="live-child-row"><span class="dot live"></span><strong>${st}</strong> · ${dir}</div>`;
    })
    .join("")}</div>`;
}

function unreadVoicemailCount(hh = state.households[0]) {
  return voicemailsForActiveLine(hh).filter((v) => !v.listened).length;
}

/** Messages left *for* the Active line (recipient mailbox), not ones you left for others. */
function voicemailsForActiveLine(hh = state.households[0]) {
  const lineId = state.activeLineId;
  if (!lineId) return [];
  return (hh?.voicemails || []).filter((v) => {
    if (v.to_line_id) return v.to_line_id === lineId;
    // Pre-to_line_id rows were household-scoped: never show in the caller's inbox.
    return v.from_line_id !== lineId;
  });
}

/** Classic answering-machine “you have messages” banner — tap to play. */
function newVoicemailBannerHtml(hh) {
  if (state.nav === "voicemail") return "";
  const n = unreadVoicemailCount(hh);
  if (!n) return "";
  if (state.vmBannerDismissedCount >= n) return "";
  const label = n === 1 ? "You have 1 new message" : `You have ${n} new messages`;
  return `<button type="button" class="new-vm-banner" id="new-vm-banner" aria-label="${label}. Open Messages.">
    <span class="am-led blink" aria-hidden="true"></span>
    <span class="new-vm-banner-copy"><strong>${label}</strong><small>Tap to play</small></span>
  </button>`;
}

function bindNewVoicemailBanner() {
  document.getElementById("new-vm-banner")?.addEventListener("click", () => {
    openMessages({ autoPlay: true });
  });
}

/** Home * key / banner — Messages, optionally start Play (new first). */
function openMessages({ autoPlay = false } = {}) {
  state.autoPlayVm = !!autoPlay;
  state.nav = "voicemail";
  localStorage.setItem("kl_nav", "voicemail");
  state.screen = "home";
  render();
}

/**
 * Classic # redial: last outbound target we dialed this session, else newest
 * outbound attempt from Activity that is still placeable.
 */
function findRedialTarget() {
  const active = state.activeLineId;
  if (!active) return null;
  const contacts = dialableAllowlist();
  const placeable = (id) => {
    if (!id || id === active) return null;
    const c = contacts.find((x) => x.target_line_id === id);
    return c && approvalStatus(c).ready ? id : null;
  };
  if (state.lastRedialLineId) {
    const ok = placeable(state.lastRedialLineId);
    if (ok) return ok;
  }
  const logs = state.households[0]?.call_logs || [];
  for (const log of logs) {
    if (log.from_line_id !== active || !log.to_line_id) continue;
    if (log.outcome === "blocked") continue;
    const ok = placeable(log.to_line_id);
    if (ok) return ok;
  }
  return null;
}

function redialLast() {
  const target = findRedialTarget();
  if (!target) {
    setFlash("Nothing to redial", "info");
    return;
  }
  void placeCall(target);
}

function patchNewVmBanner(hh) {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  const html = newVoicemailBannerHtml(hh);
  const host = shell.querySelector(".new-vm-banner");
  if (host && html) {
    host.outerHTML = html;
    bindNewVoicemailBanner();
  } else if (host && !html) {
    host.remove();
  } else if (!host && html) {
    const live = shell.querySelector(".live-child-banner");
    const celeb = shell.querySelector(".celebrate-banner");
    const top = shell.querySelector(".topbar");
    const anchor = live || celeb || top;
    if (anchor) {
      anchor.insertAdjacentHTML("afterend", html);
      bindNewVoicemailBanner();
    }
  }
}

function patchDockVmBadge(hh) {
  const btn = document.querySelector('.dock-btn[data-nav="voicemail"]');
  if (!btn) return;
  const n = unreadVoicemailCount(hh);
  let em = btn.querySelector("em");
  if (n) {
    if (!em) {
      em = document.createElement("em");
      btn.appendChild(em);
    }
    em.className = "blink";
    em.textContent = String(Math.min(n, 9));
  } else if (em) {
    em.remove();
  }
}

function renderHome() {
  if (state.nav === "activity" || state.nav === "voicemail" || state.nav === "controls") {
    exitSpeedDialEditMode();
  }
  if (state.nav === "activity") return renderActivity();
  if (state.nav === "voicemail") return renderVoicemail();
  if (state.nav === "controls") return renderControls();
  return renderPhone();
}

function closeWaitingSheet() {
  document.getElementById("wait-sheet")?.remove();
  state.waitSheet = null;
}

/** Explainer when tapping a not-ready dial — no full home remount. */
function showWaitingSheet(contact, lineId) {
  closeWaitingSheet();
  const name = contactDisplayName(contact || { target_line_id: lineId, label: "" });
  const wrap = document.createElement("div");
  wrap.id = "wait-sheet";
  wrap.className = "sheet-modal";
  wrap.innerHTML = `
    <div class="sheet-modal-card" role="dialog" aria-labelledby="wait-sheet-title">
      <h2 id="wait-sheet-title">${isKidExperience() ? `Waiting for ${name}` : `${name} isn’t ready yet`}</h2>
      <p>${
        isKidExperience()
          ? `They still need to approve you on their phone. Ask a parent if you need help.`
          : `<strong>${name}</strong> still needs to approve you on their phone before you can call. Ask them to open Approve callers and add you.`
      }</p>
      <div class="btn-row ${canInviteFamily() ? "two" : ""}">
        <button type="button" class="primary btn-block" id="wait-sheet-ok">Got it</button>
        ${
          canInviteFamily()
            ? `<button type="button" class="ghost btn-block" id="wait-sheet-invite">Invite again</button>`
            : ""
        }
      </div>
    </div>`;
  document.body.appendChild(wrap);
  state.waitSheet = lineId;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeWaitingSheet();
  });
  document.getElementById("wait-sheet-ok")?.addEventListener("click", closeWaitingSheet);
  document.getElementById("wait-sheet-invite")?.addEventListener("click", () => {
    closeWaitingSheet();
    state.screen = "invite";
    render();
  });
}

/** Patch online dots / status chip without remounting the pad. */
function patchHomePresence() {
  if (state.screen !== "home" || (state.nav && state.nav !== "phone")) return false;
  if (state.call || state.group) return false;
  const shell = document.querySelector(".app-shell");
  if (!shell?.querySelector(".speed-grid")) return false;
  const hh = state.households[0];
  if (!hh) return false;
  const contacts = dialableAllowlist(hh).map((a) => ({
    ...a,
    online: state.directory.find((d) => d.id === a.target_line_id)?.online,
  }));
  const onlineCount = contacts.filter((c) => c.online && c.mutual).length;
  const status = statusLine(hh, onlineCount);
  const chip = shell.querySelector(".status-chip");
  if (chip) {
    chip.className = `status-chip ${status.live ? "live" : ""} ${status.danger ? "danger" : ""}`;
    chip.innerHTML = `<span class="dot"></span>${status.text}`;
  }
  shell.querySelectorAll(".speed-slot[data-entry]").forEach((slot) => {
    const entryId = slot.getAttribute("data-entry");
    const c = contacts.find((x) => x.id === entryId);
    if (!c) return;
    const st = approvalStatus(c);
    const face = slot.querySelector(".speed-face");
    const presenceLabel = st.ready ? (c.online ? "Online" : "Away") : st.label;
    if (face) {
      const kind = st.ready ? (c.online ? "on" : "away") : "wait";
      face.className = `speed-face presence-${kind}`;
      face.title = presenceLabel;
    }
    const name = contactDisplayName(c);
    const n = slot.getAttribute("data-slot") || "";
    slot.setAttribute(
      "aria-label",
      st.ready ? `Call ${name}, dial ${n}, ${presenceLabel}` : `${name}, dial ${n}, ${presenceLabel}`
    );
  });
  const liveHost = shell.querySelector(".live-child-banner");
  const liveHtml = liveCallBannerHtml(hh);
  if (liveHost && liveHtml) {
    liveHost.outerHTML = liveHtml;
  } else if (liveHost && !liveHtml) {
    liveHost.remove();
  } else if (!liveHost && liveHtml) {
    const chrome = shell.querySelector(".phone-fit-chrome");
    const anchor =
      chrome?.querySelector("#kid-phone-status-mount") ||
      chrome?.querySelector(".home-chrome-row") ||
      chrome?.querySelector(".usage-bar");
    if (anchor) anchor.insertAdjacentHTML("beforebegin", liveHtml);
    else chrome?.insertAdjacentHTML("afterbegin", liveHtml);
  }
  patchNewVmBanner(hh);
  patchDockVmBadge(hh);
  patchKidPhoneStatusChip(hh);
  return true;
}

function renderPhone() {
  const hh = state.households[0];
  if (shouldAutoOpenApprovals(hh)) {
    markApprovalsPrompted(hh);
    state.screen = "manage-contacts";
    render();
    return;
  }
  const contacts = dialableAllowlist(hh).map((a) => ({
    ...a,
    online: state.directory.find((d) => d.id === a.target_line_id)?.online,
  }));
  const pending = pendingApprovals(hh);
  const readyCount = contacts.filter((c) => c.mutual).length;
  const onlineCount = contacts.filter((c) => c.online && c.mutual).length;
  const status = statusLine(hh, onlineCount);
  const showCreds =
    !isKidExperience() &&
    state.user &&
    (!state.user.username || !state.user.has_password) &&
    localStorage.getItem("kl_creds_dismissed") !== "1";
  const dialSlots = [];
  for (let i = 1; i <= 9; i++) {
    dialSlots.push(contacts.find((c) => Number(c.speed_dial) === i) || null);
  }
  const homeSlot = contacts.find((c) => Number(c.speed_dial) === 0) || null;

  const renderSpeedSlot = (c, n, extraClass = "") => {
    if (!c) {
      if (n === 0) {
        return `<button class="speed-slot empty pad-home slot-locked ${extraClass}" data-slot="0" type="button" disabled aria-label="Parent — unavailable on this line">
            <span class="speed-face">
              <span class="speed-placeholder speed-key-glyph" aria-hidden="true">0</span>
            </span>
            <span class="speed-name">Parent</span>
          </button>`;
      }
      return `<button class="speed-slot empty ${extraClass}" data-slot="${n}" data-add="1" type="button" aria-label="Add contact to dial ${n}">
                <span class="speed-face">
                  <span class="speed-placeholder speed-key-glyph" aria-hidden="true">${n}</span>
                </span>
                <span class="speed-name">Add</span>
              </button>`;
    }
    const st = approvalStatus(c);
    const name = contactDisplayName(c);
    const padLabel = n === 0 && (c.home_parent || c.locked_slot) ? "Parent" : speedPadLabel(name);
    const presence = st.ready ? (c.online ? "on" : "away") : "wait";
    const status = st.ready ? (c.online ? "Online" : "Away") : st.label;
    const aria = (st.ready ? `Call ${name}, dial ${n}, ${status}` : `${name}, dial ${n}, ${status}`).replace(
      /"/g,
      "&quot;"
    );
    const locked = n === 0 || c.locked_slot || c.home_parent;
    const removable = isRemovableSpeedDialEntry(c);
    const hasPhoto = lineHasAvatar(c.target_line_id);
    const faceName = friendlyPersonName(name);
    const faceNameAttr = faceName.replace(/"/g, "&quot;");
    const faceInner = hasPhoto
      ? avatarHtml(name, c.target_line_id, "speed")
      : `<span class="speed-initials-key" style="${avatarStyle(c.target_line_id)}" aria-hidden="true">
            <span class="speed-initials" data-full-name="${faceNameAttr}">${faceName.replace(/</g, "&lt;")}</span>
          </span>`;
    // Photo keys: name + digit under circle. Text faces: name is in the circle — caption is just the digit.
    const caption = hasPhoto
      ? `<span class="speed-cap">
                  <strong class="speed-name">${padLabel}</strong>
                  <span class="speed-num" aria-hidden="true">${n}</span>
                </span>`
      : `<span class="speed-cap">
                  <span class="speed-num" aria-hidden="true">${n}</span>
                </span>`;
    const deleteBadge = removable
      ? `<span class="speed-delete" role="button" tabindex="-1" data-delete-entry="${c.id}" aria-label="Remove ${name.replace(/"/g, "&quot;")} from speed dial">×</span>`
      : "";
    return `<button class="speed-slot ${st.ready ? "" : "not-ready"} ${locked ? "slot-locked pad-home" : ""} ${extraClass}" data-slot="${n}" data-entry="${c.id}" data-${st.ready ? "call" : "wait"}="${c.target_line_id}" type="button" aria-label="${aria}">
                ${deleteBadge}
                <span class="speed-face presence-${presence}" title="${status.replace(/"/g, "&quot;")}">
                  ${faceInner}
                </span>
                ${caption}
              </button>`;
  };

  const waitTip = contacts.length
    ? readyCount > 0
      ? ""
      : `<p class="tiny home-wait-tip">Waiting on their OK</p>`
    : pending.length
      ? ""
      : `<p class="tiny home-wait-tip">${
          isKidExperience() ? "Ask a parent to add family" : "Invite family to get started"
        }</p>`;

  setAppPage(`
      <div class="phone-stack">
        <div class="phone-fit-chrome">
          ${state.celebrate ? `<p class="celebrate-banner">${state.celebrate}</p>` : ""}
          ${liveCallBannerHtml(hh)}
          ${newVoicemailBannerHtml(hh)}
          ${setupBannerHtml(hh)}
          ${
            showCreds
              ? `<p class="creds-banner">Create a username &amp; password so you can sign in next time without a code.
                  <button type="button" class="linkish inline" id="go-set-pass">Set it up</button>
                  <button type="button" class="linkish inline" id="dismiss-creds">Not now</button></p>`
              : ""
          }
          ${
            !isSecureMicContext()
              ? `<p class="flash-banner warn">Calls need HTTPS on iPad. Use the trycloudflare.com link, not http://10.0.5.x</p>`
              : ""
          }
          <div class="home-chrome-ata" id="kid-phone-status-mount" aria-live="polite">
            ${kidPhoneStatusHtml(hh)}
          </div>
          <div class="home-chrome-row">
            ${usageBarHtml(hh)}
            <div class="status-chip ${status.live ? "live" : ""} ${status.danger ? "danger" : ""}">
              <span class="dot"></span>${status.text}
            </div>
          </div>
        </div>

        <div class="home-pad-block">
          <div class="home-pad-head">
            <h1 class="home-title">Speed dial</h1>
            <div class="home-pad-head-actions">
              ${
                state.speedDialEditing
                  ? `<button type="button" class="speed-dial-done" id="speed-dial-done">Done</button>`
                  : canInviteFamily()
                    ? `<button type="button" class="invite-btn" id="invite" title="Invite family" aria-label="Invite family">${inviteSvg()}<span>Invite</span></button>`
                    : ""
              }
            </div>
          </div>

          ${waitTip ? `<div class="home-pad-lead">${waitTip}</div>` : ""}

          <div class="speed-grid ${isSpeedDialLayoutLocked() ? "layout-locked" : ""} ${state.speedDialEditing ? "is-editing" : ""}">
            ${dialSlots.map((c, idx) => renderSpeedSlot(c, idx + 1)).join("")}
            <button class="speed-slot empty pad-action" data-pad="star" type="button" aria-label="Star — Messages">
              <span class="speed-face">
                <span class="speed-placeholder speed-key-glyph" aria-hidden="true">*</span>
              </span>
              <span class="speed-name">Msgs</span>
            </button>
            ${renderSpeedSlot(homeSlot, 0)}
            <button class="speed-slot empty pad-action" data-pad="pound" type="button" aria-label="Pound — Redial">
              <span class="speed-face">
                <span class="speed-placeholder speed-key-glyph" aria-hidden="true">#</span>
              </span>
              <span class="speed-name">Redial</span>
            </button>
          </div>
        </div>
      </div>
  `);

  paintToast();
  bindNewVoicemailBanner();
  bindSetupBanner();
  if (state.celebrate) {
    setTimeout(() => {
      state.celebrate = "";
      document.querySelector(".celebrate-banner")?.remove();
    }, 4200);
  }

  const openApprove = () => {
    state.screen = "manage-contacts";
    render();
  };

  bindKidPhoneStatus(hh);
  void ensureKidPhoneStatuses(hh).then((changed) => {
    if (changed && state.screen === "home") patchKidPhoneStatusChip(hh);
  });
  document.getElementById("go-set-pass")?.addEventListener("click", () => {
    state.screen = "set-password";
    render();
  });
  document.getElementById("dismiss-creds")?.addEventListener("click", () => {
    localStorage.setItem("kl_creds_dismissed", "1");
    document.querySelector(".creds-banner")?.remove();
  });
  document.getElementById("invite")?.addEventListener("click", () => {
    state.screen = "invite";
    render();
  });
  document.getElementById("speed-dial-done")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    exitSpeedDialEditMode();
  });
  document.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => {
      if (state.speedDialEditing) return;
      openApprove();
    };
  });
  document.querySelectorAll("[data-call]").forEach((btn) => {
    btn.onclick = () => {
      if (state.speedDialEditing) return;
      placeCall(btn.getAttribute("data-call"));
    };
  });
  document.querySelectorAll("[data-wait]").forEach((btn) => {
    btn.onclick = () => {
      if (state.speedDialEditing) return;
      const id = btn.getAttribute("data-wait");
      const c = contacts.find((x) => x.target_line_id === id);
      showWaitingSheet(c, id);
    };
  });
  document.querySelector('[data-pad="star"]')?.addEventListener("click", () => {
    if (state.speedDialEditing) return;
    void unlockAudioCtx().then(() => playDtmf("*", 0.09));
    openMessages({ autoPlay: true });
  });
  document.querySelector('[data-pad="pound"]')?.addEventListener("click", () => {
    if (state.speedDialEditing) return;
    void unlockAudioCtx().then(() => playDtmf("#", 0.09));
    redialLast();
  });
  bindSpeedDialDrag(app);
  fitSpeedFaceNames(app);
  requestAnimationFrame(() => fitSpeedFaceNames(app));

  if (!state.presenceTimer) {
    state.presenceTimer = setInterval(async () => {
      if (!state.sessionId || state.call || state.screen !== "home") return;
      if (state.greetingRecording) return;
      try {
        const data = await api("/api/me");
        state.directory = data.directory || [];
        state.households = data.households || [];
        if (shouldAutoOpenApprovals(state.households[0])) {
          render();
          return;
        }
        const ataChanged = await ensureKidPhoneStatuses(state.households[0]);
        if (!patchHomePresence()) render();
        else if (ataChanged) patchKidPhoneStatusChip(state.households[0]);
      } catch {}
    }, 12000);
  }
}

function renderActivity() {
  const hh = state.households[0];
  const contacts = hh?.allowlist || [];
  const lineId = state.activeLineId;
  const logs = activityLogsForLine(hh?.call_logs, lineId);
  const filter = state.activityFilter;
  const completedCount = logs.filter((l) => isCompletedOutcome(l.outcome)).length;
  const missedCount = logs.filter((l) => l.outcome === "missed").length;
  const blockedCount = logs.filter((l) => l.outcome === "blocked").length;
  // Hide empty "Blocked" chip — policy rejects (Quiet Time / pause / allowlist), not spam.
  if (filter === "blocked" && !blockedCount) state.activityFilter = null;
  const activeFilter = state.activityFilter;
  const visible = logs.filter((l) => matchesActivityFilter(l, activeFilter));
  const showStopped = blockedCount > 0;
  const cols = showStopped ? 3 : 2;
  setAppPage(`
      ${newVoicemailBannerHtml(hh)}
      <p class="lede tight">Highlights for this line, then recent calls.</p>
      ${activityInsightsHtml(hh, lineId)}
      <div class="stat-row" style="--stat-cols:${cols}" role="group" aria-label="Filter call history">
        <button type="button" class="stat ${activeFilter === "completed" ? "on" : ""}" data-activity-filter="completed" aria-pressed="${activeFilter === "completed" ? "true" : "false"}"><strong>${completedCount}</strong><span>Completed</span></button>
        <button type="button" class="stat ${activeFilter === "missed" ? "on" : ""}" data-activity-filter="missed" aria-pressed="${activeFilter === "missed" ? "true" : "false"}"><strong>${missedCount}</strong><span>Missed</span></button>
        ${
          showStopped
            ? `<button type="button" class="stat ${activeFilter === "blocked" ? "on" : ""}" data-activity-filter="blocked" aria-pressed="${activeFilter === "blocked" ? "true" : "false"}"><strong>${blockedCount}</strong><span>Stopped</span></button>`
            : ""
        }
      </div>
      <div class="recent-list tall">
        ${
          visible.length
            ? visible
                .map((log, idx) => {
                  const other = activityPeerId(log, lineId);
                  const inbound = log.to_line_id === lineId;
                  const name = activityPeerName(other, contacts);
                  const when = formatCallWhen(log.started_at, activityTimeZone(hh));
                  const status = outcomeLabel(log.outcome);
                  const dur = callDurationLabel(log);
                  const i = Math.min(idx, 12);
                  return `<div class="recent-row" style="--i:${i}">
                    ${avatarHtml(name, other, "sm")}
                    <div class="recent-main">
                      <strong>${inbound ? "Incoming" : "Outgoing"} · ${name}</strong>
                      <small><span class="activity-when">${when}</span> · ${status}</small>
                    </div>
                    ${dur ? `<span class="activity-length" title="Talk time">${dur}</span>` : ""}
                  </div>`;
                })
                .join("")
            : `<div class="empty">${activityFilterEmptyLabel(activeFilter)}</div>`
        }
      </div>
  `);
  bindNewVoicemailBanner();
  document.querySelectorAll("[data-activity-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-activity-filter");
      state.activityFilter = state.activityFilter === next ? null : next;
      render();
    });
  });
}

function blobToBase64(b) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(b);
  });
}

function pickRecorderMime() {
  if (MediaRecorder.isTypeSupported("audio/webm;opus")) return "audio/webm;opus";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "audio/webm";
}

/** Record / clear answering-machine greeting for a line (Profile, Messages, or Parent). */
function bindGreetingEditor(hh, line, ids) {
  if (!hh || !line) return;
  const statusEl = () => document.getElementById(ids.statusId);
  const preview = () => document.getElementById(ids.previewId);
  const recordBtn = () => document.getElementById(ids.recordId);
  const defaultBtn = () => document.getElementById(ids.defaultId);
  let recorder = null;
  let chunks = [];
  let stream = null;
  let timer = null;
  let seconds = 0;
  let stopping = false;

  const setStatus = (t) => {
    if (statusEl()) statusEl().textContent = t;
  };

  const cleanupMic = () => {
    if (timer) clearInterval(timer);
    timer = null;
    releaseRecorderMicRef(stream);
    stream = null;
  };

  const finishStop = () => {
    stopping = false;
    state.greetingRecording = false;
    const btn = recordBtn();
    if (btn) btn.textContent = line.has_greeting ? "Re-record" : "Record greeting";
  };

  const stopRecording = () => {
    if (stopping) return;
    if (!recorder || recorder.state !== "recording") return;
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    setStatus("Saving greeting…");
    try {
      recorder.stop();
    } catch {
      cleanupMic();
      finishStop();
    }
  };

  recordBtn()?.addEventListener("click", async () => {
    const btn = recordBtn();
    if (!btn) return;
    if (recorder && recorder.state === "recording") {
      stopRecording();
      return;
    }
    if (stopping || state.greetingRecording) return;
    try {
      state.greetingRecording = true;
      playTone(1000, 0.12, toneGain(0.06), "sine");
      await new Promise((r) => setTimeout(r, 220));
      stream = await ensureMicStream();
      armMicForCall();
      chunks = [];
      const mime = pickRecorderMime();
      recorder = new MediaRecorder(stream, { mimeType: mime });
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        cleanupMic();
        const rec = recorder;
        recorder = null;
        try {
          const blob = new Blob(chunks, { type: mime });
          chunks = [];
          if (blob.size < 64) throw new Error("Recording too short — hold a second, then Stop");
          const dataUrl = await blobToBase64(blob);
          const data = await api(`/api/households/${hh.id}/lines/${line.id}/greeting`, {
            method: "PUT",
            body: JSON.stringify({ audioBase64: dataUrl, audioMime: mime }),
          });
          line.has_greeting = true;
          line.greeting_confirmed = true;
          line.greeting_updated_at = data.line?.greeting_updated_at || new Date().toISOString();
          // Update in-memory household line too (avoid full remount / record loop).
          const live = (state.households[0]?.lines || []).find((l) => l.id === line.id);
          if (live) {
            live.has_greeting = true;
            live.greeting_confirmed = true;
            live.greeting_updated_at = line.greeting_updated_at;
          }
          const el = preview();
          if (el) {
            el.style.display = "block";
            el.src = `/api/lines/${line.id}/greeting?sid=${encodeURIComponent(state.sessionId)}&t=${Date.now()}`;
          }
          const def = defaultBtn();
          if (def) {
            def.disabled = false;
            def.textContent = "Use default greeting";
          }
          setStatus("Greeting saved.");
          setFlash("Greeting saved", "ok");
          paintToast();
        } catch (e) {
          setStatus(e.message || "Could not save greeting");
          setFlash(e.message || "Could not save greeting", "error");
          paintToast();
        } finally {
          finishStop();
        }
      };
      seconds = 0;
      setStatus("Recording… tap Stop when done");
      btn.textContent = "Stop";
      recorder.start(250);
      timer = setInterval(() => {
        seconds += 1;
        setStatus(`Recording… ${seconds}s — tap Stop`);
        if (seconds >= 30) stopRecording();
      }, 1000);
    } catch (e) {
      cleanupMic();
      finishStop();
      setStatus(e.message || "Mic unavailable");
    }
  });

  defaultBtn()?.addEventListener("click", async () => {
    if (state.greetingRecording) {
      setFlash("Stop recording first", "warn");
      return;
    }
    try {
      if (line.has_greeting) {
        await api(`/api/households/${hh.id}/lines/${line.id}/greeting`, { method: "DELETE" });
        line.has_greeting = false;
        line.greeting_updated_at = null;
      } else {
        await api(`/api/households/${hh.id}/lines/${line.id}/greeting/confirm`, { method: "POST" });
      }
      line.greeting_confirmed = true;
      const live = (state.households[0]?.lines || []).find((l) => l.id === line.id);
      if (live) {
        live.has_greeting = false;
        live.greeting_updated_at = null;
        live.greeting_confirmed = true;
      }
      const el = preview();
      if (el) {
        el.src = "/default-greeting.wav";
        el.style.display = "block";
        try {
          el.load();
        } catch {}
      }
      const def = defaultBtn();
      if (def) {
        def.disabled = false;
        def.textContent = "Default greeting confirmed";
      }
      const btn = recordBtn();
      if (btn) btn.textContent = "Record greeting";
      setStatus("Using default greeting.");
      setFlash("Default greeting confirmed", "ok");
      paintToast();
    } catch (e) {
      setFlash(e.message || "Could not confirm greeting", "error");
      paintToast();
    }
  });
}

/** Mark default greeting accepted for setup checklist (no custom upload required). */
async function confirmLineGreetingPreference(hh, line) {
  if (!hh || !line || line.greeting_confirmed) return false;
  if (line.has_greeting) {
    line.greeting_confirmed = true;
    return false;
  }
  await api(`/api/households/${hh.id}/lines/${line.id}/greeting/confirm`, { method: "POST" });
  line.greeting_confirmed = true;
  const live = (state.households[0]?.lines || []).find((l) => l.id === line.id);
  if (live) live.greeting_confirmed = true;
  return true;
}

/**
 * Play decoded PCM through the (already-unlocked) call AudioContext — survives no-answer autoplay.
 * @param {ArrayBuffer} arrayBuffer
 * @param {{ isCancelled?: () => boolean }} [opts]
 */
async function playDecodedThroughCtx(arrayBuffer, opts = {}) {
  const ctx = await unlockAudioCtx();
  if (!ctx) throw new Error("No audio");
  if (ctx.state === "suspended") throw new Error("Audio locked");
  if (opts.isCancelled?.()) return;
  const copy = arrayBuffer.slice(0);
  const buf = await ctx.decodeAudioData(copy);
  if (opts.isCancelled?.()) return;
  await new Promise((resolve, reject) => {
    let poll = null;
    try {
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = 0.95;
      src.buffer = buf;
      src.connect(g);
      g.connect(ctx.destination);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (poll) clearInterval(poll);
        resolve();
      };
      src.onended = finish;
      src.start();
      // Hang up mid-greeting: stop source so we never trail into an orphan beep.
      if (opts.isCancelled) {
        poll = setInterval(() => {
          if (!opts.isCancelled()) return;
          try {
            src.stop();
          } catch {}
          finish();
        }, 80);
      }
      setTimeout(finish, Math.ceil(buf.duration * 1000) + 400);
    } catch (e) {
      if (poll) clearInterval(poll);
      reject(e);
    }
  });
}

/** Classic landline default OGM when the recipient has no custom recording. */
async function playDefaultGreetingText(opts = {}) {
  await unlockAudioCtx();
  if (opts.isCancelled?.()) return;
  // Real spoken WAV — speechSynthesis is silent after ring-timeout (no gesture), especially iOS.
  try {
    const res = await fetch("/default-greeting.wav", { credentials: "same-origin", cache: "force-cache" });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      if (ab.byteLength > 64) {
        await playDecodedThroughCtx(ab, opts);
        return;
      }
    }
  } catch {
    /* fall through */
  }
  if (opts.isCancelled?.()) return;
  const ctx = await unlockAudioCtx();
  if (ctx && ctx.state === "running") {
    playTone(392, 0.22, toneGain(0.05), "sine");
    await new Promise((r) => setTimeout(r, 260));
    if (opts.isCancelled?.()) return;
    playTone(523, 0.28, toneGain(0.045), "sine");
    await new Promise((r) => setTimeout(r, 400));
    return;
  }
  throw new Error("Audio locked");
}

/** Answering-machine record cue — always after greeting (custom or default). Handset-loud, not ring-volume. */
async function playVmRecordBeep() {
  const ctx = await unlockAudioCtx();
  if (!ctx || ctx.state !== "running") throw new Error("Audio locked");
  // progressGain: ring volume can be 0 for the room ringer; VM beep must still be heard on the caller handset.
  playTone(1000, 0.22, progressGain(0.1), "sine");
  await new Promise((r) => setTimeout(r, 380));
}

/** Max seconds for an incoming answering-machine message (classic short tape). */
const VM_MAX_SECONDS = 45;
/** Soft cap shown in UI; server enforces the hard limit. */
const VM_MAX_STORED = 15;

/**
 * Custom greeting (Web Audio) or default OGM, then the record beep — always, for both paths.
 * Uses AudioContext — HTMLAudioElement.play() is blocked after ring-timeout (no gesture).
 * @param {string} toLineId
 * @param {{ isCancelled?: () => boolean }} [opts]
 */
async function playLineGreetingThenBeep(toLineId, opts = {}) {
  const fromLineId = state.activeLineId;
  const url = `/api/lines/${toLineId}/greeting?fromLineId=${encodeURIComponent(fromLineId || "")}&sid=${encodeURIComponent(state.sessionId)}`;
  await unlockAudioCtx();
  if (opts.isCancelled?.()) return;
  let playedCustom = false;
  try {
    const res = await fetch(url, { credentials: "include" });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      if (ab.byteLength > 64) {
        await playDecodedThroughCtx(ab, opts);
        playedCustom = true;
      }
    }
  } catch {
    /* fall through to default */
  }
  if (opts.isCancelled?.()) return;
  if (!playedCustom) await playDefaultGreetingText(opts);
  if (opts.isCancelled?.()) return;
  // Re-unlock after BufferSource / long custom OGM — playTone alone does not await resume.
  await playVmRecordBeep();
}

function renderVoicemail() {
  const hh = state.households[0];
  const line = activeLine();
  // Oldest first — like a tape / digital chip playing in order.
  // Active-line inbox = messages left for this line only (not outbound deposits).
  const vms = [...voicemailsForActiveLine(hh)].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at))
  );
  const newCount = vms.filter((v) => !v.listened).length;
  const total = vms.length;
  const lineLabel = line?.child_label || line?.name || "this line";
  // Kids may record their own greeting (Profile or here) without a parent PIN.
  const greetingCard = `<div class="sheet control-card am-greet-card">
        <h2>Answering machine greeting</h2>
        <p class="tiny">One short message callers hear before the beep on ${lineLabel}.</p>
        <p class="tiny">${line?.has_greeting ? "Custom greeting is on." : "Using the default: “Please leave a message after the beep.”"}</p>
        <audio id="vm-greet-preview" controls style="display:block;width:100%;margin:8px 0" src="${
          line?.has_greeting
            ? `/api/lines/${line.id}/greeting?sid=${encodeURIComponent(state.sessionId)}`
            : "/default-greeting.wav"
        }"></audio>
        <div class="btn-row two">
          <button type="button" class="primary" id="vm-greet-record">${line?.has_greeting ? "Re-record" : "Record greeting"}</button>
          <button type="button" class="ghost" id="vm-greet-default">${
            line?.has_greeting
              ? "Use default greeting"
              : line?.greeting_confirmed
                ? "Default greeting confirmed"
                : "Use default greeting"
          }</button>
        </div>
        <p class="vm-rec-status tiny" id="vm-greet-status" style="margin-top:8px"></p>
      </div>`;

  const slotsHtml = total
    ? `<ol class="am-slots" id="am-slots">
        ${vms
          .map((v, i) => {
            const n = i + 1;
            const hasAudio = !!v.audio_path;
            const legacy =
              !hasAudio && v.body && v.body !== "(voicemail)"
                ? ` · ${v.body}`
                : !hasAudio
                  ? " · (empty)"
                  : "";
            return `<li class="am-slot ${v.listened ? "" : "new"}" style="--i:${Math.min(i, 12)}" data-vm="${v.id}" data-am-idx="${i}" role="button" tabindex="0">
              <label class="am-slot-check-wrap" title="Select">
                <input type="checkbox" class="am-slot-check" data-vm="${v.id}" aria-label="Select message ${n}" />
              </label>
              <span class="am-slot-num">${n}</span>
              <span class="am-slot-body">
                <strong>${v.from_label || "Caller"}</strong>
                <small>${formatCallWhen(v.created_at)}${legacy}${v.listened ? "" : " · new"}</small>
              </span>
            </li>`;
          })
          .join("")}
      </ol>`
    : "";

  const bulkBar = total
    ? `<div class="am-bulk">
        <label class="am-select-all">
          <input type="checkbox" id="am-select-all" />
          <span>Select all</span>
        </label>
        <button type="button" class="ghost danger am-btn" id="am-delete-selected" disabled>Delete selected</button>
      </div>`
    : "";

  setAppPage(`
      <div class="sheet am-panel">
        <div class="am-head">
          <div class="am-title-row">
            <h2>Messages</h2>
            <span class="am-counter ${newCount ? "has-new" : ""}" aria-live="polite">
              <span class="am-led ${newCount ? "blink" : ""}" aria-hidden="true"></span>
              ${total}${newCount ? ` · ${newCount} new` : ""}
            </span>
          </div>
          <p class="tiny am-sub">Play new messages in order. Delete when you’re done. Max ${VM_MAX_STORED}.</p>
        </div>
        <div class="am-controls">
          <button type="button" class="primary am-btn" id="am-play" ${total ? "" : "disabled"}>Play</button>
          <button type="button" class="ghost am-btn" id="am-skip" disabled>Skip</button>
          <button type="button" class="ghost danger am-btn" id="am-delete" disabled>Delete</button>
        </div>
        <p class="am-status" id="am-status">${total ? (newCount ? "New messages — press Play." : "Press Play to hear messages.") : "No messages."}</p>
        <audio id="am-audio" preload="none" hidden></audio>
        ${bulkBar}
        ${slotsHtml}
      </div>

      ${greetingCard}
  `);
  bindGreetingEditor(hh, line, {
    recordId: "vm-greet-record",
    defaultId: "vm-greet-default",
    statusId: "vm-greet-status",
    previewId: "vm-greet-preview",
  });

  const audioEl = document.getElementById("am-audio");
  const statusEl = () => document.getElementById("am-status");
  const playBtn = document.getElementById("am-play");
  const skipBtn = document.getElementById("am-skip");
  const deleteBtn = document.getElementById("am-delete");
  const selectAllEl = document.getElementById("am-select-all");
  const deleteSelectedBtn = document.getElementById("am-delete-selected");
  let queue = [];
  let cursor = -1;
  let playingId = null;
  let stopping = false;

  const setStatus = (t) => {
    if (statusEl()) statusEl().textContent = t;
  };

  const checkedIds = () =>
    [...document.querySelectorAll(".am-slot-check:checked")].map((el) =>
      el.getAttribute("data-vm")
    ).filter(Boolean);

  const syncBulkUi = () => {
    const ids = checkedIds();
    const all = document.querySelectorAll(".am-slot-check");
    if (deleteSelectedBtn) {
      deleteSelectedBtn.disabled = !ids.length;
      deleteSelectedBtn.textContent = ids.length
        ? `Delete selected (${ids.length})`
        : "Delete selected";
    }
    if (selectAllEl) {
      selectAllEl.checked = all.length > 0 && ids.length === all.length;
      selectAllEl.indeterminate = ids.length > 0 && ids.length < all.length;
    }
  };

  const highlight = (vmId) => {
    document.querySelectorAll(".am-slot").forEach((el) => {
      el.classList.toggle("playing", el.getAttribute("data-vm") === vmId);
      el.classList.toggle("selected", el.getAttribute("data-vm") === vmId);
    });
  };

  const markListened = async (vmId) => {
    const vm = vms.find((x) => x.id === vmId);
    if (!vm || vm.listened) return;
    try {
      await api(`/api/households/${hh.id}/voicemails/${vmId}/listen`, {
        method: "POST",
        body: "{}",
      });
      vm.listened = 1;
      document.querySelector(`.am-slot[data-vm="${vmId}"]`)?.classList.remove("new");
      const led = document.querySelector(".am-led");
      const stillNew = vms.some((x) => !x.listened);
      if (led && !stillNew) led.classList.remove("blink");
      const counter = document.querySelector(".am-counter");
      if (counter && !stillNew) {
        counter.classList.remove("has-new");
        counter.innerHTML = `<span class="am-led" aria-hidden="true"></span>${vms.length}`;
      }
    } catch {
      /* ignore */
    }
  };

  const stopPlayback = () => {
    stopping = true;
    try {
      audioEl.pause();
    } catch {}
    if (audioEl.src?.startsWith("blob:")) {
      URL.revokeObjectURL(audioEl.src);
      audioEl.removeAttribute("src");
      try {
        audioEl.load();
      } catch {}
    }
    playingId = null;
    cursor = -1;
    queue = [];
    highlight(null);
    if (skipBtn) skipBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;
    if (playBtn) {
      playBtn.disabled = !vms.length;
      playBtn.textContent = "Play";
    }
    stopping = false;
  };

  const loadAndPlay = async (vm) => {
    if (!vm?.audio_path) {
      setStatus("No recording on that message.");
      return false;
    }
    const res = await fetch(`/api/households/${hh.id}/voicemails/${vm.id}/audio`, {
      credentials: "include",
      headers: state.sessionId ? { "X-Session-Id": state.sessionId } : {},
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Could not load recording");
    }
    const blob = await res.blob();
    if (audioEl.src?.startsWith("blob:")) URL.revokeObjectURL(audioEl.src);
    audioEl.src = URL.createObjectURL(blob);
    playingId = vm.id;
    highlight(vm.id);
    if (deleteBtn) deleteBtn.disabled = false;
    if (skipBtn) skipBtn.disabled = false;
    if (playBtn) playBtn.textContent = "Stop";
    const idx = vms.findIndex((x) => x.id === vm.id);
    setStatus(`Message ${idx + 1} of ${vms.length} — ${vm.from_label || "Caller"}`);
    try {
      await audioEl.play();
    } catch (e) {
      // Interrupted by Stop/Delete/Skip — not a real failure.
      if (e?.name === "AbortError" || /aborted|interrupted/i.test(String(e?.message || ""))) {
        return false;
      }
      throw e;
    }
    await markListened(vm.id);
    return true;
  };

  const playNextInQueue = async () => {
    cursor += 1;
    if (cursor >= queue.length) {
      stopPlayback();
      setStatus("End of messages.");
      return;
    }
    const vm = queue[cursor];
    try {
      await loadAndPlay(vm);
    } catch (e) {
      if (e?.name === "AbortError" || /aborted|interrupted/i.test(String(e?.message || ""))) {
        return;
      }
      setFlash(e.message || "Could not play", "error");
      await playNextInQueue();
    }
  };

  const buildQueue = (preferNew, startFromId) => {
    let list = preferNew ? vms.filter((v) => !v.listened) : [...vms];
    if (!list.length) list = [...vms];
    if (startFromId) {
      const i = list.findIndex((v) => v.id === startFromId);
      if (i >= 0) list = list.slice(i);
    }
    return list.filter((v) => v.audio_path);
  };

  audioEl?.addEventListener("ended", () => {
    if (stopping) return;
    void playNextInQueue();
  });

  playBtn?.addEventListener("click", async () => {
    if (playingId) {
      stopPlayback();
      setStatus(newCount ? "Stopped." : "Stopped.");
      return;
    }
    if (!vms.length) return;
    const selected = document.querySelector(".am-slot.selected")?.getAttribute("data-vm");
    queue = buildQueue(true, selected || null);
    if (!queue.length) {
      setStatus("No recordings to play.");
      return;
    }
    cursor = -1;
    await playNextInQueue();
  });

  if (state.autoPlayVm) {
    state.autoPlayVm = false;
    if (total && playBtn && !playBtn.disabled) {
      queueMicrotask(() => playBtn.click());
    } else if (!total) {
      setStatus("No messages.");
    }
  }

  skipBtn?.addEventListener("click", async () => {
    if (!playingId) return;
    try {
      audioEl.pause();
    } catch {}
    await playNextInQueue();
  });

  deleteBtn?.addEventListener("click", async () => {
    const vmId =
      playingId || document.querySelector(".am-slot.selected")?.getAttribute("data-vm");
    if (!vmId || !hh) return;
    if (!confirm("Erase this message?")) return;
    // Stop playback first so play()/fetch aren't aborted mid-flight into an error toast.
    stopPlayback();
    try {
      await api(`/api/households/${hh.id}/voicemails/${vmId}`, { method: "DELETE" });
      if (hh.voicemails) hh.voicemails = hh.voicemails.filter((v) => v.id !== vmId);
      setFlash("Message erased", "ok");
      render();
    } catch (e) {
      if (e?.name === "AbortError" || /aborted|interrupted/i.test(String(e?.message || ""))) {
        // Panel remounted or audio interrupted — refresh quietly if delete likely succeeded.
        render();
        return;
      }
      setFlash(e.message || "Could not erase", "error");
    }
  });

  selectAllEl?.addEventListener("change", () => {
    const on = !!selectAllEl.checked;
    document.querySelectorAll(".am-slot-check").forEach((el) => {
      el.checked = on;
    });
    syncBulkUi();
  });

  deleteSelectedBtn?.addEventListener("click", async () => {
    const ids = checkedIds();
    if (!ids.length || !hh) return;
    const n = ids.length;
    if (!confirm(n === 1 ? "Erase this message?" : `Erase ${n} messages?`)) return;
    stopPlayback();
    try {
      const result = await api(`/api/households/${hh.id}/voicemails/delete`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      const gone = new Set(result.deleted || ids);
      if (hh.voicemails) hh.voicemails = hh.voicemails.filter((v) => !gone.has(v.id));
      setFlash(n === 1 ? "Message erased" : `${gone.size} messages erased`, "ok");
      render();
    } catch (e) {
      if (e?.name === "AbortError" || /aborted|interrupted/i.test(String(e?.message || ""))) {
        render();
        return;
      }
      setFlash(e.message || "Could not erase", "error");
    }
  });

  document.querySelectorAll(".am-slot-check").forEach((el) => {
    el.addEventListener("click", (ev) => ev.stopPropagation());
    el.addEventListener("change", () => syncBulkUi());
  });
  document.querySelectorAll(".am-slot-check-wrap").forEach((el) => {
    el.addEventListener("click", (ev) => ev.stopPropagation());
  });

  document.querySelectorAll(".am-slot").forEach((el) => {
    const select = () => {
      document.querySelectorAll(".am-slot").forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      if (deleteBtn && !playingId) deleteBtn.disabled = false;
      const vmId = el.getAttribute("data-vm");
      const idx = Number(el.getAttribute("data-am-idx") || 0);
      const vm = vms[idx];
      if (!playingId && vm) setStatus(`Message ${idx + 1} — ${vm.from_label || "Caller"}`);
      return vmId;
    };
    el.addEventListener("click", () => select());
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        select();
      }
    });
  });
}

const PROFILE_ACC_KEY = "ph_profile_acc";

/** Exclusive Profile accordion section ids (order = module order). */
function profileAccIds(kid) {
  return kid
    ? ["profile-photo", "profile-greeting"]
    : ["profile-photo", "profile-name", "profile-greeting", "profile-sounds", "profile-more"];
}

/** Search index for Profile modules (parents / multi-section views). */
function profileSearchMeta(kid) {
  const base = [
    {
      id: "profile-photo",
      kind: "section",
      title: "Photo",
      keywords: "photo picture avatar profile image face speed dial",
    },
    {
      id: "profile-greeting",
      kind: "section",
      title: "Greeting",
      keywords: "greeting answering machine voicemail outgoing message beep record default",
    },
  ];
  if (kid) return base;
  return [
    base[0],
    {
      id: "profile-name",
      kind: "section",
      title: "Display name",
      keywords: "name display label kid label line softphone identity rename",
    },
    base[1],
    {
      id: "profile-sounds",
      kind: "section",
      title: "Ringer & speaker",
      keywords:
        "sounds ringer ring volume style speaker screening answering machine classic chirp chime modern urgent",
    },
    {
      id: "profile-more",
      kind: "section",
      title: "More",
      keywords: "household parent quiet time pin child mode contacts account help",
    },
  ];
}

function resolveProfileAccordionId(preferred, kid) {
  const ids = profileAccIds(kid);
  if (preferred && ids.includes(preferred)) return preferred;
  try {
    const stored = sessionStorage.getItem(PROFILE_ACC_KEY);
    if (stored && ids.includes(stored)) return stored;
  } catch {
    /* private mode */
  }
  return "profile-photo";
}

function persistProfileAccordionId(id, kid) {
  const ids = profileAccIds(kid);
  try {
    if (id && ids.includes(id)) sessionStorage.setItem(PROFILE_ACC_KEY, id);
    else sessionStorage.removeItem(PROFILE_ACC_KEY);
  } catch {
    /* private mode */
  }
}

function setProfileAccordionOpen(openId, kid) {
  document.querySelectorAll("section.parent-section[data-profile-acc]").forEach((sec) => {
    const isOpen = Boolean(openId) && sec.id === openId;
    sec.classList.toggle("is-open", isOpen);
    const btn = sec.querySelector(":scope > .parent-sec-toggle");
    const body = sec.querySelector(":scope > .parent-sec-body");
    if (btn) btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (body) body.hidden = !isOpen;
  });
  persistProfileAccordionId(openId || "", kid);
}

function bindProfileAccordion(kid) {
  document.querySelectorAll("section.parent-section[data-profile-acc]").forEach((sec) => {
    const btn = sec.querySelector(":scope > .parent-sec-toggle");
    btn?.addEventListener("click", () => {
      const already = sec.classList.contains("is-open");
      setProfileAccordionOpen(already ? "" : sec.id, kid);
    });
  });
}

function applyProfileSearch(rawQuery, kid) {
  const q = normalizeParentSearchQuery(rawQuery);
  const metaList = profileSearchMeta(kid);
  let matchCount = 0;
  let firstSectionId = "";

  for (const meta of metaList) {
    const el = document.getElementById(meta.id);
    if (!el) continue;
    const ok = parentSearchMatches(meta, q);
    el.classList.toggle("parent-search-hidden", Boolean(q) && !ok);
    if (ok) {
      matchCount += 1;
      if (!firstSectionId && meta.kind === "section") firstSectionId = meta.id;
    }
  }

  document.querySelectorAll(".profile-jump a").forEach((a) => {
    const id = a.getAttribute("href")?.slice(1);
    const meta = metaList.find((m) => m.id === id);
    const ok = !q || (meta && parentSearchMatches(meta, q));
    a.hidden = Boolean(q) && !ok;
    a.classList.toggle("parent-search-hidden", Boolean(q) && !ok);
  });

  const jump = document.querySelector(".profile-jump");
  if (jump) {
    const anyChip = [...jump.querySelectorAll("a")].some((a) => !a.hidden);
    jump.classList.toggle("parent-search-hidden", Boolean(q) && !anyChip);
  }

  const empty = document.getElementById("profile-search-empty");
  if (empty) empty.hidden = !q || matchCount > 0;

  const clearBtn = document.getElementById("profile-search-clear");
  if (clearBtn) clearBtn.hidden = !String(rawQuery || "").length;

  if (q && firstSectionId) setProfileAccordionOpen(firstSectionId, kid);
}

function bindProfileSearch(kid) {
  const input = document.getElementById("profile-search");
  const clearBtn = document.getElementById("profile-search-clear");
  if (!input) return;

  const run = () => {
    state.profileSearch = input.value;
    applyProfileSearch(input.value, kid);
  };

  input.addEventListener("input", run);
  clearBtn?.addEventListener("click", () => {
    input.value = "";
    state.profileSearch = "";
    applyProfileSearch("", kid);
    input.focus();
  });
  applyProfileSearch(input.value, kid);
}

function profileSecHtml(id, title, hint, open, icon, bodyHtml) {
  return `<section class="sheet control-card parent-section${open ? " is-open" : ""}" id="${id}" data-profile-acc>
        ${parentSecToggle(id, title, hint, open, icon)}
        <div class="parent-sec-body" id="${id}-body" role="region" aria-labelledby="${id}-toggle"${open ? "" : " hidden"}>
        ${bodyHtml}
        </div>
      </section>`;
}

/** Focused line profile — photo, greeting, ringer. Household Parent stays in the dock. */
function renderProfile() {
  const hh = state.households[0];
  const lines = hh?.lines || [];
  const line = lineBeingEdited();
  const editingId = line?.id || state.editLineId || state.activeLineId;
  const lineLabel = line?.child_label || line?.name || "This line";
  const ringVol = hh?.ring_volume ?? 70;
  const kid = isKidExperience();
  const canPickLine = !kid && lines.length > 1;
  const accOpen = resolveProfileAccordionId(undefined, kid);
  const showSearch = !kid;
  const searchVal = String(state.profileSearch || "").replace(/"/g, "&quot;");

  const photoBody = `
          <p class="tiny">Shown on speed dial and during calls for <strong>${lineLabel}</strong>.</p>
          <div class="avatar-edit-row">
            ${avatarHtml(lineLabel, line?.id, "lg")}
            <div class="avatar-edit-actions">
              <button type="button" class="primary" id="profile-avatar-change">${line?.has_avatar ? "Change photo" : "Add photo"}</button>
              <button type="button" class="ghost" id="profile-avatar-remove" ${line?.has_avatar ? "" : "disabled"}>Remove</button>
              <input type="file" id="profile-avatar-file" accept="image/*" hidden />
              <p class="tiny" id="profile-avatar-status"></p>
            </div>
          </div>`;

  const nameBody = `
          ${
            canPickLine
              ? `<label>Line to edit</label>
        <select id="profile-line">${lines
          .map(
            (l) =>
              `<option value="${l.id}" ${l.id === editingId ? "selected" : ""}>${l.child_label || l.name}${l.mode === "child" ? " · child" : ""}</option>`
          )
          .join("")}</select>
        <p class="tiny" style="margin-bottom:12px">Editing a kid line here does not switch your live phone or kick them offline.</p>`
              : ""
          }
          <label>Display name</label>
          <input id="profile-line-name" maxlength="64" value="${(line?.name || "").replace(/"/g, "&quot;")}" placeholder="e.g. Mom’s phone" />
          <label style="margin-top:10px">Kid label (optional)</label>
          <input id="profile-child-label" maxlength="64" value="${(line?.child_label || "").replace(/"/g, "&quot;")}" placeholder="e.g. Maya’s phone" />
          <button class="primary" id="profile-save-name" style="margin-top:12px">Save name</button>`;

  const greetingBody = `
          <p class="tiny">Short outgoing message before the beep for <strong>${lineLabel}</strong>.</p>
          <p class="tiny">${line?.has_greeting ? "Custom greeting is on." : "Default: “Please leave a message after the beep.”"}</p>
          <audio id="profile-greet-preview" controls style="display:block;width:100%;max-width:100%;margin:8px 0" src="${
            line?.has_greeting
              ? `/api/lines/${line.id}/greeting?sid=${encodeURIComponent(state.sessionId)}`
              : "/default-greeting.wav"
          }"></audio>
          <div class="btn-row two">
            <button class="primary" id="profile-greet-record">${line?.has_greeting ? "Re-record" : "Record greeting"}</button>
            <button class="ghost" id="profile-greet-default">${
              line?.has_greeting
                ? "Use default greeting"
                : line?.greeting_confirmed
                  ? "Default greeting confirmed"
                  : "Use default greeting"
            }</button>
          </div>
          <p class="vm-rec-status tiny" id="profile-greet-status" style="margin-top:8px"></p>`;

  const soundsBody = `
          <div class="parent-field" style="margin-top:0;padding-top:0;border-top:none">
          <h3 class="parent-subhead">Ringer</h3>
          <p class="tiny">Volume and style for the <strong>incoming</strong> ringer — not the caller’s ringback.</p>
          <label id="profile-ring-volume-label">Volume (${ringVol})</label>
          <input id="profile-ring-volume" type="range" min="0" max="100" step="5" value="${ringVol}" />
          <label style="margin-top:10px">Style</label>
          <div class="ringer-grid">
            ${[
              ["classic", "90s bell"],
              ["chirp", "Chirp"],
              ["modern", "Modern"],
              ["chime", "Soft chime"],
              ["urgent", "Urgent pulse"],
            ]
              .map(
                ([id, label]) =>
                  `<button type="button" class="ringer-opt ${(hh?.ringer_style || "classic") === id ? "on" : ""}" data-profile-ringer="${id}">${label}</button>`
              )
              .join("")}
          </div>
          <div class="btn-row two" style="margin-top:10px">
            <button class="primary" id="profile-save-ringer">Save ringer</button>
            <button class="ghost" id="profile-preview-ringer">Play sample</button>
          </div>
        </div>
        <div class="parent-field">
          <h3 class="parent-subhead">Speaker (call screening)</h3>
          <p class="tiny">Optional — off by default. Like a 90s answering machine speaker: play the caller’s message out loud while they record. Messages still save either way.</p>
          <label class="check-row">
            <input type="checkbox" id="profile-answering-machine" ${line?.answering_machine ? "checked" : ""} />
            Play messages out loud as they’re left
          </label>
        </div>`;

  const moreBody = `
          <p class="tiny">Quiet Time, PIN, Child mode, and people live in Parent controls.</p>
          <button type="button" class="ghost" id="profile-to-parent">Parent controls</button>`;

  const sections = [
    profileSecHtml(
      "profile-photo",
      "Photo",
      kid ? "Your picture on speed dial and calls." : "Picture family sees for this line.",
      accOpen === "profile-photo",
      "photo",
      photoBody
    ),
  ];
  if (!kid) {
    sections.push(
      profileSecHtml(
        "profile-name",
        "Display name",
        "How this softphone is labeled for family.",
        accOpen === "profile-name",
        "name",
        nameBody
      )
    );
  }
  sections.push(
    profileSecHtml(
      "profile-greeting",
      "Greeting",
      kid ? "What callers hear before the beep." : "Answering-machine message for this line.",
      accOpen === "profile-greeting",
      "greeting",
      greetingBody
    )
  );
  if (!kid) {
    sections.push(
      profileSecHtml(
        "profile-sounds",
        "Ringer & speaker",
        "Incoming ring on this device and call screening.",
        accOpen === "profile-sounds",
        "sounds",
        soundsBody
      ),
      profileSecHtml(
        "profile-more",
        "More",
        "Quiet Time, PIN, and household tools.",
        accOpen === "profile-more",
        "more",
        moreBody
      )
    );
  }

  setAppPage(`
      <div class="profile-page-nav">
        <button type="button" class="icon-btn" id="profile-back" aria-label="Back">←</button>
      </div>
      ${flashHtml()}
      <p class="lede tight">${
        kid
          ? "Your picture and greeting. Ask a parent for Quiet Time and other household settings."
          : "Edit any household line’s picture and greeting — your softphone stays on the line that’s ringing for you."
      }</p>
      ${
        showSearch
          ? `<div class="parent-search">
        <label class="visually-hidden" for="profile-search">Search Profile settings</label>
        <div class="parent-search-row">
          <input
            type="search"
            id="profile-search"
            name="profile-search"
            placeholder="Search settings…"
            autocomplete="off"
            enterkeyhint="search"
            value="${searchVal}"
          />
          <button type="button" class="ghost parent-search-clear" id="profile-search-clear" hidden aria-label="Clear search">Clear</button>
        </div>
        <p class="tiny parent-search-empty" id="profile-search-empty" hidden>No matching settings</p>
      </div>
      <nav class="parent-jump profile-jump" aria-label="Profile sections">
        <a href="#profile-photo">Photo</a>
        <a href="#profile-name">Name</a>
        <a href="#profile-greeting">Greeting</a>
        <a href="#profile-sounds">Sounds</a>
        <a href="#profile-more">More</a>
      </nav>`
          : ""
      }
      ${sections.join("\n")}
  `);

  bindProfileAccordion(kid);
  if (showSearch) {
    bindProfileSearch(kid);
    document.querySelectorAll(".profile-jump a").forEach((a) => {
      a.addEventListener("click", (e) => {
        const id = a.getAttribute("href")?.slice(1);
        const el = id ? document.getElementById(id) : null;
        if (!el) return;
        e.preventDefault();
        setProfileAccordionOpen(id, kid);
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  document.getElementById("profile-back")?.addEventListener("click", () => {
    state.editLineId = "";
    state.screen = "home";
    state.nav = "phone";
    localStorage.setItem("kl_nav", "phone");
    render();
  });
  document.getElementById("profile-line")?.addEventListener("change", (e) => {
    const id = e.target.value;
    if (!id) return;
    // Edit media/name only — do not re-register WS as this line (would kick the kid offline).
    state.editLineId = id;
    render();
  });
  document.getElementById("profile-to-parent")?.addEventListener("click", () => openParentPanel());
  document.getElementById("profile-save-name")?.addEventListener("click", async () => {
    if (!hh || !line) return;
    try {
      const name = document.getElementById("profile-line-name")?.value.trim() || line.name;
      const child_label = document.getElementById("profile-child-label")?.value.trim() || null;
      await api(`/api/households/${hh.id}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, child_label }),
      });
      setFlash("Line name saved", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save name", "error");
      render();
    }
  });
  document.getElementById("profile-avatar-change")?.addEventListener("click", () => {
    document.getElementById("profile-avatar-file")?.click();
  });
  document.getElementById("profile-avatar-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !hh || !line) return;
    const status = document.getElementById("profile-avatar-status");
    try {
      if (status) status.textContent = "Preparing photo…";
      const { dataUrl, mime } = await squareCropToJpeg(file);
      await api(`/api/households/${hh.id}/lines/${line.id}/avatar`, {
        method: "PUT",
        body: JSON.stringify({ imageBase64: dataUrl, imageMime: mime }),
      });
      setFlash("Profile picture saved", "ok");
      await refresh();
    } catch (err) {
      if (status) status.textContent = err.message || "Could not save photo";
      setFlash(err.message || "Could not save photo", "error");
      render();
    }
  });
  document.getElementById("profile-avatar-remove")?.addEventListener("click", async () => {
    if (!hh || !line) return;
    try {
      await api(`/api/households/${hh.id}/lines/${line.id}/avatar`, { method: "DELETE" });
      setFlash("Profile picture removed", "ok");
      await refresh();
    } catch (err) {
      setFlash(err.message || "Could not remove photo", "error");
      render();
    }
  });
  document.getElementById("profile-ring-volume")?.addEventListener("input", (e) => {
    const lab = document.getElementById("profile-ring-volume-label");
    if (lab) lab.textContent = `Volume (${e.target.value})`;
  });
  document.querySelectorAll("[data-profile-ringer]").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("[data-profile-ringer]").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
    };
  });
  document.getElementById("profile-save-ringer")?.addEventListener("click", async () => {
    if (!hh) return;
    try {
      const ring_volume = Number(document.getElementById("profile-ring-volume").value);
      const ringer_style =
        document.querySelector("[data-profile-ringer].on")?.getAttribute("data-profile-ringer") || "classic";
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ ring_volume, ringer_style }),
      });
      // Saving Sounds with the stock greeting selected counts as confirming it for setup.
      await confirmLineGreetingPreference(hh, line);
      setFlash("Ringer saved", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save ringer", "error");
      render();
    }
  });
  document.getElementById("profile-preview-ringer")?.addEventListener("click", () => {
    const style =
      document.querySelector("[data-profile-ringer].on")?.getAttribute("data-profile-ringer") ||
      householdRingerStyle();
    const vol = Number(document.getElementById("profile-ring-volume")?.value);
    if (state.households[0] && Number.isFinite(vol)) state.households[0].ring_volume = vol;
    playRingerSample(style);
  });
  bindGreetingEditor(hh, line, {
    recordId: "profile-greet-record",
    defaultId: "profile-greet-default",
    statusId: "profile-greet-status",
    previewId: "profile-greet-preview",
  });
  document.getElementById("profile-answering-machine")?.addEventListener("change", async (e) => {
    if (!hh || !line) return;
    const on = Boolean(e.target.checked);
    try {
      await api(`/api/households/${hh.id}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ answering_machine: on }),
      });
      line.answering_machine = on ? 1 : 0;
      setFlash(on ? "Answering machine on" : "Answering machine off", "ok");
    } catch (err) {
      e.target.checked = !on;
      setFlash(err.message || "Could not update answering machine", "error");
    }
  });
}

const PARENT_ACC_IDS = [
  "parent-line",
  "parent-people",
  "parent-hours",
  "parent-pin",
  "parent-ata",
  "parent-sounds",
  "parent-help",
  "parent-account",
];

/** Search index for Parent page modules + quick actions. */
const PARENT_SEARCH_META = [
  {
    id: "parent-now",
    kind: "quick",
    title: "Timeout / Quiet Time",
    keywords:
      "timeout end timeout pause resume phone quiet time dnd kill switch right now stop calls vip",
  },
  {
    id: "parent-line",
    kind: "section",
    title: "Active line",
    keywords:
      "active line softphone profile picture avatar photo child mode lock device kid label guardian authorized parents child login password delete kid line erase",
  },
  {
    id: "parent-people",
    kind: "section",
    title: "Contacts & speed dials",
    keywords:
      "contacts people speed dial invite family allowlist nickname vip dial pad slots kid profiles delete kid erase",
  },
  {
    id: "parent-hours",
    kind: "section",
    title: "Quiet Time & limits",
    keywords:
      "quiet time quiet hours limits schedule bedtime school open daily talk cap minutes timezone custom",
  },
  {
    id: "parent-pin",
    kind: "section",
    title: "Parent PIN",
    keywords: "pin parent lock layout speed dial unlock password digits kid",
  },
  {
    id: "parent-ata",
    kind: "section",
    title: "Analog Phone",
    keywords:
      "analog phone adapter ata ht801 grandstream fanvil g100s house phone landline corded cordless fxs sip tls setup download config extension mac amazon ebay shop buy",
  },
  {
    id: "parent-sounds",
    kind: "section",
    title: "Sounds",
    keywords:
      "sounds ringer ring volume style greeting answering machine speaker screening beep classic chirp",
  },
  {
    id: "parent-help",
    kind: "section",
    title: "Help",
    keywords:
      "help tutorial guide how to privacy encryption softphone mic finish setup checklist onboarding",
  },
  {
    id: "parent-account",
    kind: "section",
    title: "Account",
    keywords: "account username password sign out logout credentials delete account erase wipe leave",
  },
];

function normalizeParentSearchQuery(q) {
  return String(q || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parentSearchMatches(meta, q) {
  if (!q) return true;
  const hay = `${meta.title} ${meta.keywords}`.toLowerCase();
  return q.split(" ").every((token) => token && hay.includes(token));
}

function applyParentSearch(rawQuery) {
  const q = normalizeParentSearchQuery(rawQuery);
  let matchCount = 0;
  let firstSectionId = "";

  for (const meta of PARENT_SEARCH_META) {
    const el = document.getElementById(meta.id);
    if (!el) continue;
    const ok = parentSearchMatches(meta, q);
    el.classList.toggle("parent-search-hidden", Boolean(q) && !ok);
    if (ok) {
      matchCount += 1;
      if (!firstSectionId && meta.kind === "section") firstSectionId = meta.id;
    }
  }

  document.querySelectorAll(".parent-jump a").forEach((a) => {
    const id = a.getAttribute("href")?.slice(1);
    const meta = PARENT_SEARCH_META.find((m) => m.id === id);
    const ok = !q || (meta && parentSearchMatches(meta, q));
    a.hidden = Boolean(q) && !ok;
    a.classList.toggle("parent-search-hidden", Boolean(q) && !ok);
  });

  const jump = document.querySelector(".parent-jump");
  if (jump) {
    const anyChip = [...jump.querySelectorAll("a")].some((a) => !a.hidden);
    jump.classList.toggle("parent-search-hidden", Boolean(q) && !anyChip);
  }

  const empty = document.getElementById("parent-search-empty");
  if (empty) empty.hidden = !q || matchCount > 0;

  const clearBtn = document.getElementById("parent-search-clear");
  if (clearBtn) clearBtn.hidden = !String(rawQuery || "").length;

  if (q && firstSectionId) setParentAccordionOpen(firstSectionId);
}

function bindParentSearch() {
  const input = document.getElementById("parent-search");
  const clearBtn = document.getElementById("parent-search-clear");
  if (!input) return;

  const run = () => {
    state.parentSearch = input.value;
    applyParentSearch(input.value);
  };

  input.addEventListener("input", run);
  clearBtn?.addEventListener("click", () => {
    input.value = "";
    state.parentSearch = "";
    applyParentSearch("");
    input.focus();
  });
  applyParentSearch(input.value);
}

/** Curated parent-facing help (no ops secrets / infra IPs). */
const PARENT_HELP_ARTICLES = [
  {
    id: "analog",
    title: "Analog Phone setup",
    body: `<p>Use a Grandstream HT801 (or similar) so a real handset rings with the kid’s line.</p>
<ol>
  <li>Open <strong>Parent → Analog Phone</strong> and pick the kid line.</li>
  <li>Choose the adapter model, then <strong>Save connection</strong>.</li>
  <li>Prefer <strong>Set up adapter</strong> when PhoneHome at your house shares Wi‑Fi with the adapter. Otherwise plug Ethernet, open the adapter’s web page, <strong>Download config</strong> from the app, upload it on the adapter, and reboot.</li>
  <li>Plug a phone into the FXS jack. Dial <strong>0</strong> for Home / parent, or <strong>1–9</strong> for speed dials.</li>
  <li>Dial <strong>*98</strong> for Messages on the handset (same inbox as the app). Press <strong>2</strong> for greetings — record, play, or clear the answering-machine greeting shared with softphone Sounds.</li>
</ol>
<p>Contacts and speed dials live in PhoneHome — changing them in the app updates the handset without re-uploading config. After a successful one-tap setup, the sticker admin password no longer works; use the password you chose. Too many wrong logins lock the adapter web UI for a couple of minutes.</p>
<p class="tiny">Calls use encrypted SIP (TLS) and SRTP. Keep the adapter on your home network; use the in-app flow rather than hand-editing SIP passwords.</p>`,
  },
  {
    id: "quiet-pin",
    title: "Quiet Time, PIN &amp; kid lock",
    body: `<p>Buttons at the top of Parent can start <strong>Timeout</strong> (stops all household calls) or <strong>Quiet Time</strong> immediately. <strong>Quiet Time &amp; limits</strong> sets named windows (Bedtime, School, custom) and an optional daily talk cap.</p>
<p>Set a <strong>Parent PIN</strong> (4–6 digits) before locking a kid device. The PIN is asked when a kid device or kid account opens Parent — not on your unlocked parent phone.</p>
<p><strong>Lock this device</strong> (Active line) puts the phone in Child mode: speed dial + Activity/Messages only. Exiting needs the PIN. Optional <strong>Lock speed dial layout</strong> stops kids from rearranging slots until the PIN unlocks layout.</p>
<p class="tiny">A child is a line on your family network, not a separate household. You can authorize other parents as guardians for that line.</p>`,
  },
  {
    id: "privacy",
    title: "Privacy &amp; encryption",
    body: `<p>PhoneHome is built so family calls stay private.</p>
<ul>
  <li><strong>Softphones</strong> use encrypted WebRTC (DTLS-SRTP). The server helps set up the call; voice media is encrypted between devices.</li>
  <li><strong>Analog adapters</strong> register with encrypted SIP (TLS) and use SRTP for media — not cleartext over the public internet.</li>
  <li>We don’t keep your call audio. Missed-call greetings live as answering-machine messages you control.</li>
  <li>Kids can only reach people you invite and both sides approve (allowlist-first).</li>
</ul>
<p class="tiny">Parents set who kids can reach — that’s safety, not selling data. Use HTTPS when you’re away from home.</p>`,
  },
  {
    id: "softphone",
    title: "Softphone mic &amp; Add to Home Screen",
    body: `<p>Safari asks for the microphone when you place or answer a call. Allow when prompted.</p>
<p>On iPhone/iPad, open the <strong>HTTPS</strong> PhoneHome URL in <strong>Safari</strong>, then Share → <strong>Add to Home Screen</strong> and open from that icon.</p>
<p class="tiny">If the mic is blocked: aA → Website Settings → Microphone → Allow. Use one stable HTTPS address (not a changing trycloudflare link).</p>`,
  },
  {
    id: "contacts",
    title: "Contacts &amp; speed dials",
    body: `<p>Family calling is invite + mutual approve — both sides must allowlist before a call connects.</p>
<ul>
  <li><strong>Contacts &amp; speed dials</strong> — edit nicknames, invite family, and assign dial-pad slots 1–9.</li>
  <li>Slot <strong>0</strong> is Home / the household parent line.</li>
  <li>On an unlocked parent phone you can drag to rearrange. On kid / Child mode devices, rearranging needs the Parent PIN when layout lock is on.</li>
  <li>Kid photo shortcuts open that child’s profile (picture, greeting) without switching your softphone line.</li>
</ul>
<p class="tiny">Outside lines (cell / landline / 911 via SIP) are a paid add-on later. Network-to-network family calling is free here.</p>`,
  },
];

function parentHelpArticleHtml(article) {
  const open = state.parentHelpFocus === article.id ? " open" : "";
  return `<details class="help-article" data-help-id="${article.id}"${open}>
    <summary>${article.title}</summary>
    <div class="help-article-body">${article.body}</div>
  </details>`;
}
const PARENT_ACC_KEY = "ph_parent_acc";

/** Exclusive Parent accordion: which section stays open (default: all closed). */
function resolveParentAccordionId(preferred) {
  if (preferred && PARENT_ACC_IDS.includes(preferred)) return preferred;
  try {
    const stored = sessionStorage.getItem(PARENT_ACC_KEY);
    // Old default was Active line; migrate so returning users don't keep it forced open.
    if (stored === "parent-line") {
      sessionStorage.removeItem(PARENT_ACC_KEY);
      return "";
    }
    if (stored && PARENT_ACC_IDS.includes(stored)) return stored;
  } catch {
    /* private mode */
  }
  return "";
}

function persistParentAccordionId(id) {
  try {
    if (id && PARENT_ACC_IDS.includes(id)) sessionStorage.setItem(PARENT_ACC_KEY, id);
    else sessionStorage.removeItem(PARENT_ACC_KEY);
  } catch {
    /* private mode */
  }
}

/** Parent / Profile accordion header icons (decorative; title carries the name). */
function parentSecIcon(kind) {
  switch (kind) {
    case "people":
    case "more":
      return parentSvg();
    case "hours":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 14.3A8.2 8.2 0 0 1 9.7 3.8 7 7 0 1 0 20.2 14.3z"/></svg>`;
    case "pin":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2zm-8 0V7a3 3 0 0 1 6 0v2H9z"/></svg>`;
    case "ata":
      // Classic rotary desk set (MDI phone-classic / ☎ convention): curved handset on
      // cradle + circular dial with hub and finger stop — not modern handset, keypad, or ATA.
      return `<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 7.4V5.1c0-.9.7-1.6 1.6-1.6h.9c.5 0 .9.2 1.2.6L10.2 5h3.6l.7-1.1c.3-.4.7-.6 1.2-.6h.9c.9 0 1.6.7 1.6 1.6v2.3"/><rect x="4.2" y="7.4" width="15.6" height="13.2" rx="1.8"/><circle cx="12" cy="14.7" r="4.2"/><circle cx="12" cy="14.7" r="1.25"/><path d="M14.95 17.25l1.5 1.1"/></svg>`;
    case "sounds":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 9.2v5.6h3.6l4.6 3.6V5.6L6.8 9.2H3.2zm12.2 2.8c0-1.5-.8-2.8-2-3.5v7c1.2-.7 2-2 2-3.5zm2.6 0c0 2.4-1.3 4.5-3.3 5.6l1.1 1.7c2.7-1.5 4.5-4.2 4.5-7.3s-1.8-5.8-4.5-7.3l-1.1 1.7c2 1.1 3.3 3.2 3.3 5.6z"/></svg>`;
    case "photo":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.4 5.8h3.1l1.2-1.6h6.6l1.2 1.6h3.1c1 0 1.8.8 1.8 1.8v10.6c0 1-.8 1.8-1.8 1.8H4.4c-1 0-1.8-.8-1.8-1.8V7.6c0-1 .8-1.8 1.8-1.8zM12 8.6a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4zm0 1.8a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z"/></svg>`;
    case "greeting":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2a4.6 4.6 0 0 0-4.6 4.6v3.4a4.6 4.6 0 0 0 9.2 0V7.8A4.6 4.6 0 0 0 12 3.2zm-7 9.4h1.8a5.6 5.6 0 0 0 10.4 0H19a7.2 7.2 0 0 1-6.1 5.5v2.1h2.4v1.7H8.7v-1.7h2.4v-2.1A7.2 7.2 0 0 1 5 12.6z"/></svg>`;
    case "name":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 5.4h10.2v1.8H4.2V5.4zm0 4.4h15.6v1.8H4.2V9.8zm0 4.4h12.4v1.8H4.2v-1.8zm0 4.4h8.6v1.8H4.2v-1.8z"/></svg>`;
    case "help":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2a9.8 9.8 0 1 0 0 19.6 9.8 9.8 0 0 0 0-19.6zm0 14.6a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3zm1.5-4.5c-.55.35-.9.7-.9 1.35h-1.7c0-1.2.6-1.85 1.35-2.3.6-.35.95-.6.95-1.15 0-.55-.4-.95-1.1-.95-.75 0-1.2.4-1.35 1.05l-1.65-.35C9.4 8.4 10.45 7.3 12.1 7.3c1.7 0 2.9 1.05 2.9 2.55 0 .95-.5 1.6-1.5 2.25z"/></svg>`;
    case "account":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M4.4 19.6v-1.8c0-2.7 3.2-4.5 7.6-4.5s7.6 1.8 7.6 4.5v1.8H4.4z"/></svg>`;
    case "line":
    default:
      return phoneSvg();
  }
}

function parentSecToggle(id, title, hint, open, icon = "line", statusChipHtml = "") {
  return `<button type="button" class="parent-sec-toggle" id="${id}-toggle" aria-expanded="${
    open ? "true" : "false"
  }" aria-controls="${id}-body">
    <span class="parent-sec-toggle-main">
      <span class="parent-sec-title-row">
        <span class="parent-sec-heading">
          <span class="parent-sec-icon" aria-hidden="true">${parentSecIcon(icon)}</span>
          <span class="parent-sec-title">${title}</span>
        </span>
        ${statusChipHtml || ""}
      </span>
      <span class="parent-sec-hint">${hint}</span>
    </span>
    <span class="parent-sec-expand" aria-hidden="true">
      <svg class="parent-sec-expand-icon" viewBox="0 0 24 24" width="26" height="26" fill="none" focusable="false">
        <path d="M5 8.5l7 7 7-7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
  </button>`;
}

function setParentAccordionOpen(openId) {
  document.querySelectorAll("section.parent-section[data-acc]").forEach((sec) => {
    const isOpen = Boolean(openId) && sec.id === openId;
    sec.classList.toggle("is-open", isOpen);
    const btn = sec.querySelector(":scope > .parent-sec-toggle");
    const body = sec.querySelector(":scope > .parent-sec-body");
    if (btn) btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (body) body.hidden = !isOpen;
  });
  persistParentAccordionId(openId || "");
}

function bindParentAccordion() {
  document.querySelectorAll("section.parent-section[data-acc]").forEach((sec) => {
    const btn = sec.querySelector(":scope > .parent-sec-toggle");
    btn?.addEventListener("click", () => {
      const already = sec.classList.contains("is-open");
      setParentAccordionOpen(already ? "" : sec.id);
    });
  });
}

function renderControls() {
  captureAtaFormDraftFromDom();
  const hh = state.households[0];
  const preset = hh.schedule_preset || "open";
  const cap = hh.daily_cap_minutes;
  const used = hh.usage_today_minutes || 0;
  const lines = hh?.lines || [];
  const line = activeLine();
  const ataLine = resolveAtaTargetLine(hh);
  const ataLineLabel = ataLine?.child_label || ataLine?.name || "this kid";
  const ataKids = manageKidLines(hh);
  const lineLabel = line?.child_label || line?.name || "this line";
  const needsCreds = !state.user?.username || !state.user?.has_password;
  const ringVol = hh.ring_volume ?? 70;
  const contacts = externalAllowlist(hh);
  const kidLines = ataKids;
  const timeoutOn = Boolean(hh.kill_switch);
  const quietOn = Boolean(hh.dnd);
  const capPct =
    cap != null ? Math.min(100, Math.round((used / Math.max(cap, 1)) * 100)) : 0;
  const accOpen = resolveParentAccordionId(state.parentScrollTo || undefined);
  const searchVal = String(state.parentSearch || "").replace(/"/g, "&quot;");
  setAppPage(`
      <p class="lede tight">Search settings below. Timeout and Quiet Time stay up top — then Contacts, hours, and PIN.</p>
      ${liveCallBannerHtml(hh)}
      ${flashHtml()}

      <div class="parent-search">
        <label class="visually-hidden" for="parent-search">Search Parent settings</label>
        <div class="parent-search-row">
          <input
            type="search"
            id="parent-search"
            name="parent-search"
            placeholder="Search settings…"
            autocomplete="off"
            enterkeyhint="search"
            value="${searchVal}"
          />
          <button type="button" class="ghost parent-search-clear" id="parent-search-clear" hidden aria-label="Clear search">Clear</button>
        </div>
        <p class="tiny parent-search-empty" id="parent-search-empty" hidden>No matching settings</p>
      </div>

      <div class="parent-now-bar" id="parent-now">
        <div class="parent-pill-row" aria-live="polite">
          <span class="parent-pill ${timeoutOn ? "is-off" : "is-on"}">
            <span class="dot" aria-hidden="true"></span>${timeoutOn ? "Timeout on" : "Timeout off"}
          </span>
          <span class="parent-pill ${quietOn ? "is-quiet" : "is-on"}">
            <span class="dot" aria-hidden="true"></span>${quietOn ? "Quiet Time on" : "Quiet Time off"}
          </span>
        </div>
        <div class="parent-now-actions" role="group" aria-label="Right now">
          <button type="button" class="parent-action ${timeoutOn ? "is-active danger-tone" : ""}" id="toggle-kill">
            <strong>${timeoutOn ? "End timeout" : "Timeout"}</strong>
            <span>${timeoutOn ? "Calls work again for everyone." : "Stops all calls — whole household."}</span>
          </button>
          <button type="button" class="parent-action ${quietOn ? "is-active danger-tone" : ""}" id="toggle-dnd">
            <strong>${quietOn ? "End Quiet Time" : "Start Quiet Time"}</strong>
            <span>${quietOn ? "Normal calling resumes (VIP was still ringing)." : "Blocks calls until you turn it off. VIP still rings."}</span>
          </button>
        </div>
      </div>

      <nav class="parent-jump" aria-label="Parent sections">
        <a href="#parent-line">Line</a>
        <a href="#parent-people">Contacts</a>
        <a href="#parent-hours">Quiet Time</a>
        <a href="#parent-pin">PIN</a>
        <a href="#parent-ata">Analog</a>
        <a href="#parent-sounds">Sounds</a>
        <a href="#parent-help">Help</a>
        <a href="#parent-account">Account</a>
      </nav>

      <section class="sheet control-card parent-section${accOpen === "parent-line" ? " is-open" : ""}" id="parent-line" data-acc>
        ${parentSecToggle("parent-line", "Active line", "Which line this phone uses for calls and profile.", accOpen === "parent-line", "line")}
        <div class="parent-sec-body" id="parent-line-body" role="region" aria-labelledby="parent-line-toggle"${accOpen === "parent-line" ? "" : " hidden"}>
        <label>Active line</label>
        <select id="line">${lines
          .map(
            (l) =>
              `<option value="${l.id}" ${l.id === state.activeLineId ? "selected" : ""}>${l.child_label || l.name}${l.mode === "child" ? " · child" : ""}</option>`
          )
          .join("")}</select>
        <p class="tiny">Outgoing calls and the profile picture follow this line. Analog Phone has its own line picker for the adapter.</p>

        <div class="parent-field">
          <h3 class="parent-subhead">Profile picture</h3>
          <p class="tiny">Shown on speed dial and during calls for <strong>${lineLabel}</strong>.</p>
          <div class="avatar-edit-row">
            ${avatarHtml(lineLabel, line?.id, "lg")}
            <div class="avatar-edit-actions">
              <button type="button" class="primary" id="avatar-change">${line?.has_avatar ? "Change photo" : "Add photo"}</button>
              <button type="button" class="ghost" id="avatar-remove" ${line?.has_avatar ? "" : "disabled"}>Remove</button>
              <input type="file" id="avatar-file" accept="image/*" hidden />
              <p class="tiny" id="avatar-status"></p>
            </div>
          </div>
        </div>

        <div class="parent-field">
          <h3 class="parent-subhead">Lock this device</h3>
          <p class="tiny">Locks <strong>this device</strong> to speed dial (Child mode). Exit needs the parent PIN. A child is a line — not a separate household.</p>
          ${
            line?.mode === "child"
              ? `<p class="parent-mode-chip"><span class="dot" aria-hidden="true"></span>Child mode is on for this line</p>`
              : ""
          }
          <label>Kid label (optional)</label>
          <input id="child-label" placeholder="e.g. Maya’s phone" value="${(line?.child_label || "").replace(/"/g, "&quot;")}" />
          <div class="btn-row two" style="margin-top:10px">
            <button class="primary" id="enable-child">${line?.mode === "child" ? "Lock this device" : "Lock Child mode"}</button>
            <button class="ghost" id="save-child-label">Save label</button>
          </div>
        </div>

        ${
          line?.mode === "child"
            ? `<details class="parent-advanced">
          <summary>Authorized parents &amp; child login</summary>
          <div class="parent-field" style="margin-top:12px;padding-top:0;border-top:0">
            <h3 class="parent-subhead">Authorized parents</h3>
            <p class="tiny">Guardians can manage this child line (contacts, rules, Child mode, live calls${line.child_user ? ", password" : ""}).</p>
            <ul class="guardian-list">
              ${(line.guardians || [])
                .map(
                  (g) =>
                    `<li><span>${g.display_name}${g.username ? ` · <span class="mono">${g.username}</span>` : ""}${g.user_id === state.user?.id ? " · you" : ""}</span>${
                      g.user_id !== state.user?.id
                        ? `<button type="button" class="ghost tiny-btn" data-remove-guardian="${g.user_id}">Remove</button>`
                        : ""
                    }</li>`
                )
                .join("") || "<li class='tiny'>No guardians yet — Lock Child mode adds you.</li>"}
            </ul>
            <label style="margin-top:12px">Add by username</label>
            <input id="guardian-username" autocomplete="username" placeholder="existing parent username" />
            <div class="btn-row two" style="margin-top:10px">
              <button class="primary" id="add-guardian">Add parent</button>
              <button class="ghost" id="invite-guardian">Invite code</button>
            </div>
            <div id="guardian-invite-box" class="tiny" style="margin-top:8px"></div>
            <label style="margin-top:14px">Accept a guardian invite</label>
            <input id="guardian-code" class="mono" inputmode="numeric" maxlength="6" placeholder="······" />
            <button class="ghost" id="redeem-guardian" style="margin-top:8px">Join as guardian</button>
          </div>
          <div class="parent-field">
            <h3 class="parent-subhead">Child login</h3>
            <p class="tiny">${
              line.child_user
                ? `Optional login <strong>${line.child_user.username}</strong> — guardians can reset the password.`
                : "Optional. Child mode works with the parent session + PIN; add a username if the kid needs their own sign-in later."
            }</p>
            <label>Username</label>
            <input id="child-username" autocomplete="username" placeholder="maya.phone" value="${(line.child_user?.username || "").replace(/"/g, "&quot;")}" />
            <label style="margin-top:8px">${line.child_user ? "New password" : "Password"} (8+ characters)</label>
            <input id="child-password" type="password" autocomplete="new-password" placeholder="••••••••" />
            <div class="btn-row two" style="margin-top:10px">
              <button class="primary" id="save-child-login">${line.child_user ? "Update login" : "Create child login"}</button>
              ${
                line.child_user
                  ? `<button class="ghost" id="reset-child-pass">Reset password only</button>`
                  : ""
              }
            </div>
          </div>
        </details>
        <div class="parent-field parent-danger-zone">
          <h3 class="parent-subhead">Delete this kid line</h3>
          <p class="tiny">Permanently removes <strong>${(line.child_label || line.name || "this kid").replace(/</g, "")}</strong> — login, adapter binding, greetings, call history for this line, and their entry on everyone else’s contacts. Other kids in this household stay.</p>
          <button type="button" class="danger" id="delete-active-child-line">Delete kid line…</button>
        </div>`
            : ""
        }
        </div>
      </section>

      <section class="sheet control-card parent-section${accOpen === "parent-people" ? " is-open" : ""}" id="parent-people" data-acc>
        ${parentSecToggle("parent-people", "Contacts &amp; speed dials", "Who can call, nicknames, and dial-pad slots.", accOpen === "parent-people", "people")}
        <div class="parent-sec-body" id="parent-people-body" role="region" aria-labelledby="parent-people-toggle"${accOpen === "parent-people" ? "" : " hidden"}>
        <div class="parent-summary-row">
          <div class="parent-summary-chip">
            <strong>${contacts.length}</strong>
            <span>contact${contacts.length === 1 ? "" : "s"}</span>
          </div>
          <div class="parent-summary-chip">
            <strong>${kidLines.length}</strong>
            <span>kid line${kidLines.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <p class="tiny">Edit nicknames, dial slots, and VIP (VIP still rings during Quiet Time). On Home, hold a contact to rearrange when unlocked.</p>
        <div class="btn-row ${canInviteFamily() ? "two" : ""}">
          <button type="button" class="primary" id="go-manage-contacts">Edit contacts</button>
          ${
            canInviteFamily()
              ? `<button type="button" class="ghost" id="go-invite">Invite family</button>`
              : ""
          }
        </div>
        ${
          kidLines.length
            ? `<div class="parent-field">
          <h3 class="parent-subhead">Kid profiles</h3>
          <p class="tiny">Change a child’s picture or greeting without signing in as them.</p>
          <ul class="guardian-list">
            ${kidLines
              .map(
                (l) =>
                  `<li><span>${l.child_label || l.name}</span><span class="guardian-actions"><button type="button" class="ghost tiny-btn" data-edit-child-profile="${l.id}">Photo &amp; greeting</button><button type="button" class="ghost tiny-btn danger" data-delete-child-line="${l.id}">Delete</button></span></li>`
              )
              .join("")}
          </ul>
        </div>`
            : ""
        }
        </div>
      </section>

      <section class="sheet control-card parent-section${accOpen === "parent-hours" ? " is-open" : ""}" id="parent-hours" data-acc>
        ${parentSecToggle("parent-hours", "Quiet Time &amp; limits", "Named windows (Bedtime, School) and daily talk limits.", accOpen === "parent-hours", "hours")}
        <div class="parent-sec-body" id="parent-hours-body" role="region" aria-labelledby="parent-hours-toggle"${accOpen === "parent-hours" ? "" : " hidden"}>
        <div class="parent-field" style="margin-top:0;padding-top:0;border-top:0">
          <h3 class="parent-subhead">Schedule</h3>
          <p class="tiny">Quiet Time windows in your timezone.</p>
          <div class="preset-grid">
            ${["open", "bedtime", "school"]
              .map(
                (p) =>
                  `<button type="button" class="preset ${preset === p ? "on" : ""}" data-preset="${p}">${p === "open" ? "Open" : p === "bedtime" ? "Bedtime" : "School"}</button>`
              )
              .join("")}
          </div>
          <button class="ghost" id="custom-quiet" style="margin-top:10px">Custom Quiet Time…</button>
          <p class="tiny parent-inline-meta">${quietSummary(hh)}${hh?.quiet_tz ? ` · ${hh.quiet_tz}` : ""}</p>
          ${
            preset === "school"
              ? `<div class="school-schedule-note" style="margin-top:12px">
            <p class="tiny"><strong>School</strong> runs Mon–Fri ${formatQuietClock(hh.quiet_start || "08:00")}–${formatQuietClock(hh.quiet_end || "15:30")}.</p>
            <label class="check-row">
              <input type="checkbox" id="skip-holidays" ${hh.skip_holidays ? "checked" : ""} />
              <span>Skip US federal holidays</span>
            </label>
            <p class="tiny">Observed New Year’s, MLK, Presidents’, Memorial, Juneteenth, July 4, Labor, Columbus/Indigenous Peoples’, Veterans, Thanksgiving, Christmas. Not a full school calendar.</p>
          </div>`
              : ""
          }
        </div>
        <div class="parent-field">
          <h3 class="parent-subhead">Daily talk limit</h3>
          ${
            cap != null
              ? `<div class="usage-bar ${capPct >= 90 ? "hot" : ""}">
            <div class="usage-meta"><span>Used today</span><strong>${used} / ${cap} min</strong></div>
            <div class="usage-track"><i style="width:${capPct}%"></i></div>
          </div>`
              : `<p class="tiny">Used today: <strong>${used} min</strong> · unlimited</p>`
          }
          <label>Minutes per day (blank = unlimited)</label>
          <input id="cap" type="number" min="0" step="5" placeholder="e.g. 60" value="${cap ?? ""}" />
          <button class="primary" id="save-cap" style="margin-top:10px">Save limit</button>
        </div>
        </div>
      </section>

      <section class="sheet control-card parent-section${accOpen === "parent-pin" ? " is-open" : ""}" id="parent-pin" data-acc>
        ${parentSecToggle(
          "parent-pin",
          "Parent PIN",
          hh.has_parent_pin ? "PIN is on — required on kid devices." : "Locks Parent settings on kid devices.",
          accOpen === "parent-pin",
          "pin"
        )}
        <div class="parent-sec-body" id="parent-pin-body" role="region" aria-labelledby="parent-pin-toggle"${accOpen === "parent-pin" ? "" : " hidden"}>
        <p class="tiny">${
          hh.has_parent_pin
            ? "Asked when a kid device (Child mode) or kid account opens Parent — not on your unlocked parent phone."
            : "Set a PIN before locking a kid device, so they can’t change rules or exit Child mode."
        }</p>
        <label>Set 4–6 digit PIN</label>
        <input id="pin" class="mono" inputmode="numeric" maxlength="6" placeholder="····" />
        <div class="btn-row two" style="margin-top:10px">
          <button class="primary" id="save-pin">Save PIN</button>
          <button class="ghost" id="clear-pin">Remove PIN</button>
        </div>
        ${
          hh.has_parent_pin
            ? `<label class="check-row" style="margin-top:14px">
                <input type="checkbox" id="layout-locked" ${hh.layout_locked ?? 1 ? "checked" : ""} />
                Lock speed dial layout
              </label>
              <p class="tiny">On kid / locked devices, rearranging needs the parent PIN. Unlocked parent phones rearrange freely. Child mode is always locked.</p>`
            : ""
        }
        </div>
      </section>

      <section class="sheet control-card parent-section${accOpen === "parent-ata" ? " is-open" : ""}" id="parent-ata" data-acc>
        ${parentSecToggle(
          "parent-ata",
          "Analog Phone",
          "House phone (corded or cordless) via the adapter.",
          accOpen === "parent-ata",
          "ata",
          analogPhoneHeaderChipHtml(ataLine)
        )}
        <div class="parent-sec-body" id="parent-ata-body" role="region" aria-labelledby="parent-ata-toggle"${accOpen === "parent-ata" ? "" : " hidden"}>
        <div class="parent-field ata-field">
          <div class="ata-line-picker">
            <h3 class="parent-subhead">Which line</h3>
            <p class="tiny">Kid whose house phone you’re managing.</p>
            ${
              ataKids.length
                ? `<label class="visually-hidden" for="ata-target-line">Kid line for this adapter</label>
            <select id="ata-target-line" class="ata-target-line-select" aria-label="Adapter for this line">
              ${ataKids
                .map((l) => {
                  const label = (l.child_label || l.name || "Kid").replace(/</g, "");
                  const ext = l.ata?.sip_extension ? ` · ext ${String(l.ata.sip_extension).replace(/</g, "")}` : "";
                  const sel = ataLine && l.id === ataLine.id ? "selected" : "";
                  return `<option value="${l.id}" ${sel}>${label}${ext}</option>`;
                })
                .join("")}
            </select>`
                : `<p class="tiny ata-lan-warn">No kid lines you can manage yet. Add or lock a child line under Active line first.</p>`
            }
          </div>

          ${analogPhoneStatusBannerHtml(ataLine)}

          ${analogPhoneIntroHtml(ataLine)}

          ${
            ataLine?.ata?.sip_extension
              ? `<p class="ata-assigned-ext"><span class="tiny">Assigned extension</span><strong class="mono">${String(ataLine.ata.sip_extension).replace(/</g, "")}</strong></p>`
              : ""
          }

          ${(() => {
            const status = analogPhoneStatusInfo(ataLine);
            const model = (state.ataModelDraft || ataLine?.ata?.model) === "g100s" ? "g100s" : "ht801";
            const isFanvil = model === "g100s";
            const isHt801 = !isFanvil;
            const lanPushKnownOff = state.ataLanPush === false;
            const hasAta = Boolean(ataLine?.ata);
            const canPush = hasAta;
            const labelSafe = String(ataLineLabel).replace(/</g, "");

            const modelRadios = `
          <div class="ata-model-row" role="radiogroup" aria-label="Analog adapter model">
            <label class="check-row"><input type="radio" name="ata-model" value="ht801" ${isFanvil ? "" : "checked"} /> Grandstream HT801</label>
            <label class="check-row"><input type="radio" name="ata-model" value="g100s" ${isFanvil ? "checked" : ""} /> Fanvil G100S</label>
          </div>`;

            const remoteCard = `
          <div class="ata-mode-card ata-mode-remote ${lanPushKnownOff ? "ata-mode-preferred" : ""}" id="ata-remote-box">
            <div class="ata-mode-badge">${lanPushKnownOff ? "Use this" : "Hub elsewhere"}</div>
            <h3 class="parent-subhead">Download config</h3>
            <p class="tiny">${
              lanPushKnownOff
                ? "Home hub isn’t on the adapter’s Wi‑Fi. Download, then upload on the adapter’s local web page."
                : "When the home hub can’t reach the adapter, download and upload on the adapter’s page."
            }</p>
            <button type="button" class="${lanPushKnownOff ? "primary" : "ghost"}" id="ata-download" ${canPush ? "" : "disabled"}>Download config</button>
            ${
              canPush
                ? `<p class="tiny ata-actions-hint">${
                    lanPushKnownOff
                      ? "Then: https://&lt;adapter-IP&gt; → Backup / Import → upload → reboot."
                      : "Fallback when one-tap isn’t available."
                  }</p>`
                : `<p class="tiny ata-actions-hint">Save connection first.</p>`
            }
          </div>`;

            const lanCard = isHt801
              ? `
          <div class="ata-mode-card ata-mode-lan ${lanPushKnownOff ? "ata-mode-unavailable" : "ata-mode-preferred"}" id="ata-push-box">
            <div class="ata-mode-badge">${lanPushKnownOff ? "Needs home hub nearby" : "Home hub on Wi‑Fi"}</div>
            <h3 class="parent-subhead">Set up adapter</h3>
            ${
              lanPushKnownOff
                ? `<p class="tiny ata-lan-warn">One-tap needs the home hub on the same Wi‑Fi as the HT801. Use <strong>Download config</strong> instead.</p>`
                : `<p class="tiny">Home hub on the same Wi‑Fi as the HT801 uploads config for you. App can be anywhere.</p>
            <label>Adapter IP address</label>
            <input id="ata-ip" class="mono" inputmode="decimal" placeholder="192.168.1.50" autocomplete="off" value="${escAttr(state.ataFormDraft?.ip)}" />
            <label style="margin-top:8px">Current admin password</label>
            <input id="ata-box-pass" type="password" autocomplete="current-password" placeholder="Password from last setup (sticker only if never set up)" value="${escAttr(state.ataFormDraft?.boxPass)}" />
            <label style="margin-top:8px">New admin password</label>
            <input id="ata-new-pass" type="password" autocomplete="new-password" placeholder="e.g. HousePhone1" value="${escAttr(state.ataFormDraft?.newPass)}" />
            <label style="margin-top:8px">Confirm new password</label>
            <input id="ata-new-pass2" type="password" autocomplete="new-password" placeholder="Same again" value="${escAttr(state.ataFormDraft?.newPass2)}" />
            <p class="tiny">8–30 chars, letters + numbers (upper, lower, digit). No symbols. One try only — wrong passwords lock the web UI ~2 min (SIP can still work). Prefer Download config if unsure.</p>
            <button type="button" class="primary" id="ata-push" style="margin-top:12px" ${canPush && !state.ataPushCooldownUntil ? "" : "disabled"}>Set up adapter</button>
            ${
              canPush
                ? `<p class="tiny ata-actions-hint">Keep the new password somewhere safe.</p>`
                : `<p class="tiny ata-actions-hint">Save connection first.</p>`
            }`
            }
          </div>`
              : "";

            const setupCards = lanPushKnownOff ? remoteCard + lanCard : lanCard + remoteCard;

            const helpDetails = `
          <details class="ata-help">
            <summary>Setup tips</summary>
            <ol class="ata-steps">
              ${
                isFanvil
                  ? `<li>Power + <strong>WAN</strong> Ethernet on the G100S.</li>
              <li>Find its IP (sticker or router list).</li>
              <li>Save connection here, then Download config.</li>
              <li>On the adapter: System → Backup/Flash → Import the <span class="mono">.txt</span>.</li>
              <li>Plug in a landline phone; dial <strong>0</strong> (parent) or <strong>1–9</strong>.</li>`
                  : `<li>Power + Ethernet on the HT801.</li>
              <li>Find its IP (sticker, router, or phone <span class="mono">***</span> → 02).</li>
              <li>Save connection, then Set up adapter (same Wi‑Fi as home hub) or Download config.</li>
              <li>Wait about a minute; dial <strong>0</strong> or <strong>1–9</strong>.</li>`
              }
            </ol>
            <p class="tiny">Speed dials stay in the app — no re-upload when contacts change. Calls use SIP TLS + SRTP.</p>
          </details>`;

            if (!ataKids.length || status.kind === "no-line") {
              return "";
            }

            if (!hasAta) {
              return `
          <div class="ata-primary">
            <h3 class="parent-subhead">Set up this line</h3>
            <p class="tiny">Choose the adapter, save, then push or download config for <strong>${labelSafe}</strong>.</p>
            ${modelRadios}
            <div class="ata-save-cta">
              <button type="button" class="primary" id="ata-save" ${ataLine ? "" : "disabled"}>Save connection</button>
              <p class="tiny ata-actions-hint">Assigns a unique extension. Password stays hidden.</p>
            </div>
          </div>
          ${helpDetails}`;
            }

            // Mid-entry: keep the reconnect form visible even if status flips to online.
            const keepFormOpen = ataFormDraftActive();

            if (status.kind === "online" && !keepFormOpen) {
              return `
          <div class="ata-youre-good">
            <p class="ata-youre-good-text">You’re good. Dial <strong>0</strong> for parent, <strong>1–9</strong> for contacts.</p>
            <details class="ata-reconnect"${state.ataFormDraft?.reconnectOpen ? " open" : ""}>
              <summary>Need to reconnect?</summary>
              ${setupCards}
            </details>
          </div>`;
            }

            if (status.kind === "checking" && !keepFormOpen) {
              return `<div class="ata-youre-good"><p class="tiny">Checking registration…</p></div>`;
            }

            const primaryTitle =
              status.kind === "offline" || (status.kind === "online" && keepFormOpen)
                ? "Reconnect"
                : "Finish setup";
            const primaryHint =
              status.kind === "offline" || (status.kind === "online" && keepFormOpen)
                ? "Push or download config again so the adapter re-registers."
                : isFanvil
                  ? "Download config and import it on the adapter."
                  : "Set up via home hub, or download and upload on the adapter.";

            return `
          <div class="ata-primary">
            <h3 class="parent-subhead">${primaryTitle}</h3>
            <p class="tiny">${primaryHint}</p>
            ${setupCards}
          </div>
          ${helpDetails}`;
          })()}

          <details class="ata-advanced"${state.ataFormDraft?.advancedOpen ? " open" : ""}>
            <summary>Advanced</summary>
            <p class="tiny">Server, MAC, caller ID, config path, disconnect. SIP passwords stay hidden.</p>
            ${ataLine?.ata ? analogNeedAdapterLinkHtml() : ""}
            ${
              ataLine?.ata
                ? `
            <h4 class="ata-adv-sub">Adapter model</h4>
            <div class="ata-model-row" role="radiogroup" aria-label="Analog adapter model">
              <label class="check-row"><input type="radio" name="ata-model" value="ht801" ${(state.ataModelDraft || ataLine?.ata?.model) === "g100s" ? "" : "checked"} /> Grandstream HT801</label>
              <label class="check-row"><input type="radio" name="ata-model" value="g100s" ${(state.ataModelDraft || ataLine?.ata?.model) === "g100s" ? "checked" : ""} /> Fanvil G100S</label>
            </div>`
                : ""
            }
            <label style="margin-top:8px">Server address</label>
            <input id="ata-server" class="mono" placeholder="y5876647.eero.online" value="${escAttr(
              state.ataFormDraft?.server || ataLine?.ata?.sip_server || "y5876647.eero.online"
            )}" />
            <label style="margin-top:8px">Adapter MAC (optional)</label>
            <input id="ata-mac" class="mono" placeholder="000b82aabbcc" value="${escAttr(
              state.ataFormDraft?.mac || ataLine?.ata?.mac || ""
            )}" />
            <label style="margin-top:8px">Name on caller ID</label>
            <input id="ata-name" maxlength="64" placeholder="Analog Phone" value="${escAttr(
              state.ataFormDraft?.name || ataLine?.ata?.display_name || ataLineLabel
            )}" />
            ${
              ataLine?.ata
                ? `<div class="ata-save-cta ata-save-cta-advanced">
              <button type="button" class="primary" id="ata-save">Save connection</button>
              <p class="tiny">Only needed after changing server, MAC, or caller ID above.</p>
            </div>
            <div class="ata-auto-path">
              <h4 class="ata-adv-sub">Config Server Path (optional)</h4>
              <p class="tiny">Private link so the adapter can fetch updates itself.</p>
              <button type="button" class="ghost" id="ata-copy-path">Copy Config Server Path</button>
              <p class="mono tiny ata-cfg-path" id="ata-cfg-path" hidden></p>
              <p class="tiny">${
                (state.ataModelDraft || ataLine?.ata?.model) === "g100s"
                  ? "Adapter: System → Auto Provision → paste HTTPS URL → Apply → reboot."
                  : "Adapter: Maintenance → Upgrade Via HTTPS → Config Server Path (leave Firmware blank) → Apply → reboot."
              }</p>
              <div class="btn-row two" style="margin-top:10px">
                <button type="button" class="ghost" id="ata-rotate-token">Make a new link</button>
                <button type="button" class="ghost" id="ata-unlink">Disconnect adapter</button>
              </div>
            </div>`
                : `<p class="tiny" style="margin-top:10px">After the first Save above, connection fields and disconnect appear here.</p>`
            }
          </details>
        </div>
        </div>
      </section>

      <section class="sheet control-card parent-section${accOpen === "parent-sounds" ? " is-open" : ""}" id="parent-sounds" data-acc>
        ${parentSecToggle("parent-sounds", "Sounds", "Incoming ring volume, style, and greeting.", accOpen === "parent-sounds", "sounds")}
        <div class="parent-sec-body" id="parent-sounds-body" role="region" aria-labelledby="parent-sounds-toggle"${accOpen === "parent-sounds" ? "" : " hidden"}>
        <div class="parent-field" style="margin-top:0;padding-top:0;border-top:0">
          <h3 class="parent-subhead">Ringer</h3>
          <p class="tiny">Volume and style when <strong>this phone</strong> rings — not what the caller hears.</p>
          <label id="ring-volume-label">Volume (${ringVol})</label>
          <input id="ring-volume" type="range" min="0" max="100" step="5" value="${ringVol}" />
          <label style="margin-top:10px">Style</label>
          <div class="ringer-grid">
            ${[
              ["classic", "90s bell"],
              ["chirp", "Chirp"],
              ["modern", "Modern"],
              ["chime", "Soft chime"],
              ["urgent", "Urgent pulse"],
            ]
              .map(
                ([id, label]) =>
                  `<button type="button" class="ringer-opt ${(hh.ringer_style || "classic") === id ? "on" : ""}" data-ringer="${id}">${label}</button>`
              )
              .join("")}
          </div>
          <div class="btn-row two" style="margin-top:10px">
            <button class="primary" id="save-ringer">Save ringer</button>
            <button class="ghost" id="preview-ringer">Play sample</button>
          </div>
        </div>
        <div class="parent-field">
          <h3 class="parent-subhead">Answering machine greeting</h3>
          <p class="tiny">${line?.has_greeting ? "Custom greeting is on." : "Default: “Please leave a message after the beep.”"}</p>
          <audio id="greet-preview" controls style="display:block;width:100%;margin:8px 0" src="${
            line?.has_greeting
              ? `/api/lines/${line.id}/greeting?sid=${encodeURIComponent(state.sessionId)}`
              : "/default-greeting.wav"
          }"></audio>
          <div class="btn-row two">
            <button class="primary" id="greet-record">${line?.has_greeting ? "Re-record" : "Record greeting"}</button>
            <button class="ghost" id="greet-default">${
              line?.has_greeting
                ? "Use default greeting"
                : line?.greeting_confirmed
                  ? "Default greeting confirmed"
                  : "Use default greeting"
            }</button>
          </div>
          <p class="vm-rec-status tiny" id="greet-status" style="margin-top:8px"></p>
        </div>
        <div class="parent-field">
          <h3 class="parent-subhead">Speaker (call screening)</h3>
          <p class="tiny">Optional — off by default. Hear the message while it’s left, like a 90s answering machine.</p>
          <label class="check-row">
            <input type="checkbox" id="answering-machine" ${line?.answering_machine ? "checked" : ""} />
            Play messages out loud as they’re left
          </label>
        </div>
        </div>
      </section>

      <section class="sheet control-card parent-section${accOpen === "parent-help" ? " is-open" : ""}" id="parent-help" data-acc>
        ${parentSecToggle(
          "parent-help",
          "Help",
          "Tutorial and how-to guides.",
          accOpen === "parent-help",
          "help"
        )}
        <div class="parent-sec-body" id="parent-help-body" role="region" aria-labelledby="parent-help-toggle"${accOpen === "parent-help" ? "" : " hidden"}>
        ${
          isKidExperience()
            ? ""
            : `<div class="parent-field" style="margin-top:0;padding-top:0;border-top:0">
          <h3 class="parent-subhead">Finish setup</h3>
          <p class="tiny">${
            parentSetupSummary(hh).allRequiredDone
              ? "Required parent setup is complete. Reopen the checklist anytime."
              : `Setup progress ${parentSetupSummary(hh).requiredDone}/${parentSetupSummary(hh).requiredTotal} from your family network — not just a checklist you checked off.`
          }</p>
          <button class="ghost" id="finish-setup">Finish setup</button>
        </div>`
        }
        <div class="parent-field"${isKidExperience() ? ` style="margin-top:0;padding-top:0;border-top:0"` : ""}>
          <h3 class="parent-subhead">Tutorial</h3>
          <p class="tiny">A short walkthrough of how PhoneHome works — lines, Quiet Time, invites, and calling.</p>
          <button class="ghost" id="tutorial">Show tutorial</button>
        </div>
        <div class="parent-field">
          <h3 class="parent-subhead">Guides</h3>
          <p class="tiny">Quick answers for common parent tasks. Expand a topic to read more.</p>
          <div class="help-articles">
            ${PARENT_HELP_ARTICLES.map(parentHelpArticleHtml).join("")}
          </div>
        </div>
        </div>
      </section>

      <section class="sheet control-card parent-section${accOpen === "parent-account" ? " is-open" : ""}" id="parent-account" data-acc>
        ${parentSecToggle(
          "parent-account",
          "Account",
          state.user?.username
            ? `Signed in as <strong>${String(state.user.username).replace(/</g, "")}</strong>`
            : "Username, password, and sign-out.",
          accOpen === "parent-account",
          "account"
        )}
        <div class="parent-sec-body" id="parent-account-body" role="region" aria-labelledby="parent-account-toggle"${accOpen === "parent-account" ? "" : " hidden"}>
        <div class="parent-field" style="margin-top:0;padding-top:0;border-top:0">
          <h3 class="parent-subhead">Credentials</h3>
          <p class="tiny">${
            state.user?.username
              ? `Signed in as <strong>${String(state.user.username).replace(/</g, "")}</strong>`
              : "Create a username so you don’t need a 6-digit code each time."
          }</p>
          <button class="ghost" id="set-pass">${needsCreds ? "Create username & password" : "Change password"}</button>
          <button class="ghost" id="logout" style="margin-top:8px">Sign out</button>
        </div>
        <div class="parent-field parent-danger-zone">
          <h3 class="parent-subhead">Delete account</h3>
          <p class="tiny">Permanently erases your parent account. If you’re the only parent on this household, the whole household is wiped (all kid lines, contacts, voicemails, greetings). If another household member remains, ownership transfers to them and your account leaves. Other families who had your kids on speed dial lose those contacts. This cannot be undone.</p>
          <button type="button" class="danger" id="delete-parent-account">Delete my account…</button>
        </div>
        <p class="tiny parent-footnote">Outside lines (cell / landline / 911 via SIP) are a paid add-on later. Network-to-network family calling is free here.</p>
        </div>
      </section>

      <footer class="parent-legal" id="parent-legal">
        <p class="mark wordmark parent-legal-brand">Phone<span>Home</span></p>
        <p>© 2026 trevlars. PhoneHome is free software under the
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">GNU Affero General Public License v3</a>
          (or later).</p>
        <p>Provided <strong>without warranty</strong> — use at your own risk. Not a substitute for 911 or carrier emergency service. Family calls stay on your private network; you’re responsible for who you invite and approve.</p>
        <p class="tiny">Source and license: github.com/trevlars/kids-landline · Inspired by Digits (AGPL-3.0).</p>
      </footer>
  `);

  bindParentAccordion();
  bindParentSearch();
  bindAtaFormDraftPersistence();
  void ensureKidPhoneStatuses(hh).then((changed) => {
    if (changed && state.nav === "controls") patchAnalogPhoneStatus(hh);
  });
  if (state.parentScrollTo) {
    const jumpId = state.parentScrollTo;
    state.parentScrollTo = "";
    setParentAccordionOpen(jumpId);
    requestAnimationFrame(() => {
      document.getElementById(jumpId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } else {
    persistParentAccordionId(accOpen);
  }
  document.querySelectorAll(".parent-jump a").forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href")?.slice(1);
      const el = id ? document.getElementById(id) : null;
      if (!el) return;
      e.preventDefault();
      setParentAccordionOpen(id);
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.getElementById("go-manage-contacts")?.addEventListener("click", () => {
    state.screen = "manage-contacts";
    render();
  });
  document.getElementById("go-invite")?.addEventListener("click", () => {
    state.screen = "invite";
    render();
  });
  document.querySelectorAll("[data-edit-child-profile]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-edit-child-profile");
      if (!id) return;
      // Open Profile for this kid without stealing their softphone registration.
      state.editLineId = id;
      const ok = await openProfileSurface();
      if (!ok) state.editLineId = "";
    });
  });
  document.querySelectorAll("[data-delete-child-line]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete-child-line");
      if (!id) return;
      await confirmAndDeleteChildLine(hh, id);
    });
  });
  document.getElementById("delete-active-child-line")?.addEventListener("click", async () => {
    const line = activeLine();
    if (!line || line.mode !== "child") return;
    await confirmAndDeleteChildLine(hh, line.id);
  });
  document.getElementById("delete-parent-account")?.addEventListener("click", async () => {
    await confirmAndDeleteParentAccount();
  });
  document.getElementById("toggle-kill").onclick = async () => {
    await api(`/api/households/${hh.id}/rules`, {
      method: "PATCH",
      body: JSON.stringify({ kill_switch: !hh.kill_switch }),
    });
    setFlash(hh.kill_switch ? "Timeout ended" : "Timeout on", "ok");
    await refresh();
  };
  document.getElementById("toggle-dnd").onclick = async () => {
    await api(`/api/households/${hh.id}/rules`, {
      method: "PATCH",
      body: JSON.stringify({ dnd: !hh.dnd }),
    });
    setFlash(hh.dnd ? "Quiet Time ended" : "Quiet Time on", "ok");
    await refresh();
  };
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.onclick = async () => {
      const body = {
        schedule_preset: btn.getAttribute("data-preset"),
        quiet_tz: hh.quiet_tz || browserTimeZone(),
      };
      await api(`/api/households/${hh.id}/rules`, { method: "PATCH", body: JSON.stringify(body) });
      setFlash("Schedule updated", "ok");
      await refresh();
    };
  });
  document.getElementById("skip-holidays")?.addEventListener("change", async (e) => {
    try {
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ skip_holidays: e.target.checked }),
      });
      setFlash(e.target.checked ? "Skipping US federal holidays" : "Holidays count as school days", "ok");
      await refresh();
    } catch (err) {
      setFlash(err.message || "Could not update holiday skip", "error");
      render();
    }
  });
  document.getElementById("custom-quiet").onclick = () => {
    state.screen = "quiet";
    render();
  };
  document.getElementById("save-cap").onclick = async () => {
    try {
      const raw = document.getElementById("cap").value.trim();
      const daily_cap_minutes = raw === "" ? null : Number(raw);
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ daily_cap_minutes }),
      });
      setFlash("Daily limit saved", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save limit", "error");
      render();
    }
  };
  document.getElementById("save-pin").onclick = async () => {
    try {
      const parent_pin = document.getElementById("pin").value.trim();
      if (!/^\d{4,6}$/.test(parent_pin)) {
        setFlash("PIN must be 4–6 digits", "warn");
        render();
        return;
      }
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ parent_pin }),
      });
      state.parentUnlocked = true;
      setFlash("Parent PIN saved", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save PIN", "error");
      render();
    }
  };
  document.getElementById("clear-pin").onclick = async () => {
    try {
      if (hh.has_parent_pin) {
        const pin = await askParentPin("Confirm PIN to remove");
        if (pin == null) return;
      }
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ parent_pin: null }),
      });
      setFlash("PIN removed", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not remove PIN", "error");
      render();
    }
  };
  document.getElementById("layout-locked")?.addEventListener("change", async (e) => {
    try {
      const layout_locked = e.target.checked;
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ layout_locked }),
      });
      if (!layout_locked) state.layoutUnlocked = true;
      else state.layoutUnlocked = false;
      setFlash(layout_locked ? "Speed dial layout locked" : "Speed dial layout unlocked", "ok");
      await refresh();
    } catch (err) {
      setFlash(err.message || "Could not update layout lock", "error");
      render();
    }
  });
  document.getElementById("ring-volume")?.addEventListener("input", (e) => {
    const lab = document.getElementById("ring-volume-label");
    if (lab) lab.textContent = `Volume (${e.target.value})`;
  });
  document.querySelectorAll("[data-ringer]").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("[data-ringer]").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
    };
  });
  document.getElementById("save-ringer")?.addEventListener("click", async () => {
    try {
      const ring_volume = Number(document.getElementById("ring-volume").value);
      const ringer_style =
        document.querySelector("[data-ringer].on")?.getAttribute("data-ringer") || "classic";
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({ ring_volume, ringer_style }),
      });
      // Saving Sounds with the stock greeting selected counts as confirming it for setup.
      await confirmLineGreetingPreference(hh, line);
      setFlash("Ringer saved", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save ringer", "error");
      render();
    }
  });
  document.getElementById("preview-ringer")?.addEventListener("click", () => {
    const style =
      document.querySelector("[data-ringer].on")?.getAttribute("data-ringer") ||
      householdRingerStyle();
    const vol = Number(document.getElementById("ring-volume")?.value);
    if (state.households[0] && Number.isFinite(vol)) state.households[0].ring_volume = vol;
    playRingerSample(style);
  });
  document.getElementById("avatar-change")?.addEventListener("click", () => {
    document.getElementById("avatar-file")?.click();
  });
  document.getElementById("avatar-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !hh || !line) return;
    const status = document.getElementById("avatar-status");
    try {
      if (status) status.textContent = "Preparing photo…";
      const { dataUrl, mime } = await squareCropToJpeg(file);
      await api(`/api/households/${hh.id}/lines/${line.id}/avatar`, {
        method: "PUT",
        body: JSON.stringify({ imageBase64: dataUrl, imageMime: mime }),
      });
      setFlash("Profile picture saved", "ok");
      await refresh();
    } catch (err) {
      if (status) status.textContent = err.message || "Could not save photo";
      setFlash(err.message || "Could not save photo", "error");
      render();
    }
  });
  document.getElementById("avatar-remove")?.addEventListener("click", async () => {
    if (!hh || !line) return;
    try {
      await api(`/api/households/${hh.id}/lines/${line.id}/avatar`, { method: "DELETE" });
      setFlash("Profile picture removed", "ok");
      await refresh();
    } catch (err) {
      setFlash(err.message || "Could not remove photo", "error");
      render();
    }
  });
  bindGreetingEditor(hh, line, {
    recordId: "greet-record",
    defaultId: "greet-default",
    statusId: "greet-status",
    previewId: "greet-preview",
  });
  document.getElementById("answering-machine")?.addEventListener("change", async (e) => {
    if (!hh || !line) return;
    const on = Boolean(e.target.checked);
    try {
      await api(`/api/households/${hh.id}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ answering_machine: on }),
      });
      line.answering_machine = on ? 1 : 0;
      setFlash(on ? "Answering machine on" : "Answering machine off", "ok");
    } catch (err) {
      e.target.checked = !on;
      setFlash(err.message || "Could not update answering machine", "error");
    }
  });
  document.getElementById("line").onchange = () => {
    const next = document.getElementById("line").value;
    if (!selectActiveLine(next)) {
      // Revert the <select> if blocked (e.g. mid-call) or no-op.
      const sel = document.getElementById("line");
      if (sel) sel.value = state.activeLineId;
      render();
      return;
    }
    // Keep Analog picker aligned when Active line is a manage-able kid.
    const kids = manageKidLines(hh);
    if (kids.some((l) => l.id === next)) state.ataTargetLineId = next;
    render();
  };
  document.getElementById("ata-target-line")?.addEventListener("change", () => {
    const next = document.getElementById("ata-target-line")?.value;
    if (!next) return;
    state.ataTargetLineId = next;
    // Sync softphone Active line when idle so Home / dial pad match Analog context.
    if (!state.call && !state.group) {
      selectActiveLine(next);
    }
    render();
  });
  // HT801 / ATA
  document.querySelectorAll("input[name=ata-model]").forEach((el) => {
    el.addEventListener("change", async () => {
      captureAtaFormDraftFromDom();
      state.ataModelDraft = el.value;
      if (hh && ataLine?.ata) {
        try {
          await api(`/api/households/${hh.id}/lines/${ataLine.id}/ata`, {
            method: "PUT",
            body: JSON.stringify({ model: el.value }),
          });
        } catch {
          /* keep draft; Save connection still writes it */
        }
      }
      render();
    });
  });
  (async () => {
    const pathEl = document.getElementById("ata-cfg-path");
    if (pathEl && ataLine?.ata?.provision_token) {
      try {
        const data = await api(`/api/households/${hh.id}/lines/${ataLine.id}/ata`);
        if (data.config_server_path) pathEl.textContent = data.config_server_path;
      } catch {
        const host = location.host;
        pathEl.textContent = `${host}/provision/${ataLine.ata.provision_token}`;
      }
    }
  })();
  document.getElementById("ata-save")?.addEventListener("click", async () => {
    if (!hh || !ataLine) return;
    captureAtaFormDraftFromDom();
    try {
      const sip_server = document.getElementById("ata-server")?.value.trim() || "";
      const mac = document.getElementById("ata-mac")?.value.trim() || null;
      const display_name = document.getElementById("ata-name")?.value.trim() || null;
      const model = document.querySelector("input[name=ata-model]:checked")?.value || "ht801";
      // Extension + password are server-assigned only (never sent from parent UI).
      const body = { sip_server, mac, display_name, model };
      const data = await api(`/api/households/${hh.id}/lines/${ataLine.id}/ata`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      delete state.ataStatusByLine[ataLine.id];
      const ext = data?.ata?.sip_extension;
      setFlash(
        ext ? `Connection saved — extension ${ext}. Tap Set up adapter or Download config.` : "Connection saved — tap Set up adapter",
        "ok"
      );
      await refresh();
      void ensureKidPhoneStatuses(state.households[0], { force: true }).then(() => {
        if (state.nav === "controls") patchAnalogPhoneStatus(state.households[0]);
      });
    } catch (err) {
      setFlash(err.message || "Could not save connection", "error");
      captureAtaFormDraftFromDom();
      render();
    }
  });
  document.getElementById("ata-push")?.addEventListener("click", async () => {
    if (!hh || !ataLine?.ata) return;
    captureAtaFormDraftFromDom();
    const ata_ip = document.getElementById("ata-ip")?.value.trim() || "";
    const box_password = document.getElementById("ata-box-pass")?.value || "";
    const new_password = document.getElementById("ata-new-pass")?.value || "";
    const new_password2 = document.getElementById("ata-new-pass2")?.value || "";
    if (!ata_ip) {
      setFlash("Enter the adapter’s IP address", "warn");
      return;
    }
    if (!box_password) {
      setFlash("Enter the current admin password (sticker, or the one from last setup)", "warn");
      return;
    }
    if (new_password !== new_password2) {
      setFlash("New passwords don’t match", "warn");
      return;
    }
    const btn = document.getElementById("ata-push");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Setting up…";
    }
    try {
      const data = await api(`/api/households/${hh.id}/lines/${ataLine.id}/ata/push`, {
        method: "POST",
        body: JSON.stringify({ ata_ip, box_password, new_password }),
      });
      setFlash(data.message || "Adapter configured", "ok");
      clearAtaPushDrafts();
      delete state.ataStatusByLine[ataLine.id];
      await refresh();
      void ensureKidPhoneStatuses(state.households[0], { force: true }).then(() => {
        if (state.nav === "controls") patchAnalogPhoneStatus(state.households[0]);
      });
    } catch (err) {
      const msg = err.message || "Could not set up adapter";
      // If PhoneHome couldn't reach the ATA, switch UI to remote-first so Download is primary.
      if (/can.?t reach|same (home network|Wi)|Download config instead|home hub|LAN/i.test(msg)) {
        state.ataLanPush = false;
      }
      // Grandstream lockout / wrong password: stop cold — no auto-retry, disable Set up briefly.
      if (err.abortRetries || /locked|tries left|cooldown|Do not try alternate/i.test(msg)) {
        state.ataPushCooldownUntil = Date.now() + (Number(err.cooldownMs) || 130000);
      }
      setFlash(msg, "error");
      captureAtaFormDraftFromDom();
      render();
    }
  });
  document.getElementById("ata-download")?.addEventListener("click", () => {
    if (!hh || !ataLine?.ata) return;
    const sid = encodeURIComponent(state.sessionId || "");
    const g100s = document.querySelector("input[name=ata-model]:checked")?.value === "g100s" || ataLine.ata?.model === "g100s";
    const file = g100s ? "config.txt" : "config.xml";
    window.location.href = `/api/households/${hh.id}/lines/${ataLine.id}/ata/${file}?sid=${sid}`;
  });
  document.getElementById("ata-copy-path")?.addEventListener("click", async () => {
    let text = document.getElementById("ata-cfg-path")?.textContent?.trim();
    if (!text && hh && ataLine?.ata) {
      try {
        const data = await api(`/api/households/${hh.id}/lines/${ataLine.id}/ata`);
        text = data.config_server_path || "";
        const pathEl = document.getElementById("ata-cfg-path");
        if (pathEl && text) pathEl.textContent = text;
      } catch {
        /* ignore — flash below */
      }
    }
    if (!text) {
      setFlash("Path not ready yet — save connection first", "warn");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setFlash("Config Server Path copied", "ok");
    } catch {
      setFlash("Copy failed — try again or check browser permissions", "warn");
    }
  });
  document.getElementById("ata-rotate-token")?.addEventListener("click", async () => {
    if (!hh || !ataLine?.ata) return;
    if (!confirm("Make a new private link? You’ll need to paste it on the adapter again if you use automatic updates.")) return;
    try {
      await api(`/api/households/${hh.id}/lines/${ataLine.id}/ata`, {
        method: "PUT",
        body: JSON.stringify({ rotate_provision_token: true }),
      });
      setFlash("New link created — copy it again if you use automatic updates", "ok");
      await refresh();
    } catch (err) {
      setFlash(err.message || "Could not make a new link", "error");
      render();
    }
  });
  document.getElementById("ata-unlink")?.addEventListener("click", async () => {
    if (!hh || !ataLine?.ata) return;
    if (!confirm("Disconnect this adapter from the kid line?")) return;
    try {
      await api(`/api/households/${hh.id}/lines/${ataLine.id}/ata`, { method: "DELETE" });
      delete state.ataStatusByLine[ataLine.id];
      setFlash("Adapter disconnected", "ok");
      await refresh();
    } catch (err) {
      setFlash(err.message || "Could not disconnect", "error");
      render();
    }
  });
  document.getElementById("save-child-label").onclick = async () => {
    try {
      const child_label = document.getElementById("child-label").value.trim() || null;
      await api(`/api/households/${hh.id}/lines/${state.activeLineId}`, {
        method: "PATCH",
        body: JSON.stringify({ child_label }),
      });
      setFlash("Kid label saved", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save label", "error");
      render();
    }
  };
  document.getElementById("enable-child").onclick = () => enableChildModeOnDevice();
  document.getElementById("add-guardian")?.addEventListener("click", async () => {
    try {
      const username = document.getElementById("guardian-username").value.trim();
      if (!username) {
        setFlash("Enter a parent username", "warn");
        render();
        return;
      }
      await api(`/api/lines/${state.activeLineId}/guardians`, {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setFlash(`Added ${username} as guardian`, "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not add guardian", "error");
      render();
    }
  });
  document.getElementById("invite-guardian")?.addEventListener("click", async () => {
    try {
      const data = await api(`/api/lines/${state.activeLineId}/guardian-invites`, {
        method: "POST",
        body: "{}",
      });
      setFlash(`Guardian invite code ${data.invite.code} — share it with the other parent`, "ok");
      if (navigator.share && data.shareText) {
        try {
          await navigator.share({ title: "PhoneHome guardian", text: data.shareText, url: data.shareUrl });
        } catch {
          /* cancelled */
        }
      } else if (navigator.clipboard && data.shareText) {
        await navigator.clipboard.writeText(data.shareText);
        setFlash(state.flash + " (copied)", "ok");
      }
      render();
    } catch (e) {
      setFlash(e.message || "Could not create invite", "error");
      render();
    }
  });
  document.getElementById("redeem-guardian")?.addEventListener("click", async () => {
    try {
      const code = document.getElementById("guardian-code").value.trim();
      await api("/api/guardian-invites/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setFlash("You’re now a guardian of that child line", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not accept invite", "error");
      render();
    }
  });
  document.querySelectorAll("[data-remove-guardian]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const userId = btn.getAttribute("data-remove-guardian");
        await api(`/api/lines/${state.activeLineId}/guardians/${userId}`, { method: "DELETE" });
        setFlash("Guardian removed", "ok");
        await refresh();
      } catch (e) {
        setFlash(e.message || "Could not remove guardian", "error");
        render();
      }
    });
  });
  document.getElementById("save-child-login")?.addEventListener("click", async () => {
    try {
      const username = document.getElementById("child-username").value.trim();
      const password = document.getElementById("child-password").value;
      await api(`/api/lines/${state.activeLineId}/child-login`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setFlash("Child login saved", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save child login", "error");
      render();
    }
  });
  document.getElementById("reset-child-pass")?.addEventListener("click", async () => {
    try {
      const password = document.getElementById("child-password").value;
      if (!password) {
        setFlash("Enter a new password above", "warn");
        render();
        return;
      }
      const data = await api(`/api/lines/${state.activeLineId}/reset-child-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setFlash(data.flash || data.message || "Password reset by parent", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not reset password", "error");
      render();
    }
  });
  document.getElementById("set-pass").onclick = () => {
    state.screen = "set-password";
    render();
  };
  document.getElementById("finish-setup")?.addEventListener("click", () => {
    reopenSetupChecklist();
  });
  document.getElementById("tutorial").onclick = () => {
    state.tutorialFromSettings = true;
    state.tutorialIndex = 0;
    state.screen = "tutorial";
    render();
  };
  document.getElementById("logout").onclick = async () => {
    await api("/api/auth/logout", { method: "POST" });
    hardReleaseMicStream();
    state.sessionId = "";
    state.user = null;
    state.households = [];
    state.childMode = false;
    localStorage.removeItem("kl_session");
    localStorage.removeItem("kl_line");
    localStorage.removeItem("kl_child_mode");
    localStorage.removeItem("kl_child_line");
    state.screen = "welcome";
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
  const [h, m] = String(hhmm).split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? "am" : "pm";
  const mins = Number.isFinite(m) ? m : 0;
  // Omit :00 — "9pm" not "9:00pm"; keep non-zero minutes ("9:30pm").
  if (!mins) return `${hour12}${ampm}`;
  return `${hour12}:${String(mins).padStart(2, "0")}${ampm}`;
}

/** Display name for the configured schedule window (preset label or generic Quiet Time). */
function quietWindowName(hh) {
  const preset = String(hh?.schedule_preset || "");
  if (preset === "bedtime") return "Bedtime";
  if (preset === "school") return "School";
  return "Quiet Time";
}

function localMinutesInTz(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

function localIsoWeekdayInTz(date, timeZone) {
  try {
    const dayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    const [y, m, d] = dayKey.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return dow === 0 ? 7 : dow;
  } catch {
    const dow = date.getDay();
    return dow === 0 ? 7 : dow;
  }
}

function parseQuietDaysClient(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const days = new Set();
  for (const part of String(raw).split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 7) days.add(n);
  }
  return days.size ? days : null;
}

/** Client mirror of server isQuietHoursActive (time + weekdays; holiday skip omitted). */
function isQuietHoursActiveClient(hh, date = new Date()) {
  if (!hh?.quiet_start || !hh?.quiet_end || !hh?.quiet_tz) return false;
  const [sh, sm] = String(hh.quiet_start).split(":").map(Number);
  const [eh, em] = String(hh.quiet_end).split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return false;
  const startM = sh * 60 + sm;
  const endM = eh * 60 + em;
  if (startM === endM) return false;
  const mins = localMinutesInTz(date, hh.quiet_tz);
  const inWindow = startM < endM ? mins >= startM && mins < endM : mins >= startM || mins < endM;
  if (!inWindow) return false;
  const days = parseQuietDaysClient(hh.quiet_days);
  if (days) {
    const wd = localIsoWeekdayInTz(date, hh.quiet_tz);
    if (!days.has(wd)) return false;
  }
  return true;
}

function quietSummary(hh) {
  if (!hh?.quiet_start || !hh?.quiet_end) return "Open";
  const name = quietWindowName(hh);
  const tz = (hh.quiet_tz || "").split("/").pop()?.replace(/_/g, " ") || "local";
  const preset = hh.schedule_preset || "";
  const days =
    preset === "school" || (hh.quiet_days && String(hh.quiet_days).includes("1,2,3,4,5"))
      ? "Mon–Fri · "
      : "";
  const hol = hh.skip_holidays ? " · skip holidays" : "";
  return `${name} · ${days}${formatQuietClock(hh.quiet_start)}–${formatQuietClock(hh.quiet_end)} · ${tz}${hol}`;
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
      <div class="mark">Quiet Time</div>
      <span style="width:40px"></span>
    </div>
    <div class="sheet">
      <h2>Your family’s Quiet Time window</h2>
      <p>Calls are blocked during this window in <strong>your</strong> timezone — not the host’s server clock.</p>
      <label class="check-row">
        <input type="checkbox" id="q-on" ${enabled ? "checked" : ""} />
        <span>Enable Quiet Time</span>
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
      setFlash(on ? "Quiet Time saved" : "Quiet Time off", "ok");
      state.screen = "home";
      await refresh();
    } catch (e) {
      err.textContent = e.message || "Could not save";
      err.classList.remove("hidden");
    }
  };
}

async function renderInvite() {
  if (!canInviteFamily()) {
    setFlash("Ask a parent to invite family", "warn");
    state.screen = "home";
    render();
    return;
  }
  const hh = state.households[0];
  let sharePayload = null;
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back">←</button>
      <div class="mark">Invite family</div>
      <span style="width:40px"></span>
    </div>
    <div class="invite-hero sheet">
      <p class="invite-eyebrow">Step 1 of 3</p>
      <h2>Invite someone you trust</h2>
      <p>They join your private network with this code. After that, <strong>both of you</strong> still need to approve each other before kids can call.</p>
      <div class="code-box glow" id="code">······</div>
      <p class="tiny center" id="url"></p>
      <p class="flash-banner warn hidden" id="share-warn">This link is plain HTTP (LAN). iPads need the HTTPS tunnel URL — open PhoneHome via trycloudflare.com first, then share again.</p>
      <div class="btn-row">
        <button class="primary" id="share">Share invite</button>
        <button class="ghost" id="copy">Copy link</button>
      </div>
      <button class="linkish" id="refresh-inv">Make a new code</button>
    </div>
    <div class="sheet tip-sheet">
      <h2>What happens next</h2>
      <ol class="how-list">
        <li>They open the link → <em>I was invited</em> → enter this code</li>
        <li>You tap <em>Approve callers</em> and add their name</li>
        <li>They do the same for you → both phones show <em>Ready to call</em></li>
      </ol>
    </div>
  `;
  document.getElementById("back").onclick = () => {
    state.screen = "home";
    render();
  };

  async function loadInvite() {
    const data = await api(`/api/households/${hh.id}/invites`, { method: "POST", body: "{}" });
    // Prefer HTTPS page origin / configured public URL — never accidentally share LAN http://10.x
    const code = data.invite.code;
    let base = (data.publicBaseUrl || "").replace(/\/$/, "");
    if (!base || /^http:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost)/i.test(base)) {
      if (isSecureMicContext()) base = location.origin;
      else base = data.publicBaseUrl || location.origin;
    }
    if (isSecureMicContext() && location.protocol === "https:") {
      // If parent is already on the tunnel/HTTPS host, share that exact origin
      base = location.origin;
    }
    sharePayload = {
      ...data,
      shareUrl: `${base}/?invite=${code}`,
      shareText: `Join our PhoneHome (private family phone). Open the link, tap “I was invited,” enter code ${code}. Then we each approve the other so kids can call.`,
    };
    document.getElementById("code").textContent = code;
    document.getElementById("url").textContent = sharePayload.shareUrl;
    const warn = document.getElementById("share-warn");
    if (warn) {
      const insecure = /^http:/i.test(sharePayload.shareUrl);
      warn.classList.toggle("hidden", !insecure);
    }
  }

  document.getElementById("copy").onclick = async () => {
    if (!sharePayload) return;
    const text = `${sharePayload.shareText}\n${sharePayload.shareUrl}`;
    await navigator.clipboard.writeText(text);
    setFlash("Invite copied — after they join, approve each other", "ok");
    state.screen = "home";
    render();
  };
  document.getElementById("share").onclick = async () => {
    if (!sharePayload) return;
    const text = `${sharePayload.shareText}\n${sharePayload.shareUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "PhoneHome invite",
          text: sharePayload.shareText,
          url: sharePayload.shareUrl,
        });
        setFlash("Invite sent — next: approve each other", "ok");
        state.screen = "home";
        render();
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(text);
    setFlash("Invite copied — paste it in a text", "ok");
    state.screen = "home";
    render();
  };
  document.getElementById("refresh-inv").onclick = loadInvite;
  await loadInvite();
}

function renderAddContact() {
  const hh = state.households[0];
  const already = new Set((hh?.allowlist || []).map((a) => a.target_line_id));
  const others = state.directory.filter((d) => d.household_id !== hh.id && !already.has(d.id));
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back">←</button>
      <div class="mark">Approve caller</div>
      <span style="width:40px"></span>
    </div>
    <div class="sheet">
      <p class="invite-eyebrow">Step 2 of 3</p>
      <h2>Approve who your kids can call</h2>
      <p>This only covers <strong>your</strong> phone. They still need to approve you on theirs before calls work both ways.</p>
      ${
        others.length
          ? `
        <div class="picker-list" id="picker">
          ${others
            .map(
              (d, i) => `
            <button type="button" class="picker-row ${i === 0 ? "selected" : ""}" data-id="${d.id}">
              ${avatarHtml(d.name, d.id, "md")}
              <span><strong>${friendlyPersonName(d.name)}</strong><small>${d.household_name}</small></span>
            </button>`
            )
            .join("")}
        </div>
        <label>Name kids will see</label>
        <input id="label" placeholder="e.g. Maya" value="${others[0] ? friendlyPersonName(others[0].name) : ""}" />
        <label class="check-row"><input type="checkbox" id="vip" /> VIP — can still ring during Quiet Time</label>
        <button class="primary" id="save">Approve on this phone</button>`
          : `<div class="empty hero-empty">
              <strong>Nobody left to approve</strong>
              <p>${
                already.size
                  ? "Everyone who’s joined is already on your list. Ask them to approve you if you still see Needs their OK."
                  : canInviteFamily()
                    ? "Send an invite first. When they join, they’ll show up here for your approval."
                    : "Ask a parent to invite family. When they join and get approved, they’ll show up on your phone."
              }</p>
              ${
                already.size
                  ? `<button class="primary" id="to-invite">Back to contacts</button>`
                  : canInviteFamily()
                    ? `<button class="primary" id="to-invite">Invite someone</button>`
                    : `<button class="primary" id="to-invite">Back home</button>`
              }
            </div>`
      }
    </div>
  `;
  let selectedId = others[0]?.id || "";
  document.getElementById("back").onclick = () => {
    state.screen = "manage-contacts";
    render();
  };
  document.getElementById("to-invite")?.addEventListener("click", () => {
    if (already.size) state.screen = "manage-contacts";
    else if (canInviteFamily()) state.screen = "invite";
    else state.screen = "home";
    render();
  });
  document.querySelectorAll(".picker-row").forEach((row) => {
    row.onclick = () => {
      document.querySelectorAll(".picker-row").forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      selectedId = row.getAttribute("data-id");
      const d = others.find((x) => x.id === selectedId);
      if (d) document.getElementById("label").value = friendlyPersonName(d.name);
    };
  });
  document.getElementById("save")?.addEventListener("click", async () => {
    const selected = others.find((x) => x.id === selectedId);
    await api(`/api/households/${hh.id}/allowlist`, {
      method: "POST",
      body: JSON.stringify({
        targetLineId: selectedId,
        label:
          document.getElementById("label").value.trim() ||
          friendlyPersonName(selected?.name) ||
          "Friend",
        alwaysAllow: Boolean(document.getElementById("vip")?.checked),
      }),
    });
    setFlash(`Approved ${document.getElementById("label").value.trim() || "them"} — ask them to approve you too`, "ok");
    state.screen = "manage-contacts";
    await refresh();
  });
}

function renderManageContacts() {
  const hh = state.households[0];
  // Approve UI is for external contacts only — household siblings are always dialable.
  const contacts = externalAllowlist(hh);
  const pending = pendingApprovals(hh);
  const editing = contacts.find((c) => c.id === state.editContactId);
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back">←</button>
      <div class="mark">Approve callers</div>
      <span style="width:40px"></span>
    </div>
    <div class="sheet tip-sheet">
      <h2>Two yeses to call</h2>
      <p><strong>You approve them</strong> → your kids can dial their name.<br/>
      <strong>They approve you</strong> → status becomes <em>Ready to call</em>.</p>
    </div>
    ${
      pending.length
        ? `<div class="sheet">
        <h2>Needs your approval</h2>
        <p>These families joined — tap Approve to put them on your kids’ phone.</p>
        <div class="manage-list">${pending
          .map(
            (d, idx) => `
          <div class="manage-row" style="--i:${Math.min(idx, 10)}">
            ${avatarHtml(friendlyPersonName(d.name), d.id, "md")}
            <div>
              <strong>${friendlyPersonName(d.name)}</strong>
              <small>${d.household_name}</small>
            </div>
            <div class="btn-row tight approve-row">
              <button type="button" class="primary compact" data-approve="${d.id}" data-name="${friendlyPersonName(d.name).replace(/"/g, "&quot;")}">Approve</button>
              <button type="button" class="ghost compact" data-decline="${d.id}" data-name="${friendlyPersonName(d.name).replace(/"/g, "&quot;")}">Decline</button>
            </div>
          </div>`
          )
          .join("")}</div>
      </div>`
        : ""
    }
    <div class="sheet" style="margin-top:12px">
      <h2>On your phone</h2>
      <p>Rename, assign speed dial 1–9, VIP, or remove. (No Move buttons on the pad — hold to drag, or set the slot here.)</p>
      <button class="ghost" id="add-new" style="margin-bottom:14px;width:100%">Approve someone else…</button>
      ${
        contacts.length
          ? `<div class="manage-list">${contacts
              .map((c, idx) => {
                const st = approvalStatus(c);
                return `
            <div class="manage-row" style="--i:${Math.min(idx, 10)}">
              ${avatarHtml(contactDisplayName(c), c.target_line_id, "md")}
              <div>
                <strong>${contactDisplayName(c)}</strong>
                <small>${c.speed_dial ? `Dial ${c.speed_dial} · ` : ""}${st.label}${c.always_allow ? " · VIP" : ""}</small>
              </div>
              <button type="button" class="ghost compact" data-edit="${c.id}">Edit</button>
            </div>`;
              })
              .join("")}</div>`
          : `<div class="empty">${
              pending.length
                ? "Approve someone above to put them on speed dial."
                : canInviteFamily()
                  ? "Invite a family first, then approve them here."
                  : "Ask a parent to add family contacts."
            }</div>`
      }
    </div>
    ${
      editing
        ? `<div class="sheet-modal" id="edit-contact-modal">
        <div class="sheet-modal-card" role="dialog" aria-labelledby="edit-contact-title">
          <h2 id="edit-contact-title">Edit ${contactDisplayName(editing)}</h2>
          <label>Name kids see</label>
          <input id="edit-label" value="${contactDisplayName(editing).replace(/"/g, "&quot;")}" />
          <label>Speed dial (1–9, blank = none)</label>
          <input id="edit-dial" type="number" min="1" max="9" inputmode="numeric" value="${editing.speed_dial ?? ""}" aria-describedby="edit-dial-hint" />
          <p class="tiny" id="edit-dial-hint">Accessible rearrange: set the slot number here. On the home pad, hold then drag.</p>
          <label class="check-row"><input type="checkbox" id="edit-vip" ${editing.always_allow ? "checked" : ""} /> VIP — rings through Quiet Time</label>
          <div class="btn-row two">
            <button class="primary btn-block" id="save-edit">Save</button>
            <button class="ghost btn-block" id="cancel-edit">Cancel</button>
          </div>
          <button class="danger btn-block" id="remove-contact" style="margin-top:10px">Remove</button>
        </div>
      </div>`
        : ""
    }
  `;
  document.getElementById("back").onclick = () => {
    state.editContactId = null;
    state.screen = "home";
    state.nav = "phone";
    render();
  };
  document.getElementById("add-new").onclick = () => {
    state.editContactId = null;
    state.screen = "add-contact";
    render();
  };
  document.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.onclick = async () => {
      const targetLineId = btn.getAttribute("data-approve");
      const label = btn.getAttribute("data-name") || "Friend";
      await api(`/api/households/${hh.id}/allowlist`, {
        method: "POST",
        body: JSON.stringify({ targetLineId, label }),
      });
      setFlash(`Approved ${label} — ask them to approve you too`, "ok");
      await refresh();
    };
  });
  document.querySelectorAll("[data-decline]").forEach((btn) => {
    btn.onclick = async () => {
      const targetLineId = btn.getAttribute("data-decline");
      const label = btn.getAttribute("data-name") || "them";
      try {
        await api(`/api/households/${hh.id}/allowlist/decline`, {
          method: "POST",
          body: JSON.stringify({ targetLineId }),
        });
        setFlash(`Declined ${label} — they won’t show under Needs approval`, "ok");
        await refresh();
      } catch (e) {
        setFlash(e.message || "Could not decline", "error");
        render();
      }
    };
  });
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.onclick = () => {
      state.editContactId = btn.getAttribute("data-edit");
      render();
    };
  });
  document.getElementById("cancel-edit")?.addEventListener("click", () => {
    state.editContactId = null;
    render();
  });
  document.getElementById("edit-contact-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "edit-contact-modal") {
      state.editContactId = null;
      render();
    }
  });
  document.getElementById("save-edit")?.addEventListener("click", async () => {
    const dialRaw = document.getElementById("edit-dial").value.trim();
    const speed_dial = dialRaw === "" ? null : Number(dialRaw);
    await api(`/api/households/${hh.id}/allowlist/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        label: document.getElementById("edit-label").value.trim(),
        speed_dial,
        always_allow: Boolean(document.getElementById("edit-vip").checked),
      }),
    });
    setFlash("Contact updated", "ok");
    state.editContactId = null;
    await refresh();
  });
  document.getElementById("remove-contact")?.addEventListener("click", async () => {
    if (!confirm(`Remove ${contactDisplayName(editing)}? Kids won’t be able to call them.`)) return;
    await api(`/api/households/${hh.id}/allowlist/${editing.id}`, { method: "DELETE" });
    setFlash("Removed — they can no longer be dialed from this phone", "ok");
    state.editContactId = null;
    await refresh();
  });
}

function renderLeaveMessage() {
  const hh = state.households[0];
  const toLineId = state.leaveFor?.toLineId;
  const contact = (hh?.allowlist || []).find((c) => c.target_line_id === toLineId);
  const name = contact ? contactDisplayName(contact) : friendlyPersonName(lineName(toLineId));
  let recorder = null;
  let chunks = [];
  let mime = "audio/webm";
  let timer = null;
  let seconds = 0;
  let stream = null;
  /** greeting | recording | ending */
  let phase = "greeting";
  let finishing = false;

  app.innerHTML = `
    <div class="leave-vm-screen">
      <div class="topbar">
        <button class="icon-btn" id="back" aria-label="Hang up">←</button>
        ${pageBrandHtml("Answering machine")}
        <span style="width:40px"></span>
      </div>
      <div class="leave-vm-body">
        <h2>${name}</h2>
        <p>${state.leaveFor?.hint || "No answer — leave a message after the beep."}</p>
        <p class="vm-rec-status" id="vm-status">Playing greeting…</p>
      </div>
      <div class="call-actions outbound">
        ${hangupButtonHtml("vm-hangup")}
      </div>
    </div>
  `;

  const statusEl = () => document.getElementById("vm-status");

  const cleanupStream = () => {
    if (timer) clearInterval(timer);
    timer = null;
    releaseRecorderMicRef(stream);
    stream = null;
  };

  const exitHome = () => {
    cleanupStream();
    try {
      recorder?.stop();
    } catch {}
    recorder = null;
    state.leaveFor = null;
    state.screen = "home";
    render();
  };

  const stopToBlob = () =>
    new Promise((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        cleanupStream();
        resolve(null);
        return;
      }
      const rec = recorder;
      rec.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mime });
        cleanupStream();
        recorder = null;
        resolve(blob);
      };
      try {
        rec.stop();
      } catch {
        cleanupStream();
        recorder = null;
        resolve(null);
      }
    });

  const saveIfSpoke = async (blob) => {
    if (!blob || blob.size < 64 || seconds < 1) return false;
    const dataUrl = await blobToBase64(blob);
    await api("/api/voicemails", {
      method: "POST",
      body: JSON.stringify({
        fromLineId: state.activeLineId,
        toLineId,
        audioBase64: dataUrl,
        audioMime: mime,
      }),
    });
    setFlash(`Message left for ${name}`, "ok");
    return true;
  };

  const finish = async ({ save } = { save: true }) => {
    if (finishing) return;
    finishing = true;
    const wasRecording = phase === "recording";
    phase = "ending";
    // Notify peer, then hard-silence local speakers — caller must not hear the take.
    stopVmMonitor({ notifyPeer: true });
    silenceCallerSoftphoneAudio();
    if (wasRecording && save) {
      if (statusEl()) statusEl().textContent = "Saving…";
      try {
        const blob = await stopToBlob();
        await saveIfSpoke(blob);
      } catch (e) {
        setFlash(e.message || "Could not leave message", "error");
      }
    } else {
      cleanupStream();
      try {
        recorder?.stop();
      } catch {}
      recorder = null;
    }
    silenceCallerSoftphoneAudio();
    exitHome();
  };

  const startRecording = async () => {
    if (finishing || phase === "ending") return;
    try {
      // Call path already unlocked AudioContext; re-assert before mic/tones.
      await unlockAudioCtx();
      stream = await ensureMicStream();
      armMicForCall();
      if (finishing) {
        releaseRecorderMicRef(stream);
        stream = null;
        return;
      }
      chunks = [];
      mime = pickRecorderMime();
      recorder = new MediaRecorder(stream, { mimeType: mime });
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data);
      };
      seconds = 0;
      phase = "recording";
      if (statusEl()) statusEl().textContent = "Recording… 0s";
      recorder.start();
      // Opt-in answering machine: stream live to recipient softphone if they enabled it.
      void startVmMonitorAsCaller(toLineId, stream);
      timer = setInterval(() => {
        if (finishing) return;
        seconds += 1;
        const left = VM_MAX_SECONDS - seconds;
        if (statusEl()) {
          statusEl().textContent =
            left <= 5
              ? `Recording… ${seconds}s — wrapping up`
              : `Recording… ${seconds}s`;
        }
        if (seconds >= VM_MAX_SECONDS) {
          void finish({ save: true });
        }
      }, 1000);
    } catch (e) {
      if (statusEl()) statusEl().textContent = e.message || "Mic unavailable — hang up to leave";
    }
  };

  document.getElementById("back").onclick = () => void finish({ save: true });
  document.getElementById("vm-hangup").onclick = () => void finish({ save: true });

  // Auto: greeting → beep → record (Web Audio unlock from prior call gesture).
  // Custom and default both get the same post-OGM beep; hang up mid-greeting skips beep/record.
  const vmCancelled = () => finishing || phase === "ending";
  (async () => {
    if (statusEl()) statusEl().textContent = "Playing greeting…";
    await unlockAudioCtx();
    try {
      await playLineGreetingThenBeep(toLineId, { isCancelled: vmCancelled });
    } catch {
      /* still cue + record if greeting/autoplay failed (unless hung up) */
      if (!vmCancelled()) {
        try {
          await playVmRecordBeep();
        } catch {}
      }
    }
    if (vmCancelled()) return;
    await startRecording();
  })();
}


function renderSettings() {
  // Settings deep-link opens focused line profile (Parent stays in the dock).
  openProfilePanel();
}


function render() {
  syncPhoneRoleChrome();
  if (state.nav === "controls") captureAtaFormDraftFromDom();
  if (!(state.screen === "home" && (!state.nav || state.nav === "phone"))) {
    state.speedDialEditing = false;
  }
  if (state.screen === "splash") renderSplash();
  else if (state.screen === "tutorial") renderTutorial();
  else if (state.screen === "setup") renderSetupChecklist();
  else if (state.screen === "welcome") renderWelcome();
  else if (state.screen === "returning") renderReturning();
  else if (state.screen === "register") renderRegister();
  else if (state.screen === "set-password") renderSetPassword();
  else if (state.screen === "host") renderHost();
  else if (state.screen === "join") renderJoin();
  else if (!state.user) renderWelcome();
  else if (state.screen === "invite") renderInvite();
  else if (state.screen === "add-contact") renderAddContact();
  else if (state.screen === "manage-contacts") renderManageContacts();
  else if (state.screen === "leave-message") renderLeaveMessage();
  else if (state.screen === "quiet") renderQuietHours();
  else if (state.screen === "profile") renderProfile();
  else if (state.screen === "settings") renderSettings();
  else renderHome();
  syncPhoneHomeLock();
  paintToast();
  paintCallLayer();
}

/** Capacitor + CallKit (iOS). No-op in Safari/PWA. */
function nativeCallKit() {
  try {
    return window.Capacitor?.Plugins?.PhoneHomeCallKit || null;
  } catch {
    return null;
  }
}

function isNativeIosShell() {
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.() && window.Capacitor?.getPlatform?.() === "ios");
  } catch {
    return false;
  }
}

let iosCallKitReady = false;

async function bootIosCallKit() {
  const kit = nativeCallKit();
  if (!kit || !isNativeIosShell() || iosCallKitReady) return;
  iosCallKitReady = true;
  try {
    await kit.addListener("voipToken", async (ev) => {
      const token = String(ev?.token || "");
      if (!token || !state.activeLineId || !state.sessionId) return;
      try {
        await api("/api/devices/voip-token", {
          method: "POST",
          body: JSON.stringify({ lineId: state.activeLineId, voipToken: token, platform: "ios" }),
        });
        console.info("[ios] VoIP token registered");
      } catch (e) {
        console.warn("[ios] VoIP token register failed", e);
      }
    });
    await kit.addListener("incomingPush", async (ev) => {
      // CallKit UI already shown by native; ensure WS is up for SDP.
      state.wsReplaced = false;
      ensureWs();
      if (ev?.callId && ev?.callerName) {
        // Offer may arrive via welcome pending; keep callId for answer path.
        state.pendingNativeCallId = String(ev.callId);
      }
    });
    await kit.addListener("callAnswered", async () => {
      ensureWs();
      if (state.call?.status === "incoming") {
        await acceptCall();
      } else if (state.activeLineId) {
        // Race: push before WS offer — pull pending SDP.
        try {
          const body = await api(`/api/calls/pending?lineId=${encodeURIComponent(state.activeLineId)}`);
          if (body?.offer?.sdp) {
            await onIncomingOffer({
              type: "call.offer",
              callId: body.offer.callId,
              fromLineId: body.offer.fromLineId,
              toLineId: body.offer.toLineId,
              sdp: body.offer.sdp,
            });
            await acceptCall();
          }
        } catch (e) {
          console.warn("[ios] pending offer after answer failed", e);
        }
      }
      try {
        await kit.setConnected({ callId: state.call?.callId || state.pendingNativeCallId });
      } catch {}
    });
    await kit.addListener("callEnded", () => {
      if (state.call) hangup();
    });
    await kit.registerVoIP();
    console.info("[ios] CallKit / PushKit armed");
  } catch (e) {
    console.warn("[ios] CallKit boot failed", e);
    iosCallKitReady = false;
  }
}

async function boot() {
  await ensurePublicHttps();
  initSpecularTilt();
  if (state.sessionId) {
    try {
      await refresh();
      void bootIosCallKit();
      return;
    } catch {
      state.sessionId = "";
      localStorage.removeItem("kl_session");
      localStorage.removeItem("kl_line");
    }
  }
  const invite = new URLSearchParams(location.search).get("invite");
  const guardianCode = new URLSearchParams(location.search).get("guardian");
  // Invite deep-links skip splash but still offer tutorial if never seen
  if (invite) {
    state.mode = "join";
    if (localStorage.getItem(TUTORIAL_KEY) === "1") {
      state.screen = "join";
    } else {
      state.tutorialIndex = 0;
      state.screen = "tutorial";
    }
  } else if (guardianCode && state.sessionId) {
    state.pendingGuardianCode = guardianCode;
    state.screen = "home";
    state.nav = "controls";
    localStorage.setItem("kl_nav", "controls");
  } else if (guardianCode) {
    state.pendingGuardianCode = guardianCode;
    state.screen = "login";
  } else {
    state.screen = "splash";
  }
  render();
  if (state.pendingGuardianCode && state.sessionId) {
    try {
      await api("/api/guardian-invites/redeem", {
        method: "POST",
        body: JSON.stringify({ code: state.pendingGuardianCode }),
      });
      setFlash("You’re now a guardian of that child line", "ok");
      state.pendingGuardianCode = "";
      history.replaceState({}, "", location.pathname);
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not accept guardian invite", "error");
      render();
    }
  }
}

boot();
bindPullToRefresh();
