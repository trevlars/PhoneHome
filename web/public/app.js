import { toSvg } from "./vendor/better-qr.js";

const app = document.getElementById("app");

const TUTORIAL_KEY = "kl_tutorial_v9";
/** Set only when the last How it works slide is finished (this install). */
const HOW_IT_WORKS_INSTALL_KEY = "kl_how_it_works_install_v1";
/** Dismiss only — step done/todo always comes from server household state. */
const SETUP_DISMISS_KEY = "kl_setup_dismissed_v1";
/** Parent dismissed the Analog Phone “what is an adapter?” intro. */
const ATA_INTRO_KEY = "ph_ata_intro_dismissed";
/** Device-local UI skin — modern (default) + retro skins. */
const UI_THEME_KEY = "kl_ui_theme";
/** Picker order: default → analog-90s / Frutiger Aero / childhood objects (first 6 show in setup + tutorial), then house + Y2K, then era fits, then internet-kid identity, then deep cuts. */
const UI_THEMES = [
  { id: "modern", label: "Modern", detail: "Soft spatial dark — default" },
  { id: "retro90s", label: "90s Tech", detail: "atomic purple · clear plastic" },
  { id: "aero2000s", label: "Aero", detail: "2000s glass · sky gloss" },
  { id: "tunes2000s", label: "Tunes", detail: "brushed metal · gel blue" },
  { id: "gba2000s", label: "PocketGame", detail: "pocket LCD · monster RPG menus" },
  { id: "cartoon2000s", label: "Cartoon Pop", detail: "chunky toon · candy UI" },
  { id: "millennialGray", label: "Millennial", detail: "greige walls · matte black" },
  { id: "xenon2000s", label: "Xenon", detail: "Y2K space station · neon future" },
  { id: "wood70s", label: "Wood Panel", detail: "70s–80s walnut · brass" },
  { id: "bit1632", label: "32-Bit", detail: "Console menus · readable body" },
  { id: "windbreaker80s", label: "Windbreaker", detail: "80s nylon · teal · purple V" },
  { id: "dad80s", label: "80s Dad", detail: "denim · polo · dad sneakers" },
  { id: "tomspace", label: "TomSpace", detail: "glitter profile · top friends chaos" },
  { id: "emo2000s", label: "Emo", detail: "checkers · studs · scene black" },
  { id: "baja", label: "Baja", detail: "neon teal · electric lime" },
  { id: "flat2013", label: "Flat", detail: "2013 flat · hairline blue" },
  { id: "craigslist", label: "Craig", detail: "classifieds HTML · link blue" },
  { id: "backrooms", label: "Backrooms", detail: "yellow rooms · damp carpet" },
  { id: "coaster", label: "Coaster", detail: "park UI · Win95 bevel" },
  { id: "dos80s", label: "DOS", detail: "Soft CRT green · amber focus" },
  { id: "highContrast", label: "High Contrast", detail: "ADA · black on white · clear edges" },
  { id: "highContrastDark", label: "High Contrast Dark", detail: "ADA · white on black · easier on eyes" },
];
/**
 * Grandparent account picker only — calm, high-readability looks for older adults.
 * Full Parent Themes list stays unchanged.
 */
const UI_THEME_IDS_GRANDPARENT = [
  "modern",
  "wood70s",
  "flat2013",
  "highContrast",
  "highContrastDark",
];
const UI_THEME_IDS = new Set(UI_THEMES.map((t) => t.id));
const UI_THEME_META = Object.fromEntries(UI_THEMES.map((t) => [t.id, t]));
const UI_THEME_COLORS = {
  modern: "#0e1a15",
  retro90s: "#4a2080",
  wood70s: "#2a1810",
  dos80s: "#000000",
  bit1632: "#1a1030",
  aero2000s: "#3a8fc4",
  windbreaker80s: "#0a5c4f",
  millennialGray: "#9a968f",
  tunes2000s: "#6e7580",
  xenon2000s: "#c44dff",
  gba2000s: "#2d6b2d",
  dad80s: "#3a5a8c",
  emo2000s: "#1a0a12",
  tomspace: "#ff00aa",
  craigslist: "#eee8ee",
  flat2013: "#007aff",
  backrooms: "#c4b45a",
  cartoon2000s: "#3d9bfd",
  coaster: "#000080",
  baja: "#00b2a9",
  highContrast: "#ffffff",
  highContrastDark: "#000000",
};
const ATA_SHOP_AMAZON = "https://www.amazon.com/s?k=Grandstream+HT801+v2";
const ATA_SHOP_EBAY = "https://www.ebay.com/sch/i.html?_nkw=Grandstream+HT801+v2";

const TUTORIAL_SLIDES = [
  {
    id: "brand",
    kicker: "PhoneHome",
    title: "The home phone, reborn",
    body: "A phone for your people — no feeds, no strangers. App or a house phone. You choose who can call.",
  },
  {
    id: "phone",
    kicker: "How you call",
    title: "Tap a face, or pick up",
    body: "In the app, tap someone to ring them. Or plug any regular phone into a small adapter. Same family either way.",
  },
  {
    id: "circles",
    kicker: "Who they can call",
    title: "Kids only see who you add",
    body: "You invite grandma, cousins, a co-parent. Nothing else shows on their phone. Both families have to say yes.",
  },
  {
    id: "invite",
    kicker: "How they join",
    title: "Scan together, or text a link",
    body: "Sit side by side and scan, or send the link. No long web address to type.",
  },
  {
    id: "treehouse",
    kicker: "TreeHouse",
    title: "A hangout — not a secret",
    body: "Kids tap TreeHouse to talk together. You choose who they hear. If you listen, the room hears that a parent is listening.",
  },
  {
    id: "safety",
    kicker: "Parent tools",
    title: "Private calls. You're in control.",
    body: "Calls are encrypted. We help set them up; we don't listen or keep what was said. Quiet Time, PIN, and Timeout stay yours.",
  },
  {
    id: "themes",
    kicker: "Themes",
    title: "Dress the phone how you like",
    body: "Modern is fine. Or try 90s Tech, Aero, Tunes — whatever fits the house. Change anytime in Parent → Themes.",
    beta: true,
  },
  {
    id: "next",
    kicker: "Next",
    title: "Three things, then you can call",
    body: "Sign in, add your kid, invite one person. Finish setup is there if you want the rest later.",
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
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    /** @type {Navigator & { standalone?: boolean }} */ (navigator).standalone === true
  );
}

function isNativeAppShell() {
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** PWA home-screen icon or native Capacitor shell — not a Safari/Chrome tab. */
function isInstalledPhoneHome() {
  return isPhoneHomeStandalone() || isNativeAppShell();
}

function hasCompletedHowItWorksInstall() {
  try {
    return localStorage.getItem(HOW_IT_WORKS_INSTALL_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * First launch of this native app / installed PWA that has not finished How it works.
 * Existing WebView installs that already set TUTORIAL_KEY are not re-trapped.
 */
function mustCompleteHowItWorks() {
  if (!isInstalledPhoneHome()) return false;
  if (hasCompletedHowItWorksInstall()) return false;
  try {
    if (localStorage.getItem(TUTORIAL_KEY) === "1") return false;
  } catch {
    /* ignore */
  }
  return true;
}

/** Forced first-install run — not Help / welcome replay. */
function isForcedHowItWorksRun() {
  return mustCompleteHowItWorks() && !state.tutorialFromSettings;
}

function startForcedHowItWorks({ fromSplash = false } = {}) {
  state.tutorialFromSettings = false;
  state.tutorialIndex = fromSplash ? 1 : 0;
  state.tutorialFarthest = state.tutorialIndex;
  state.screen = "tutorial";
}

const LAST_USERNAME_KEY = "kl_username";
/** One Face ID auto-prompt per WebView lifetime (avoid re-prompt loops on error). */
let faceIdAutoTried = false;

/** Native Capacitor plugin (CallKit + Keychain). Remote WebView talks via jsName. */
function nativePlugin() {
  try {
    const plugins = window.Capacitor?.Plugins;
    if (plugins?.PhoneHomeCallKit) return plugins.PhoneHomeCallKit;
  } catch {
    /* ignore */
  }
  try {
    return window.Capacitor?.registerPlugin?.("PhoneHomeCallKit") || null;
  } catch {
    return null;
  }
}

async function nativePluginReady(ms = 1200) {
  const start = Date.now();
  let plugin = nativePlugin();
  while (!plugin?.saveLogin && !plugin?.hasSavedLogin && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 50));
    plugin = nativePlugin();
  }
  return plugin;
}

function lastUsername() {
  try {
    return localStorage.getItem(LAST_USERNAME_KEY) || "";
  } catch {
    return "";
  }
}

function rememberUsername(username) {
  const u = String(username || "").trim();
  try {
    if (u) localStorage.setItem(LAST_USERNAME_KEY, u);
    else localStorage.removeItem(LAST_USERNAME_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

async function persistSession(sessionId) {
  state.sessionId = sessionId || "";
  try {
    if (sessionId) localStorage.setItem("kl_session", sessionId);
    else localStorage.removeItem("kl_session");
  } catch {
    /* ignore */
  }
  const plugin = nativePlugin();
  try {
    if (!plugin) return;
    if (sessionId) await plugin.saveSession?.({ sessionId });
    else await plugin.clearSession?.();
  } catch {
    /* Keychain optional until the iOS shell is rebuilt */
  }
}

async function persistPasswordLogin(username, password) {
  rememberUsername(username);
  const plugin = await nativePluginReady();
  if (!plugin?.saveLogin) {
    console.warn("[ios] saveLogin missing — rebuild the PhoneHome app for Face ID");
    return false;
  }
  const user = String(username || "").trim();
  const pass = String(password || "");
  if (!user || !pass) return false;
  try {
    const out = await plugin.saveLogin({ username: user, password: pass });
    if (out && out.saved === false) {
      console.warn("[ios] saveLogin returned saved:false");
      return false;
    }
    const check = await plugin.hasSavedLogin?.();
    if (check && check.saved === false) {
      console.warn("[ios] Keychain has no password after saveLogin");
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[ios] saveLogin failed", e);
    return false;
  }
}

async function clearPersistedAuth({ keepLogin = false } = {}) {
  await persistSession("");
  if (keepLogin) return;
  rememberUsername("");
  const plugin = nativePlugin();
  try {
    await plugin?.clearLogin?.();
  } catch {
    /* ignore */
  }
}

async function restoreNativeSession() {
  if (state.sessionId) {
    void persistSession(state.sessionId);
    return;
  }
  const plugin = nativePlugin();
  try {
    const out = await plugin?.getSession?.();
    const sid = String(out?.sessionId || "");
    if (sid) {
      state.sessionId = sid;
      try {
        localStorage.setItem("kl_session", sid);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function isUnauthorizedError(err) {
  return Number(err?.status) === 401;
}

document.documentElement.classList.toggle("ph-standalone", isPhoneHomeStandalone());

function getUiTheme() {
  const t = localStorage.getItem(UI_THEME_KEY) || "modern";
  return UI_THEME_IDS.has(t) ? t : "modern";
}

function uiThemeLabel(theme = getUiTheme()) {
  return UI_THEME_META[theme]?.label || "Modern";
}

function applyUiTheme(theme) {
  const t = UI_THEME_IDS.has(theme) ? theme : "modern";
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = UI_THEME_COLORS[t] || UI_THEME_COLORS.modern;
}

function setUiTheme(theme) {
  const t = UI_THEME_IDS.has(theme) ? theme : "modern";
  localStorage.setItem(UI_THEME_KEY, t);
  applyUiTheme(t);
  refreshAvatarPalettes();
}

applyUiTheme(getUiTheme());

/** Themes shown in a picker — full list, or age-friendly subset for grandparent accounts. */
function themesForPicker(opts = {}) {
  if (!opts.grandparent) return UI_THEMES;
  const curated = UI_THEME_IDS_GRANDPARENT.map((id) => UI_THEME_META[id]).filter(Boolean);
  const current = getUiTheme();
  if (!UI_THEME_IDS_GRANDPARENT.includes(current) && UI_THEME_META[current]) {
    return [...curated, UI_THEME_META[current]];
  }
  return curated;
}

/**
 * Theme picker.
 * Post-login: setup board (optional) + Parent → Themes + grandparent Settings.
 * How it works includes a tap-to-try slide. Splash stays brand-only.
 */
function uiThemeSelectorHtml(opts = {}) {
  const { bare = false, setup = false, grandparent = false } = opts;
  const current = getUiTheme();
  const themes = themesForPicker({ grandparent });
  const grid = `
      <div class="theme-grid${grandparent ? " gp-theme-grid" : ""}" role="group" aria-label="${
        grandparent ? "How it looks" : "Themes"
      }">
        ${themes
          .map(
            ({ id, label, detail }) =>
              `<button type="button" class="theme-opt ${current === id ? "on" : ""}" data-ui-theme="${id}" aria-pressed="${current === id}">
              <span class="theme-swatch theme-swatch-${id}" aria-hidden="true"></span>
              <strong>${label}</strong>
              <span>${detail}</span>
            </button>`
          )
          .join("")}
      </div>`;
  if (bare) return grid;
  let wrapCls = "parent-field ui-theme-field";
  let headTag = "h3";
  let headCls = "parent-subhead";
  let lede =
    "How PhoneHome looks on this device — pick a theme anytime.";
  let margin = ' style="margin-top:0;padding-top:0;border-top:0"';
  let title = "Themes";
  if (grandparent) title = "How it looks";
  if (setup) {
    wrapCls = "sheet control-card setup-card setup-theme";
    headTag = "p";
    headCls = "setup-theme-head";
    lede = grandparent
      ? "This phone only. Choose a look that’s easy to read."
      : "This phone only. Scroll the grid for more looks.";
    margin = "";
  }
  if (grandparent && !setup) {
    wrapCls = "sheet control-card is-open gp-settings-card gp-theme-card";
    headTag = "h2";
    headCls = "gp-card-title";
    lede = "Pick a look that’s easy to read on this phone. High Contrast (light or dark) is best if text is hard to see.";
    margin = "";
  }
  const n = themes.length;
  const headLabel = grandparent ? title : withBetaBadge(title);
  const head =
    setup
      ? `<div class="setup-theme-head-row">
          <${headTag} class="${headCls}${grandparent ? "" : " parent-subhead-with-badge"}">${headLabel}</${headTag}>
          <p class="setup-theme-count">${n} ${n === 1 ? "look" : grandparent ? "looks" : "themes"}</p>
        </div>`
      : grandparent
        ? `<${headTag} class="${headCls}">${headLabel}</${headTag}>`
        : `<${headTag} class="${headCls} parent-subhead-with-badge">${headLabel}</${headTag}>`;
  return `
    <div class="${wrapCls}"${margin}>
      ${head}
      <p class="tiny">${lede}</p>
      ${grid}
    </div>`;
}

/** Short path preview on splash — not the full parent checklist. */
function splashPathPreviewHtml() {
  const steps = ["How it works", "Sign in", "Finish family setup"];
  return `<ol class="splash-path" aria-label="What happens next">
    ${steps
      .map(
        (label, i) =>
          `<li${i === 0 ? ` class="is-now" aria-current="step"` : ""}><span class="splash-path-n">${i + 1}</span>${label}</li>`
      )
      .join("")}
  </ol>`;
}

function bindUiThemeSelector(scope = document, opts = {}) {
  const { onPick } = opts;
  scope.querySelectorAll("[data-ui-theme]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const theme = btn.getAttribute("data-ui-theme");
      setUiTheme(theme);
      scope.querySelectorAll("[data-ui-theme]").forEach((b) => {
        const on = b.getAttribute("data-ui-theme") === theme;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      const chip = document.getElementById("parent-themes-chip");
      if (chip) {
        const strong = chip.querySelector("strong");
        if (strong) strong.textContent = uiThemeLabel(theme);
        else chip.textContent = uiThemeLabel(theme);
      }
      if (typeof onPick === "function") onPick(theme);
    });
  });
}

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
      body: "Safari → Share → Add to Home Screen. Opening from that icon feels like an app and helps the microphone stay allowed.",
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
        ? "Tap Install to put PhoneHome on your home screen. Then open it from there."
        : "In Chrome, open the menu ⋮ and tap Install app or Add to Home screen. Then open PhoneHome from there.",
      platform,
      canQuickInstall,
    };
  }
  return {
    id: "install",
    kicker: "Home screen",
    title: "Add it like an app",
    body: "On iPhone: Safari → Share → Add to Home Screen. On Android: Chrome menu → Install app. Works best on a phone.",
    platform,
    canQuickInstall,
  };
}

function getTutorialSlides() {
  const slides = [...TUTORIAL_SLIDES];
  if (isInstalledPhoneHome()) return slides;
  // Browser-only home-screen tip — last beat before “Let’s go”.
  slides.push(installSlide());
  return slides;
}

/** TreeHouse mark for tutorial scene (same mask glyph as pad #1). */
function tutorialTreeHouseHouseHtml() {
  return `<span class="scene-fr-house" aria-hidden="true"></span>`;
}

const state = {
  sessionId: localStorage.getItem("kl_session") || "",
  user: null,
  households: [],
  directory: [],
  /** Mothership capacity from /api/me (Pods, lines, limits). */
  mothership: null,
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
  /** Line that put the call on hold (null when not held). Resume only for this line, or adult override of a kid. */
  holdByLineId: null,
  /** Loudspeaker on. In-app iOS WebRTC plays speaker by itself — do not native-route it. */
  speakerOn: true,
  /** User tapped Speaker / Earpiece — don't overwrite with the 1:1 default. */
  audioRouteUserSet: false,
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
  /**
   * Leave-a-message mount key (toLineId). Remounting restarts default-greeting.wav;
   * presence.call / refresh used to stack the OGM ~3× while nav stayed "phone".
   * @type {string|null}
   */
  leaveVmMountedKey: null,
  /** CallKit miss before call_logs refresh lands — counted in icon badge. */
  pendingNativeMissed: 0,
  /** Sticky ids from PushKit / getCallState before WS offer arrives (no secrets). */
  pendingNativeCallId: "",
  pendingNativeFromLineId: "",
  pendingNativeToLineId: "",
  /** After * / banner — Messages should start Play on mount. */
  autoPlayVm: false,
  /** Last outbound target for classic # redial (session). */
  lastRedialLineId: null,
  /** FamilyRoom # picker sheet is open (app). Analog still uses the voice menu. */
  familyRoomPicker: null,
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
   * From /api/health — whether this Mothership can one-tap push to an HT801 on LAN.
   * null = not loaded yet; false = remote/shared Mothership (use Download config).
   * Parent app being on Wi‑Fi is irrelevant — only Mothership↔ATA LAN matters.
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
  /** One-shot: grandparent Settings → Analog/Account via full Parent panel. */
  _forceFullParentSettings: false,
  /** First name just added — show next-step CTAs under Kids once. */
  kidJustAdded: "",
  /** Kid line id selected in Parent → Co-parents (invite/manage guardians). */
  coparentKidLineId: "",
  /** Open this Help article id once after jumping from Analog intro. */
  parentHelpFocus: "",
  /** Parent settings search query (session; survives re-render). */
  parentSearch: "",
  /** Expand custom hour editors in Quiet Time & limits. */
  parentHoursKidsCustom: false,
  parentHoursYouCustom: false,
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
  /** Farthest slide reached this run — first-install cannot jump ahead. */
  tutorialFarthest: 0,
  tutorialFromSettings: false,
  /** Open setup board even if previously dismissed (Help / Parent re-entry). */
  setupForceShow: false,
  gpSettingsFocus: null,
  leaveFor: null,
  editContactId: null,
  splashTimer: null,
  group: null,
  groupPeers: {},
  groupPick: [],
  /** Live TreeHouse occupancy (pad presence bubbles). */
  familyRoomPresence: { householdId: null, roomId: null, members: [], listeners: [], talkPairs: [] },
  /** Live FamilyRoom (# pad) occupancy. */
  adultFamilyRoomPresence: { householdId: null, roomId: null, members: [] },
  /** Parent listen-only session (mirrors a child’s filtered mix). */
  playRoomListen: null,
  pinModal: null,
  pendingGuardianCode: "",
  /** Last co-parent invite created in this session (code stays visible). */
  lastGuardianInvite: null,
  lastGrandparentSetup: null,
  /** Parent → Grandparents: which relative detail panel is open. */
  managingGrandparentId: "",
  /** Parent previewing a provisioned grandparent’s phone chrome (session only). */
  gpPreviewRelativeId: "",
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
const MAX_FAMILY_ROOM = 8;
const TREEHOUSE_SLOT = 0;
const ADMIN_PARENT_SLOT = 1;
const SECONDARY_PARENT_SLOT = 2;

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
    err.status = res.status;
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
        if (msg.type === "welcome") {
          // Backup to server WS push: CallKit may have answered before offer landed.
          if (callKitGate.answered || callKitGate.systemRinging || state.pendingNativeCallId) {
            void ensureIncomingOfferForCallKit().then((ok) => {
              if (callKitGate.answered) signalCallKitAccepted("welcome");
              if (ok && callKitGate.answered) void acceptCallFromCallKit();
            });
          }
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
  else if (msg.type === "call.fxs-up") onFxsUp(msg);
  else if (msg.type === "call.ice") await addRemoteIce(msg.candidate);
  else if (msg.type === "call.hangup") {
    if (state.group) return;
    // Already cleaned up locally (e.g. ring timeout → leave-message).
    if (!state.call) return;
    const reason = String(msg.reason || "");
    // Only real ring-timeout / no-answer → voicemail. Soft→ATA early answer keeps
    // status "ringing" until fxs-up; a bridge media failure must not look like miss.
    const outboundMiss =
      reason === "no-answer" &&
      (state.call.status === "calling" || state.call.status === "ringing") &&
      state.call.fromLineId === state.activeLineId;
    const inboundMiss =
      reason === "no-answer" && state.call.toLineId === state.activeLineId;
    const toLineId = state.call.toLineId;
    const failedWhileRinging =
      !outboundMiss &&
      (state.call.status === "calling" || state.call.status === "ringing") &&
      state.call.fromLineId === state.activeLineId &&
      reason &&
      reason !== "bridge-hangup";
    stopRing();
    stopDialTone();
    if (failedWhileRinging) {
      setFlash(/stasis|ata|offline|destroyed|failed/i.test(reason) ? "Couldn’t connect to the house phone — try again." : reason, "error");
    }
    endCallUi(outboundMiss ? "No answer" : "Call ended");
    if (outboundMiss && toLineId) {
      state.leaveFor = { toLineId, hint: "They didn’t pick up" };
      state.screen = "leave-message";
    }
    render();
    if (inboundMiss) {
      void refresh()
        .then(() => syncIosAppBadge())
        .catch(() => {});
    }
  } else if (msg.type === "call.hold") {
    // Soft or analog # hold — sync UI; only the holder clears local MOH on resume.
    if (!state.call || state.group) return;
    if (msg.callId && state.call.callId && msg.callId !== state.call.callId) return;
    const on = Boolean(msg.onHold);
    const wasHolder = Boolean(state.onHold && state.holdByLineId === state.activeLineId);
    const byLineId = String(msg.byLineId || "").trim() || otherLineId(state.call) || null;
    if (state.onHold === on && (!on || state.holdByLineId === byLineId)) {
      paintCallLayer();
      return;
    }
    state.onHold = on;
    state.holdByLineId = on ? byLineId : null;
    // Don't run applyHoldAudio when *entering* remote hold — that would inject a second hold track
    // and mute the held party's earpiece. When the holder is forced off (adult override), clear MOH.
    if (!on) {
      setOutboundMicEnabled(!state.muted);
      if (wasHolder) void applyHoldAudio();
    } else {
      setOutboundMicEnabled(false);
    }
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
    // Outbound CallKit: start system call UI once we have the server callId
    // (UUID is derived from callId — must match hangup/endCall).
    if (
      callKitOwnsUi() &&
      msg.callId &&
      state.call?.fromLineId === state.activeLineId
    ) {
      try {
        void nativeCallKit()?.startOutgoing?.({
          callId: String(msg.callId),
          handle: String(state.call.toLineId || lineName(state.call.toLineId) || "PhoneHome"),
        });
        callKitGate.answered = true;
        callKitGate.systemRinging = true;
      } catch (e) {
        console.warn("[ios] startOutgoing failed", e);
      }
    }
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
  } else if (
    msg.type === "familyroom.presence" ||
    msg.type === "playroom.presence" ||
    msg.type === "treehouse.presence"
  )
    onTreeHousePresence(msg);
  else if (
    msg.type === "familyroom.joined" ||
    msg.type === "playroom.joined" ||
    msg.type === "treehouse.joined"
  )
    await onTreeHouseJoined(msg);
  else if (
    msg.type === "familyroom.error" ||
    msg.type === "playroom.error" ||
    msg.type === "treehouse.error"
  ) {
    setFlash(msg.error || "TreeHouse failed", "error");
    leaveGroup(true);
    render();
  } else if (
    msg.type === "familyroom.announce" ||
    msg.type === "playroom.announce" ||
    msg.type === "treehouse.announce"
  ) {
    onTreeHouseAnnounce(msg);
  } else if (
    msg.type === "familyroom.listen.started" ||
    msg.type === "playroom.listen.started" ||
    msg.type === "treehouse.listen.started"
  ) {
    await onTreeHouseListenStarted(msg);
  } else if (
    msg.type === "familyroom.listen.stopped" ||
    msg.type === "playroom.listen.stopped" ||
    msg.type === "treehouse.listen.stopped"
  ) {
    onTreeHouseListenStopped(msg);
  } else if (msg.type === "adultfamily.presence") {
    onAdultFamilyRoomPresence(msg);
  } else if (msg.type === "adultfamily.joined") {
    await onAdultFamilyRoomJoined(msg);
  } else if (msg.type === "adultfamily.error") {
    setFlash(msg.error || "FamilyRoom failed", "error");
    leaveGroup(true);
    render();
  } else if (msg.type === "group.offer") await onGroupOffer(msg);
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
      // leave-message starts greeting audio on every renderLeaveMessage(); hangup/expire
      // fanout presence.call while nav is still "phone" and stacked the OGM ~3×.
      if (state.screen === "leave-message") return;
      // Incoming ring sheet: skip full home remount (paintCallLayer is also idempotent).
      if (state.call?.status === "incoming" || state.group?.status === "incoming") return;
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
  void syncIosAppBadge();
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

/** WebKit/Safari DOMException for wrong RTCPeerConnection signaling ops. */
function isInvalidStateError(e) {
  return (
    e?.name === "InvalidStateError" ||
    /invalid state/i.test(String(e?.message || e || ""))
  );
}

function isPcAlive(pc = state.pc) {
  if (!pc) return false;
  try {
    return pc.signalingState !== "closed" && pc.connectionState !== "closed";
  } catch {
    return false;
  }
}

/** User-facing call error; null = log-only (no cryptic InvalidStateError toast). */
function friendlyCallError(e, fallback = "Could not connect") {
  if (isInvalidStateError(e)) return null;
  const msg = String(e?.message || "").trim();
  if (!msg || /invalid state/i.test(msg)) return null;
  return msg || fallback;
}

/** Serialize acceptCall across CallKit retries, WS offer repush, and double-taps. */
let acceptCallInFlight = false;

function closeCurrentPc() {
  if (!state.pc) return;
  try {
    releaseMicForPc(state.pc);
  } catch {}
  try {
    state.pc.close();
  } catch {}
  state.pc = null;
  state.remoteReady = false;
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
  state.mothership = data.mothership || null;
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
  if (mustCompleteHowItWorks() && !state.tutorialFromSettings) {
    if (state.screen !== "tutorial") startForcedHowItWorks();
    else state.screen = "tutorial";
  } else if (!hh) state.screen = state.mode === "join" ? "join" : "host";
  else if (!hh.lines.length) state.screen = state.mode === "join" ? "join" : "host";
  else if (
    state.screen === "welcome" ||
    state.screen === "host" ||
    state.screen === "join" ||
    state.screen === "returning" ||
    state.screen === "register" ||
    state.screen === "set-password"
  ) {
    // After sign-in / create account — always land on Phone.
    state.screen = "home";
    state.nav = "phone";
    localStorage.setItem("kl_nav", "phone");
  } else if (state.screen === "boot") {
    state.screen = "home";
  } else if (state.screen === "setup" && !shouldShowSetupBoard(hh)) {
    state.screen = "home";
  }
  ensureWs();
  // Remounting leave-message restarts the OGM; keep recording UI stable across refresh.
  if (state.screen === "leave-message") {
    void syncIosAppBadge();
    return;
  }
  // Softphone ring sheet: keep #app frozen (same as render() guard).
  if (
    !callKitOwnsUi() &&
    (state.call?.status === "incoming" || state.group?.status === "incoming") &&
    document.getElementById("call-layer")
  ) {
    void syncIosAppBadge();
    paintCallLayer();
    return;
  }
  render();
  void syncIosAppBadge();
}

/** Pull-to-refresh on main app-shell surfaces (Home / Activity / Messages / Parent). */
const PTR_THRESHOLD = 148;
/** Ignore modest downward drift so side-scroll / scroll-up near the top doesn't arm PTR. */
const PTR_SLOP = 52;
/** Pixels of movement before we decide this is a vertical pull vs a sideways flick. */
const PTR_AXIS_LOCK = 18;
/** Vertical must dominate (~60° from horizontal: dy ≥ dx * ratio) before we treat it as PTR. */
const PTR_VERT_RATIO = 1.75;
const ptr = {
  tracking: false,
  startX: 0,
  startY: 0,
  pull: 0,
  refreshing: false,
  axis: "",
};

function isHorizontallyScrollable(el) {
  if (!(el instanceof HTMLElement)) return false;
  const ox = getComputedStyle(el).overflowX;
  if (ox !== "auto" && ox !== "scroll" && ox !== "overlay") return false;
  return el.scrollWidth > el.clientWidth + 1;
}

/** Chip rows / theme grids / any overflow-x scroller — never start PTR from these. */
function isPtrIgnoredStart(target) {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.documentElement) {
    if (el.classList?.contains("parent-jump") || el.classList?.contains("theme-grid")) {
      return true;
    }
    if (isHorizontallyScrollable(el)) return true;
    el = el.parentElement;
  }
  return false;
}

function ptrRoot() {
  return document.getElementById("ptr-root");
}

/**
 * Capacitor / iOS WebView often scrolls `body` (overflow-y: auto), not the window.
 * Checking only window.scrollY left PTR always-armed on Parent → scroll-up = reload.
 */
function pageScrollTop() {
  const se = document.scrollingElement;
  return Math.max(
    window.scrollY || 0,
    window.pageYOffset || 0,
    document.documentElement?.scrollTop || 0,
    document.body?.scrollTop || 0,
    se?.scrollTop || 0
  );
}

/** True when the page and any nested vertical scroller under the touch are at top. */
function isPullRefreshScrollTop(target) {
  if (pageScrollTop() > 2) return false;
  let el = target instanceof Element ? target : null;
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLElement) {
      const oy = getComputedStyle(el).overflowY;
      if (
        (oy === "auto" || oy === "scroll" || oy === "overlay") &&
        el.scrollHeight > el.clientHeight + 1 &&
        el.scrollTop > 2
      ) {
        return false;
      }
    }
    el = el.parentElement;
  }
  return true;
}

function canPullToRefresh(target) {
  if (ptr.refreshing) return false;
  if (!state.sessionId || !state.user) return false;
  if (state.call || state.group) return false;
  if (state.screen === "leave-message") return false;
  if (state.greetingRecording) return false;
  if (state.screen === "splash" || state.screen === "tutorial" || state.screen === "setup") return false;
  if (!document.querySelector(".app-shell")) return false;
  if (!isPullRefreshScrollTop(target)) return false;
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

  const abortPtr = () => {
    ptr.tracking = false;
    ptr.pull = 0;
    ptr.axis = "";
    paintPtr(0);
  };

  const onStart = (x, y, target) => {
    if (!canPullToRefresh(target) || isPtrIgnoredStart(target)) {
      ptr.tracking = false;
      ptr.axis = "";
      return;
    }
    ptr.tracking = true;
    ptr.startX = x;
    ptr.startY = y;
    ptr.pull = 0;
    ptr.axis = "";
  };

  const onMove = (x, y, e) => {
    if (!ptr.tracking || ptr.refreshing || ptr.axis === "ignore") return;
    const dx = Math.abs(x - ptr.startX);
    const dy = y - ptr.startY;

    if (ptr.axis !== "vert") {
      const absDy = Math.abs(dy);
      if (dx < PTR_AXIS_LOCK && absDy < PTR_AXIS_LOCK) return;
      // Sideways / diagonal flick — leave the gesture to overflow-x scrollers.
      if (dy <= 0 || dx * PTR_VERT_RATIO >= absDy) {
        ptr.axis = "ignore";
        abortPtr();
        return;
      }
      ptr.axis = "vert";
    }

    // If the page scrolled away from top mid-gesture, this is scroll-up — not PTR.
    if (!isPullRefreshScrollTop(e?.target) && ptr.pull < PTR_SLOP) {
      abortPtr();
      return;
    }
    if (!canPullToRefresh(e?.target) && ptr.pull <= 0) {
      abortPtr();
      return;
    }
    if (dy <= PTR_SLOP) {
      ptr.pull = 0;
      paintPtr(0);
      return;
    }
    const effective = dy - PTR_SLOP;
    // Resist after threshold so the gesture feels springy, not infinite.
    ptr.pull =
      effective < PTR_THRESHOLD ? effective : PTR_THRESHOLD + (effective - PTR_THRESHOLD) * 0.28;
    paintPtr(ptr.pull);
    // Only steal the gesture once we're clearly pulling vertically at true top.
    if (ptr.axis === "vert" && ptr.pull > 16 && isPullRefreshScrollTop(e?.target) && e?.cancelable) {
      e.preventDefault();
    }
  };

  const onEnd = () => {
    if (!ptr.tracking) return;
    const shouldRefresh =
      ptr.axis === "vert" && ptr.pull >= PTR_THRESHOLD && !ptr.refreshing && pageScrollTop() <= 2;
    ptr.tracking = false;
    ptr.axis = "";
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
      onStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
    },
    { passive: true }
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!ptr.tracking || e.touches.length !== 1) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY, e);
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
  if (!isPcAlive() || !state.remoteReady) {
    if (candidate) state.pendingIce.push(candidate);
    return;
  }
  try {
    await state.pc.addIceCandidate(candidate ? new RTCIceCandidate(candidate) : null);
  } catch (e) {
    if (!isInvalidStateError(e)) console.warn("[ice] add failed", e);
  }
}

async function flushIce() {
  if (!isPcAlive()) {
    state.remoteReady = false;
    return;
  }
  state.remoteReady = true;
  const queued = state.pendingIce.splice(0);
  for (const c of queued) {
    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      if (!isInvalidStateError(e)) console.warn("[ice] flush failed", e);
    }
  }
}

/** Embed host/srflx/relay in SDP when peer may be offline (CallKit wake). */
function waitIceGatheringComplete(pc, ms = 2500) {
  if (!pc || pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      try {
        pc.removeEventListener("icegatheringstatechange", onChange);
      } catch {}
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const t = setTimeout(done, ms);
    try {
      pc.addEventListener("icegatheringstatechange", onChange);
    } catch {
      done();
    }
  });
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
        ? "Couldn’t connect — network may need TURN (relay). Try again on Wi‑Fi or cellular, or ask whoever runs the Mothership to check TURN."
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
      if (isNativeIosShell()) {
        throw new Error(
          "Microphone blocked — open Settings → PhoneHome → Microphone, turn it off and on, then try again."
        );
      }
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

/** Live+enabled+unmuted — Cap CallKit can expose live/enabled tracks that stay muted (silence). */
function micTrackSendingOk(t) {
  return Boolean(t && t.kind === "audio" && t.readyState === "live" && t.enabled !== false && !t.muted);
}

function micStreamSendingOk(stream) {
  if (!stream) return false;
  return (stream.getAudioTracks() || []).some(micTrackSendingOk);
}

function pcHasSendingMic(pc) {
  return (pc?.getSenders?.() || []).some((s) => micTrackSendingOk(s.track));
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
      if (stream !== state.localStream) return;
      // Dead master — clear so the next call re-acquires cleanly.
      hardReleaseMicStream();
    });
    t.addEventListener("mute", () => {
      console.warn("[mic] master track muted by system", t.id);
      if (stream !== state.localStream) return;
      // Cap iOS: system mute of an idle master often means TCC/session death.
      // Keep stream during CallKit / live call (transient mute is normal).
      if (isNativeIosShell() && typeof callKitHoldsMic === "function" && callKitHoldsMic()) {
        return;
      }
      if (isNativeIosShell() && !callKitGate.answered) {
        hardReleaseMicStream();
      } else if (!micStreamUsable(state.localStream)) {
        hardReleaseMicStream();
      }
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
 * CallKit lock-screen: gum can hang forever — race a timeout and let accept proceed
 * with a null-track sendrecv m-line so call.answer (and ATA ringback stop) is not blocked.
 * Late gum must replaceTrack on that same sender (see attachLocalMicToPc).
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
  const gumPromise = acquireMic();
  const callKitHot =
    callKitOwnsUi() && (callKitGate.answered || callKitGate.systemRinging);
  // Real didActivate: give gum longer. Forced audioActive (cold lock-screen): keep short.
  const gumMs = callKitHot && callKitGate.audioActive && !callKitGate.forcedAudio ? 8000 : 4500;
  try {
    state.localStream = callKitHot
      ? await Promise.race([
          gumPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("mic-timeout-callkit")), gumMs)
          ),
        ])
      : await gumPromise;
  } catch (e) {
    if (callKitHot && /mic-timeout-callkit/i.test(String(e?.message || e))) {
      console.warn("[ios] getUserMedia timed out on CallKit — continuing without mic for answer");
      // Don't leave a hung gum promise owning the in-flight flag forever.
      void gumPromise.then(async (stream) => {
        if (!micStreamUsable(state.localStream) && stream) {
          state.localStream = stream;
          watchMasterMicTracks(stream);
          keepMasterMicEnabled();
          ensureMicKeepalive();
          if (isPcAlive()) {
            try {
              await attachLocalMicToPc(state.pc, { force: true });
              reportMediaStat(state.pc, "late-gum");
              console.info("[ios] late CallKit mic attached via replaceTrack");
            } catch (err) {
              console.warn("[ios] late CallKit mic attach failed", err);
            }
          }
        }
      }).catch(() => {});
      return null;
    }
    throw e;
  }
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
 * Safari PWA only — Cap iOS prefers hard release (see releaseOrParkMicAfterCall).
 */
function parkMicStream() {
  if (!state.localStream) return;
  keepMasterMicEnabled();
  ensureMicKeepalive();
}

/** Cap iOS: stop capture when idle so WKWebView does not hold mic across suspend. Safari PWA: park. */
function releaseOrParkMicAfterCall() {
  if (isNativeIosShell()) {
    hardReleaseMicStream();
  } else {
    parkMicStream();
  }
}

function armMicForCall() {
  if (!state.localStream) return;
  keepMasterMicEnabled();
  setOutboundMicEnabled(!state.muted && !state.onHold);
  ensureMicKeepalive();
}

/**
 * Offer-paired audio transceiver must be sendrecv BEFORE createAnswer.
 * Never addTransceiver() before setRemoteDescription — that created a second
 * m-line (`?:sendrecv,0:recvonly`) so ATA got no uplink (hub [media] send=0).
 */
function ensureOfferAudioSendRecv(pc) {
  if (!pc?.getTransceivers) return;
  let flipped = 0;
  for (const t of pc.getTransceivers()) {
    const recvKind = t.receiver?.track?.kind;
    const senderKind = t.sender?.track?.kind;
    const looksAudio =
      recvKind === "audio" ||
      senderKind === "audio" ||
      (t.mid != null && !recvKind && !senderKind);
    if (!looksAudio && t.mid == null) continue;
    try {
      if (t.direction === "recvonly" || t.direction === "inactive") {
        t.direction = "sendrecv";
        flipped += 1;
      }
    } catch (e) {
      console.warn("[mic] could not set sendrecv", t.mid, e);
    }
  }
  if (flipped) console.info("[mic] flipped", flipped, "audio transceiver(s) → sendrecv");
}

/**
 * Clone master tracks onto a PC. Closing the PC must not end the master stream —
 * that was the remaining iOS re-prompt (park alone was not enough).
 * CallKit late gum: prefer replaceTrack on an empty audio sender so we do not
 * add a second m-line after call.answer already left.
 */
async function attachLocalMicToPc(pc, opts = {}) {
  if (!pc || !micStreamUsable(state.localStream)) return false;
  if (!Array.isArray(state.pcMicTracks)) state.pcMicTracks = [];
  const force = Boolean(opts.force);
  const live = (state.localStream.getAudioTracks() || []).filter((t) => t.readyState === "live");
  if (!live.length) return false;

  ensureOfferAudioSendRecv(pc);

  const hasLiveAudioSender = () =>
    (pc.getSenders?.() || []).some((s) => s.track?.kind === "audio" && s.track.readyState === "live");

  /** Prefer negotiated (mid-bound) audio sender — never the orphan pre-offer transceiver. */
  const findReplaceableAudioSender = () => {
    const ranked = [];
    for (const t of pc.getTransceivers?.() || []) {
      const s = t?.sender;
      if (!s) continue;
      if (!force && s.track && s.track.kind === "audio" && s.track.readyState === "live") continue;
      const recvKind = t.receiver?.track?.kind;
      const senderKind = s.track?.kind;
      if (senderKind && senderKind !== "audio") continue;
      if (recvKind && recvKind !== "audio") continue;
      // mid set = paired with remote offer m-line (the one ATA actually uses).
      const score =
        (t.mid != null ? 4 : 0) +
        (recvKind === "audio" ? 2 : 0) +
        (!s.track ? 1 : 0) +
        (force && s.track?.readyState === "live" ? 3 : 0);
      ranked.push({ s, score, mid: t.mid });
    }
    ranked.sort((a, b) => b.score - a.score);
    if (ranked[0]) return ranked[0].s;
    return (pc.getSenders?.() || []).find(
      (s) =>
        !s.track ||
        (s.track.kind === "audio" && (force || s.track.readyState === "ended"))
    );
  };

  let attached = false;
  // Cap WKWebView + CallKit: track.clone() often yields a live/enabled but silent uplink
  // while the master track is fine (browser softphone has no this bug). Use master on Cap.
  const useMasterTrack = isNativeIosShell();

  for (const track of live) {
    let outbound = null;
    if (useMasterTrack) {
      outbound = track;
    } else {
      try {
        outbound = track.clone();
      } catch (err) {
        console.warn("[mic] track.clone failed — attaching master track", err);
        outbound = track;
      }
    }
    if (!outbound) continue;
    outbound.enabled = !state.muted && !state.onHold;
    if (outbound !== track) state.pcMicTracks.push(outbound);

    if (!force && hasLiveAudioSender()) {
      if (outbound !== track) {
        try {
          outbound.stop();
        } catch {}
      }
      attached = true;
      continue;
    }

    const replaceable = findReplaceableAudioSender();
    if (replaceable && typeof replaceable.replaceTrack === "function") {
      try {
        const prev = replaceable.track;
        await replaceable.replaceTrack(outbound);
        if (prev && prev !== outbound && (state.pcMicTracks || []).includes(prev)) {
          try {
            prev.stop();
          } catch {}
          state.pcMicTracks = state.pcMicTracks.filter((t) => t !== prev);
        }
        console.info(
          "[mic] replaceTrack onto existing CallKit sender",
          force ? "(force)" : "",
          useMasterTrack ? "master" : "clone"
        );
        attached = true;
        continue;
      } catch (e) {
        console.warn("[mic] replaceTrack failed — falling back to addTrack", e);
      }
    }
    if (force && hasLiveAudioSender()) {
      // Already had a sender and replace failed — do not add a second m-line.
      attached = pcHasSendingMic(pc);
      continue;
    }
    try {
      pc.addTrack(outbound, state.localStream);
      attached = true;
    } catch (e) {
      console.warn("[mic] addTrack failed", e);
    }
  }

  // Only after remote offer exists — never before setRemoteDescription.
  if (!hasLiveAudioSender() && pc.remoteDescription) {
    const hasAudioXcvr = (pc.getTransceivers?.() || []).some((t) => {
      const rk = t.receiver?.track?.kind;
      const sk = t.sender?.track?.kind;
      return rk === "audio" || sk === "audio" || t.mid != null;
    });
    if (!hasAudioXcvr) {
      try {
        pc.addTransceiver("audio", { direction: "sendrecv" });
        console.warn("[mic] added sendrecv transceiver after remote offer — no audio m-line");
      } catch {}
    }
  }
  return attached;
}

async function prepareAnswerMic(pc) {
  if (!pc) return;
  ensureOfferAudioSendRecv(pc);
  // Forced audioActive (JS timeout before didActivate) → gum is usually silent on Cap.
  // Answer with null sendrecv mid-0; real audioActivated refreshes uplink.
  if (callKitOwnsUi() && callKitGate.forcedAudio) {
    console.warn("[ios] deferring gum until real didActivate (forced audioActive)");
    ensureOfferAudioSendRecv(pc);
    reportMediaStat(pc, "prep-answer-deferred-gum");
    return;
  }
  const mic = await ensureMicStream();
  if (mic) {
    armMicForCall();
    await attachLocalMicToPc(pc, { force: true });
  } else {
    console.warn("[ios] answer without mic yet — sendrecv null track; late gum will replaceTrack");
  }
  ensureOfferAudioSendRecv(pc);
  reportMediaStat(pc, "prep-answer-mic");
}

/**
 * Cap CallKit: re-gum after real didActivate and force-replace mid-0 sender.
 * Fixes live/enabled-but-silent uplink (clone or pre-didActivate gum).
 */
async function refreshCallKitUplinkMic(reason = "refresh") {
  if (!isPcAlive()) return false;
  console.info("[ios] refreshing CallKit uplink mic —", reason);
  try {
    hardReleaseMicStream();
  } catch {}
  // Let AVAudioSession settle after didActivate before WKWebView capture.
  await new Promise((r) => setTimeout(r, 150));
  const mic = await ensureMicStream();
  if (!mic) {
    console.warn("[ios] uplink refresh — gum returned null");
    return false;
  }
  try {
    armMicForCall();
  } catch {}
  await attachLocalMicToPc(state.pc, { force: true });
  const master = (state.localStream?.getAudioTracks?.() || []).find((t) => t.readyState === "live");
  if (master?.muted) {
    console.warn("[ios] master mic still muted after gum — waiting for unmute");
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          master.removeEventListener("unmute", finish);
        } catch {}
        resolve();
      };
      try {
        master.addEventListener("unmute", finish);
      } catch {
        finish();
        return;
      }
      setTimeout(finish, 2000);
    });
    keepMasterMicEnabled();
    await attachLocalMicToPc(state.pc, { force: true });
  }
  try {
    armMicForCall();
  } catch {}
  reportMediaStat(state.pc, `uplink-${String(reason).slice(0, 28)}`);
  const ok = pcHasSendingMic(state.pc) && micStreamSendingOk(state.localStream);
  console.info("[ios] uplink refresh done", {
    reason,
    ok,
    muted: Boolean(master?.muted),
    send: pcHasSendingMic(state.pc),
  });
  return ok;
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

/**
 * @param {string} peer
 * @param {{ deferMic?: boolean }} [opts] — CallKit inbound: defer gum/attach until
 *   after setRemoteDescription (prepareAnswerMic). Avoids dual m-line recvonly bug.
 */
async function makePc(peer, opts = {}) {
  // Never leave a half-negotiated PC around for CallKit retries to stumble on.
  if (state.pc) closeCurrentPc();
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
  // NEVER addTransceiver before setRemoteDescription on inbound — that produced
  // dirs=?:sendrecv,0:recvonly (ATA uplink dead). CallKit uses deferMic + prepareAnswerMic.
  if (!opts.deferMic) {
    const mic = await ensureMicStream();
    if (mic) {
      armMicForCall();
      await attachLocalMicToPc(pc);
    }
  } else {
    console.info("[ios] PC deferMic — attach after remote offer");
  }

  pc.ontrack = (ev) => {
    const audio = remoteAudio();
    if (audio) {
      try {
        ev.track.enabled = true;
      } catch {}
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      audio.srcObject = stream;
      audio.muted = false;
      audio.volume = 1;
      audio.setAttribute("playsinline", "");
      audio.setAttribute("webkit-playsinline", "true");
      const kick = () => {
        audio.play().catch(() => {});
        kickRemoteAudio();
      };
      kick();
      audio.onloadedmetadata = kick;
      if (isNativeIosShell()) {
        [200, 500, 1000, 2000].forEach((ms) => setTimeout(kick, ms));
      }
      reportMediaStat(pc, "ontrack");
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
        callId: state.call?.callId || undefined,
        fromLineId: state.activeLineId,
        toLineId: peer,
        candidate: payload,
      })
    );
  };
  pc.oniceconnectionstatechange = () => {
    console.warn("[ice] iceConnectionState", pc.iceConnectionState);
    reportMediaStat(pc, "ice");
    if (isNativeIosShell()) {
      console.info("[ios] ice", pc.iceConnectionState, "conn", pc.connectionState);
    }
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
    reportMediaStat(pc, "conn");
    if (pc.connectionState === "connected") {
      clearConnectWatch();
      // Soft→ATA: early WebRTC answer lets ICE connect while the landline still
      // rings — keep ringback UI until call.fxs-up.
      if (state.call?.earlyAnswer) {
        paintCallLayer();
        return;
      }
      stopDialTone();
      stopRing();
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
      applyPreferredCallAudio();
      const audio = remoteAudio();
      if (audio) {
        audio.muted = false;
        audio.volume = 1;
        audio.play().catch(() => {});
      }
      kickRemoteAudio();
      startSilenceWatch();
      paintCallLayer();
      if (isNativeIosShell()) {
        kickRemoteAudio();
        if (callKitOwnsUi()) {
          try {
            void nativeCallKit()?.setConnected?.({
              callId: state.call?.callId || state.pendingNativeCallId,
            });
          } catch {}
        }
      }
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
  if (isGpPreviewMode()) {
    setFlash("Preview only — exit preview to use your own phone", "warn");
    paintToast();
    return;
  }
  if (state.call || state.group) return;
  if (!toLineId || toLineId === state.activeLineId) return;
  exitSpeedDialEditMode();
  setFlash("");
  state.lastRedialLineId = toLineId;
  state.callStartedAt = 0;
  state.pendingIce = [];
  state.onHold = false;
  state.holdByLineId = null;
  state.speakerOn = true;
  state.audioRouteUserSet = false;
  state.call = { status: "calling", toLineId, fromLineId: state.activeLineId };
  // Kick AudioContext on the user-gesture stack before getUserMedia can suspend it.
  void unlockAudioCtx();
  applyPreferredCallAudio();
  beginOutboundCallAudio(outboundDigitsFor(toLineId));
  paintCallLayer();
  try {
    await requestWakeLock();
    const pc = await makePc(toLineId);
    // Mic open often leaves Web Audio suspended — re-unlock so DTMF/ringback stay audible.
    await unlockAudioCtx();
    applyPreferredCallAudio();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // CallKit callees often miss early trickle; bake candidates into the offer SDP.
    // 4s gives TURN/relay time (LAN hairpin + TCP TURN are slower than host).
    await waitIceGatheringComplete(pc, 4000);
    // Calling is an explicit take-over: reclaim if another tab/device kicked us,
    // or if the socket dropped during getUserMedia.
    if (state.wsReplaced || !state.ws || state.ws.readyState !== 1) {
      reconnectWs();
    }
    await waitForWsOpen(3000);
    const localOffer = pc.localDescription || offer;
    state.ws.send(
      JSON.stringify({
        type: "call.offer",
        fromLineId: state.activeLineId,
        toLineId,
        sdp: sdpPayload(localOffer),
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
  // Pending-offer repush / WS remount can deliver the same offer repeatedly.
  // Do not reset status or re-enter accept once this call is negotiating.
  if (
    msg?.callId &&
    state.call?.callId === msg.callId &&
    (callKitGate.answerSent ||
      acceptCallInFlight ||
      state.call.status === "connecting" ||
      state.call.status === "active" ||
      (isPcAlive() && state.pc.remoteDescription))
  ) {
    if (!state.call.sdp && msg.sdp) state.call = { ...state.call, sdp: msg.sdp };
    console.info("[signal] ignoring duplicate offer", msg.callId, state.call.status);
    return;
  }

  // Same inbound call still ringing (alert push + WS offer, pending fetch, etc.).
  // Do not reset state / restart ringer / remount the sheet.
  if (msg?.callId && state.call?.callId === msg.callId && state.call.status === "incoming") {
    if (msg.sdp) state.call = { ...state.call, sdp: msg.sdp };
    if (callKitOwnsUi()) {
      paintCallLayer();
      if (callKitGate.answered) {
        signalCallKitAccepted("offer");
        void acceptCallFromCallKit();
      } else void syncCallKitStateFromNative("offer");
      return;
    }
    paintCallLayer();
    return;
  }

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

  if (callKitOwnsUi()) {
    // System CallKit UI only — no in-app ring sheet / no softphone answer buttons.
    stopRing();
    const callerName = lineName(msg.fromLineId) || "Family";
    if (!callKitGate.systemRinging) {
      try {
        await nativeCallKit().reportIncoming({
          callId: String(msg.callId || ""),
          handle: String(msg.fromLineId || "PhoneHome"),
          callerName: String(callerName).slice(0, 64),
        });
        callKitGate.systemRinging = true;
      } catch (e) {
        console.warn("[ios] CallKit reportIncoming failed", e);
      }
    }
    paintCallLayer();
    if (callKitGate.answered) {
      signalCallKitAccepted("offer");
      void acceptCallFromCallKit();
    } else void syncCallKitStateFromNative("offer");
    armCallKitStatePoll();
    return;
  }

  startRing();
  paintCallLayer();
}

async function acceptCall() {
  const msg = state.call;
  if (!msg?.sdp) return;
  if (callKitGate.answerSent) {
    console.info("[signal] acceptCall skipped — answer already sent");
    return;
  }
  if (acceptCallInFlight) {
    console.info("[signal] acceptCall skipped — already in flight");
    return;
  }
  acceptCallInFlight = true;
  // Flip off "incoming" before any await so a late startRing() unlock can't restart audio.
  stopRing();
  state.call = { ...msg, status: "connecting" };
  state.speakerOn = true;
  state.audioRouteUserSet = false;
  applyPreferredCallAudio();
  paintCallLayer();
  try {
    await requestWakeLock();
    let pc = isPcAlive() ? state.pc : null;
    let answer = pc?.localDescription?.type === "answer" ? pc.localDescription : null;

    const callKitInbound = callKitOwnsUi() && callKitGate.answered;
    // Resume a partial accept (remote offer already applied) instead of setRemoteDescription twice.
    if (pc && answer && pc.remoteDescription) {
      console.info("[signal] acceptCall reusing local answer", msg.callId);
      // Answer already left without mic — still try late attach on the same sender.
      if (callKitInbound) {
        try {
          await prepareAnswerMic(pc);
        } catch (e) {
          console.warn("[signal] late prepareAnswerMic on reuse", e);
        }
      }
    } else if (pc && pc.signalingState === "have-remote-offer") {
      if (!state.remoteReady) await flushIce();
      if (callKitInbound) await prepareAnswerMic(pc);
      answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceGatheringComplete(
        pc,
        callKitInbound ? 800 : 4000
      );
    } else {
      // CallKit: defer mic until after remote offer so we bind sendrecv to mid=0.
      pc = await makePc(msg.fromLineId, { deferMic: callKitInbound });
      if (!isPcAlive(pc)) throw new Error("Could not start call media");
      if (pc.signalingState !== "stable") {
        console.warn("[signal] unexpected PC state before offer", pc.signalingState);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      await flushIce();
      if (pc.signalingState !== "have-remote-offer") {
        throw new DOMException(
          `Cannot create answer in signaling state ${pc.signalingState}`,
          "InvalidStateError"
        );
      }
      if (callKitInbound) await prepareAnswerMic(pc);
      else ensureOfferAudioSendRecv(pc);
      answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      // Bridge + CallKit peers drop early trickle; prefer candidates in the answer SDP.
      // CallKit: short gather — bridged keeps listening for trickle after call.answer.
      await waitIceGatheringComplete(
        pc,
        callKitInbound ? 800 : 4000
      );
    }

    reportMediaStat(pc, "answer-local");
    stopRing();
    if (state.wsReplaced || !state.ws || state.ws.readyState !== 1) {
      reconnectWs();
    }
    await waitForWsOpen(4000);
    if (!isPcAlive(pc) || state.call?.callId !== msg.callId) {
      console.warn("[signal] acceptCall aborted — PC/call gone before send");
      return;
    }
    const localAnswer = pc.localDescription || answer;
    console.info("[signal] sending call.answer", msg.callId);
    state.ws.send(
      JSON.stringify({
        type: "call.answer",
        callId: msg.callId,
        fromLineId: msg.fromLineId,
        toLineId: msg.toLineId,
        sdp: sdpPayload(localAnswer),
      })
    );
    callKitGate.answerSent = true;
    if (state.call?.callId === msg.callId) {
      state.call = { ...state.call, status: "connecting" };
    }
    armConnectWatch();
    paintCallLayer();
    applyPreferredCallAudio();
  } catch (e) {
    console.warn("[signal] acceptCall failed", e?.message || e);
    // Broken PC must not be reused by CallKit retries.
    closeCurrentPc();
    const soft = isInvalidStateError(e);
    const flash = soft ? null : friendlyCallError(e, "Could not answer");
    if (callKitOwnsUi() && callKitGate.answered && !callKitGate.answerSent) {
      // Keep the system call up; CallKit retries will try again.
      if (flash) setFlash(`${flash} — retrying…`, "error");
      state.call = { ...(state.call || msg), status: "incoming", sdp: msg.sdp };
      paintCallLayer();
      armCallKitAcceptRetries();
      return;
    }
    if (flash) setFlash(flash, "error");
    else if (!soft) setFlash("Could not answer", "error");
    hangup();
    render();
  } finally {
    acceptCallInFlight = false;
  }
}

async function onAnswer(msg) {
  if (!isPcAlive()) return;
  const sig = state.pc.signalingState;
  // Duplicate / late answer after stable — ignore (pending answer flush + WS remount).
  if (sig === "stable" && state.pc.remoteDescription) {
    console.info("[signal] ignoring duplicate answer", msg.callId);
    // Soft→ATA: early answer already applied; FXS pickup is call.fxs-up.
    if (msg.early) return;
    return;
  }
  if (sig !== "have-local-offer") {
    console.warn("[signal] unexpected answer in state", sig);
    return;
  }
  const early = Boolean(msg.early);
  if (!early) {
    clearRingTimeout();
    stopDialTone();
    stopRing(); // Answered — stop outbound ring even before ICE connects
  }
  try {
    await state.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await flushIce();
  } catch (e) {
    if (isInvalidStateError(e)) {
      console.warn("[signal] onAnswer ignored invalid state", e?.message || e);
      return;
    }
    console.warn("[signal] onAnswer failed", e?.message || e);
    const flash = friendlyCallError(e, "Could not connect");
    if (flash) setFlash(flash, "error");
    return;
  }
  if (early) {
    // Landline still ringing — keep ringback UI + ring timeout; ICE can connect now.
    state.call = {
      ...(state.call || {}),
      status: state.call?.status === "ringing" ? "ringing" : "calling",
      callId: msg.callId,
      earlyAnswer: true,
    };
    reportMediaStat(state.pc, "got-early-answer");
    paintCallLayer();
    return;
  }
  state.call = { ...(state.call || {}), status: "connecting", callId: msg.callId };
  reportMediaStat(state.pc, "got-answer");
  kickRemoteAudio();
  armConnectWatch();
  paintCallLayer();
}

/** Soft→ATA: landline picked up + ExternalMedia bridged — leave "ringing" for connect. */
function onFxsUp(msg) {
  if (!state.call) return;
  if (msg.callId && state.call.callId && msg.callId !== state.call.callId) return;
  clearRingTimeout();
  stopDialTone();
  stopRing();
  state.call = {
    ...state.call,
    status: state.iceState === "connected" ? "active" : "connecting",
    callId: msg.callId || state.call.callId,
    earlyAnswer: false,
  };
  if (state.call.status === "active") {
    if (!state.callStartedAt) state.callStartedAt = Date.now();
    startCallTicker();
  } else {
    armConnectWatch();
  }
  kickRemoteAudio();
  reportMediaStat(state.pc, "fxs-up");
  paintCallLayer();
}

function toggleMute() {
  noteCallActivity();
  state.muted = !state.muted;
  if (!state.onHold) setOutboundMicEnabled(!state.muted);
  paintCallLayer();
}

/**
 * Native iOS: route to earpiece or loudspeaker.
 * In-app (CallKit off) can route anytime. CallKit: only after audio is active.
 * Web/Safari: no earpiece API — no-op outside Capacitor.
 */
async function setCallSpeaker(on, { paint = true } = {}) {
  const want = Boolean(on);
  state.speakerOn = want;
  const kit = nativeCallKit();
  if (!kit?.setSpeaker || !isNativeIosShell()) {
    if (paint) paintCallLayer();
    return;
  }
  // In-app: leave AVAudioSession to WKWebView WebRTC (speaker). Native setSpeaker silences it.
  if (!callKitEnabled()) {
    state.speakerOn = true;
    if (paint) paintCallLayer();
    return;
  }
  if (!callKitGate.audioActive) {
    if (paint) paintCallLayer();
    return;
  }
  try {
    const res = await kit.setSpeaker({ enabled: want });
    if (typeof res?.enabled === "boolean") state.speakerOn = res.enabled;
  } catch (e) {
    console.warn("[ios] setSpeaker failed", e);
  }
  if (paint) paintCallLayer();
}

function applyPreferredCallAudio() {
  if (!isNativeIosShell() || !callKitEnabled()) return;
  if (state.audioRouteUserSet) return;
  void setCallSpeaker(Boolean(state.group), { paint: false });
}

function reassertCallAudio() {
  if (!isNativeIosShell() || !callKitEnabled()) return;
  if (!state.call && !state.group) return;
  void setCallSpeaker(state.speakerOn, { paint: false });
}

function toggleSpeaker() {
  noteCallActivity();
  state.audioRouteUserSet = true;
  void setCallSpeaker(!state.speakerOn);
}

function hangup() {
  if (state.group) {
    leaveGroup();
    return;
  }
  stopRing();
  releaseNativeCallAudio();
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

function releaseNativeCallAudio() {
  const kit = nativeCallKit();
  if (!kit || !isNativeIosShell() || !callKitEnabled()) return;
  try {
    void kit.endCall({ callId: state.call?.callId || state.pendingNativeCallId });
  } catch {}
}

function endCallUi(flash) {
  if (state.endingCall) return;
  state.endingCall = true;
  try {
  releaseNativeCallAudio();
  resetCallKitGate();
  stopRing();
  stopDialTone();
  stopHoldMusic();
  clearSilenceWatch();
  state.onHold = false;
  state.holdByLineId = null;
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
  acceptCallInFlight = false;
  releaseAllPcMicTracks();
  if (state.localStream && !state.group) {
    releaseOrParkMicAfterCall();
  }
  state.pendingIce = [];
  state.remoteReady = false;
  state.call = null;
  state.callStartedAt = 0;
  state.iceState = "";
  state.muted = false;
  state.speakerOn = false;
  state.audioRouteUserSet = false;
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
    el.setAttribute("webkit-playsinline", "true");
    el.playsInline = true;
    el.dataset.peer = lineId;
    root.appendChild(el);
  }
  return el;
}

/** Unlock autoplay during the Listen tap — ontrack play() is after the gesture window. */
function unlockGroupAudio() {
  const audio = peerAudioEl("__unlock__");
  if (!audio) return;
  try {
    audio.muted = true;
    audio.volume = 0;
    audio.play()?.catch(() => {});
  } catch {}
}

function kickGroupAudio() {
  const root = groupAudioRoot();
  if (!root) return;
  root.querySelectorAll("audio").forEach((audio) => {
    if (audio.dataset.peer === "__unlock__") return;
    try {
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      audio.setAttribute("webkit-playsinline", "true");
      audio.playsInline = true;
      audio.muted = false;
      audio.volume = 1;
      audio.play()?.catch(() => {});
    } catch {}
  });
}

function clearGroupAudio() {
  const root = groupAudioRoot();
  if (root) root.innerHTML = "";
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
  const wasFr = state.group?.familyRoom || msg.familyRoom || msg.playRoom;
  const wasAdultFr = state.group?.adultFamilyRoom || msg.adultFamilyRoom;
  setFlash(
    msg.reason ||
      (wasAdultFr ? "FamilyRoom ended" : wasFr ? "TreeHouse ended" : "Group call ended"),
    "info"
  );
  leaveGroup(true);
  if (wasFr) {
    state.familyRoomPresence = {
      householdId: msg.householdId || state.familyRoomPresence?.householdId || null,
      roomId: null,
      members: [],
      listeners: [],
      talkPairs: state.familyRoomPresence?.talkPairs || [],
    };
    state.playRoomListen = null;
  }
  if (wasAdultFr) {
    state.adultFamilyRoomPresence = {
      householdId: msg.householdId || state.adultFamilyRoomPresence?.householdId || null,
      roomId: null,
      members: [],
    };
  }
  render();
}

function msgTalkPairsFromState(hh = state.households[0]) {
  const fromPresence = state.familyRoomPresence?.talkPairs || [];
  const fromHh = hh?.family_room_talk_pairs || hh?.play_room_talk_pairs || [];
  const out = new Set();
  for (const p of [...fromPresence, ...fromHh]) {
    const a = Array.isArray(p) ? p[0] : p?.line_a;
    const b = Array.isArray(p) ? p[1] : p?.line_b;
    if (!a || !b || a === b) continue;
    out.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return out;
}

/** Symmetric talk edge: household kids auto; externals need parent talk pair. */
function canTalkInTreeHouse(lineA, lineB, hh = state.households[0]) {
  if (!lineA || !lineB || lineA === lineB) return false;
  const lines = hh?.lines || [];
  const a = lines.find((l) => l.id === lineA);
  const b = lines.find((l) => l.id === lineB);
  const bothHouseKids =
    a &&
    b &&
    a.household_id === hh?.id &&
    b.household_id === hh?.id &&
    (a.mode || "parent") === "child" &&
    (b.mode || "parent") === "child";
  if (bothHouseKids) return true;
  // Same-household kids may not be in hh.lines for externals — also check always list.
  const always = familyRoomAlwaysIds(hh);
  if (always.has(lineA) && always.has(lineB)) return true;
  const key = lineA < lineB ? `${lineA}|${lineB}` : `${lineB}|${lineA}`;
  return msgTalkPairsFromState(hh).has(key);
}

function myTreeHouseTalkPeers(memberIds) {
  const me = state.activeLineId;
  if (!me) return [];
  if (state.playRoomListen?.listenTargets?.length) {
    return state.playRoomListen.listenTargets.filter((id) => id !== me);
  }
  return (memberIds || []).filter((id) => id !== me && canTalkInTreeHouse(me, id));
}

function onTreeHouseAnnounce(msg) {
  const text = String(msg.text || "").trim();
  if (!text) return;
  // Dedupe dual playroom/familyroom emits
  if (state._playRoomAnnounceLast === text && Date.now() - (state._playRoomAnnounceAt || 0) < 1500) {
    return;
  }
  state._playRoomAnnounceLast = text;
  state._playRoomAnnounceAt = Date.now();
  speakUnavailablePrompt(text);
  setFlash(text, "info");
}

function onTreeHousePresence(msg) {
  const hh = state.households[0];
  if (hh && msg.householdId && msg.householdId !== hh.id) return;
  // Deduplicate dual emits
  const sig = `${msg.roomId}|${(msg.members || []).join(",")}|${(msg.listeners || [])
    .map((l) => l.parentLineId)
    .join(",")}`;
  if (state._playRoomPresenceSig === sig && Date.now() - (state._playRoomPresenceAt || 0) < 400) {
    return;
  }
  state._playRoomPresenceSig = sig;
  state._playRoomPresenceAt = Date.now();
  state.familyRoomPresence = {
    householdId: msg.householdId || hh?.id || null,
    roomId: msg.roomId || null,
    members: Array.isArray(msg.members) ? msg.members : [],
    listeners: Array.isArray(msg.listeners) ? msg.listeners : [],
    talkPairs: Array.isArray(msg.talkPairs) ? msg.talkPairs : state.familyRoomPresence?.talkPairs || [],
  };
  if (state.group?.familyRoom && state.group.roomId === msg.roomId) {
    state.group.members = state.familyRoomPresence.members;
    state.group.listeners = state.familyRoomPresence.listeners;
  }
  if (state.screen === "home" && state.nav === "phone") {
    patchTreeHousePresenceChips();
    patchAdultFamilyRoomPresenceChips();
  }
  // Soft-update call chrome only — full paintCallLayer remount looks like a refresh thrash.
  if (state.group?.familyRoom || state.playRoomListen) {
    patchTreeHouseCallLayerPresence();
  }
}

/** In-room session is live even alone (no ICE peers yet). Starts the timer. */
function markTreeHouseSessionLive() {
  if (!state.group) return;
  stopRing();
  stopDialTone();
  if (state.group.status !== "active") state.group.status = "active";
  if (!state.callStartedAt) {
    state.callStartedAt = Date.now();
    startCallTicker();
  }
}

/** Update TreeHouse call-layer member copy without remounting (keeps timer / buttons). */
function patchTreeHouseCallLayerPresence() {
  const layer = document.getElementById("call-layer");
  if (!layer || !state.group) {
    paintCallLayer();
    return;
  }
  const members = state.group.members || [];
  const media = layer.querySelector(".call-media");
  if (media && !state.group.listenOnly) {
    media.textContent = `${members.length} in TreeHouse`;
  }
}

async function onTreeHouseJoined(msg) {
  // Alias triple-emit (treehouse/playroom/familyroom) must not reset a live session.
  if (state.group?.familyRoom && state.group.roomId === msg.roomId) {
    state.group.members = msg.members || state.group.members;
    state.group.hostLineId = msg.hostLineId || state.group.hostLineId;
    if (Array.isArray(msg.talkPeers)) state.group.talkPeers = msg.talkPeers;
    if (Array.isArray(msg.listeners)) state.group.listeners = msg.listeners;
    state.familyRoomPresence = {
      householdId: msg.householdId || state.familyRoomPresence?.householdId || state.households[0]?.id || null,
      roomId: msg.roomId,
      members: msg.members || state.familyRoomPresence?.members || [],
      listeners: msg.listeners || state.familyRoomPresence?.listeners || [],
      talkPairs: state.familyRoomPresence?.talkPairs || [],
    };
    markTreeHouseSessionLive();
    patchTreeHouseCallLayerPresence();
    return;
  }
  state.group = {
    roomId: msg.roomId,
    status: "connecting",
    hostLineId: msg.hostLineId,
    members: msg.members || [state.activeLineId],
    invited: [],
    familyRoom: true,
    playRoom: true,
    talkPeers: msg.talkPeers || myTreeHouseTalkPeers(msg.members || []),
    listeners: msg.listeners || [],
  };
  state.familyRoomPresence = {
    householdId: msg.householdId || state.households[0]?.id || null,
    roomId: msg.roomId,
    members: msg.members || [],
    listeners: msg.listeners || [],
    talkPairs: state.familyRoomPresence?.talkPairs || [],
  };
  state.speakerOn = true;
  // Solo (or waiting for peers): room membership is enough — don't stick on Connecting… / 0:00.
  markTreeHouseSessionLive();
  paintCallLayer();
}

async function onTreeHouseListenStarted(msg) {
  if (msg.parentLineId && msg.parentLineId !== state.activeLineId) return;
  state.playRoomListen = {
    roomId: msg.roomId,
    childLineId: msg.childLineId,
    childName: msg.childName || lineName(msg.childLineId),
    listenTargets: msg.listenTargets || [],
    analogTargets: msg.analogTargets || [],
  };
  state.group = {
    roomId: msg.roomId,
    status: "connecting",
    hostLineId: msg.childLineId,
    members: msg.members || [],
    invited: [],
    familyRoom: true,
    playRoom: true,
    listenOnly: true,
    talkPeers: msg.listenTargets || [],
    listeners: [
      {
        parentLineId: state.activeLineId,
        childLineId: msg.childLineId,
        childName: msg.childName,
      },
    ],
  };
  state.groupPeers = {};
  state.muted = true;
  state.speakerOn = true;
  state.screen = "home";
  paintCallLayer();
  applyPreferredCallAudio();
  try {
    // Recvonly — never capture/join as a speaking participant.
    // Softphone kids offer TO us (peer-joined). Analog kids cannot — we offer, bridge answers.
    await requestWakeLock();
    const analog = state.playRoomListen?.analogTargets || msg.analogTargets || [];
    const analogOffer = analog.includes(msg.childLineId) ? msg.childLineId : analog[0];
    if (analogOffer && analogOffer !== state.activeLineId) {
      await groupOfferTo(analogOffer, { recvOnly: true });
    }
    markTreeHouseSessionLive();
    paintCallLayer();
    kickGroupAudio();
  } catch (e) {
    setFlash(e.message || "Could not start listen-only", "error");
    stopTreeHouseListen(true);
  }
}

function onTreeHouseListenStopped(msg) {
  if (state.playRoomListen && msg.roomId && state.playRoomListen.roomId !== msg.roomId) return;
  const was = Boolean(state.playRoomListen || state.group?.listenOnly);
  state.playRoomListen = null;
  if (was) {
    leaveGroup(true);
    setFlash("Stopped listening", "info");
    render();
  }
}

function startTreeHouseListen(childLineId) {
  if (!childLineId || !state.activeLineId) return;
  if (state.call || (state.group && !state.group.listenOnly)) {
    setFlash("Hang up before listening", "warn");
    return;
  }
  if (!state.ws || state.ws.readyState !== 1) {
    setFlash("Not connected yet — wait a second", "warn");
    return;
  }
  unlockGroupAudio();
  state.ws.send(
    JSON.stringify({
      type: "treehouse.listen.start",
      parentLineId: state.activeLineId,
      childLineId,
    })
  );
}

/** Household parent softphone (not kid chrome / child-mode lock). */
function isHouseholdParentPad(hh = state.households[0]) {
  if (isKidExperience() || isChildMode()) return false;
  const active = (hh?.lines || []).find((l) => l.id === state.activeLineId);
  return Boolean(active) && (active.mode || "parent") !== "child";
}

/** Kid line ids currently in this household’s TreeHouse. */
function treeHouseKidsInRoom(hh = state.households[0]) {
  const live = new Set(familyRoomPresenceMembers());
  return (hh?.lines || []).filter(
    (l) => l.id && (l.mode || "parent") === "child" && live.has(l.id)
  );
}

/** Parent pad #0: listen-only to a kid in TreeHouse (never talk-join / approve gate). */
function parentTreeHousePadAction() {
  if (state.playRoomListen || state.group?.listenOnly) {
    stopTreeHouseListen(false);
    return;
  }
  if (state.call || state.group) {
    setFlash("Hang up before listening", "warn");
    return;
  }
  const hh = state.households[0];
  const inRoom = treeHouseKidsInRoom(hh);
  if (!inRoom.length) {
    setFlash("No kids in TreeHouse right now — open Parent → TreeHouse when they’re in", "info");
    return;
  }
  const prefer =
    inRoom.find((l) => l.id === state.ataTargetLineId) ||
    inRoom.find((l) => l.id === householdPad0ChildLine(hh)?.id) ||
    inRoom[0];
  startTreeHouseListen(prefer.id);
}

function stopTreeHouseListen(silent) {
  const roomId = state.playRoomListen?.roomId || state.group?.roomId;
  if (!silent && state.ws && state.activeLineId) {
    state.ws.send(
      JSON.stringify({
        type: "treehouse.listen.stop",
        parentLineId: state.activeLineId,
        roomId,
      })
    );
  }
  state.playRoomListen = null;
  leaveGroup(true);
}

function leaveGroup(silent) {
  stopRing();
  stopDialTone();
  stopHoldMusic();
  clearSilenceWatch();
  state.onHold = false;
  state.holdByLineId = null;
  state.stillPrompt = false;
  const wasFr = Boolean(state.group?.familyRoom || state.playRoomListen);
  const wasListen = Boolean(state.group?.listenOnly || state.playRoomListen);
  const roomId = state.group?.roomId || state.playRoomListen?.roomId;
  if (!silent && state.ws && roomId) {
    state.ws.send(
      JSON.stringify({
        type: wasListen
          ? "playroom.listen.stop"
          : wasFr
            ? "playroom.leave"
            : "group.leave",
        roomId,
        lineId: state.activeLineId,
        parentLineId: state.activeLineId,
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
  releaseOrParkMicAfterCall();
  state.group = null;
  state.playRoomListen = null;
  state.callStartedAt = 0;
  state.muted = false;
  state.speakerOn = false;
  state.audioRouteUserSet = false;
  releaseNativeCallAudio();
  stopCallTicker();
  clearConnectWatch();
  releaseWakeLock();
  paintCallLayer();
}

function joinTreeHouse() {
  if (state.call || state.group) return;
  const hh = state.households[0];
  if (!hh) return;
  // Parents never talk-join — listen-only bypasses family_room_members approve.
  if (isHouseholdParentPad(hh)) {
    parentTreeHousePadAction();
    return;
  }
  const approved = familyRoomApprovedIds(hh);
  if (!approved.has(state.activeLineId)) {
    setFlash(
      isKidExperience()
        ? "Ask a parent to approve you for TreeHouse"
        : "Approve this line for TreeHouse in Parent → TreeHouse",
      "warn"
    );
    render();
    return;
  }
  if (state.wsReplaced || !state.ws || state.ws.readyState !== 1) {
    reconnectWs();
  }
  if (!state.ws || state.ws.readyState !== 1) {
    setFlash("Not connected yet — wait a second", "warn");
    render();
    return;
  }
  setFlash("");
  state.group = {
    roomId: null,
    status: "connecting",
    hostLineId: state.activeLineId,
    members: [state.activeLineId],
    invited: [],
    familyRoom: true,
    playRoom: true,
  };
  state.groupPeers = {};
  state.onHold = false;
  state.holdByLineId = null;
  state.speakerOn = true;
  state.screen = "home";
  beginOutboundCallAudio(String(TREEHOUSE_SLOT));
  paintCallLayer();
  requestWakeLock().catch(() => {});
  ensureGroupMic()
    .then(() => {
      unlockAudioCtx();
      applyPreferredCallAudio();
    })
    .catch((e) => {
      setFlash(e.message || "Microphone needed", "error");
      // Notify server so we don’t leave a ghost member (presence-only hang).
      leaveGroup();
      render();
    });
  state.ws.send(
    JSON.stringify({
      type: "treehouse.join",
      lineId: state.activeLineId,
    })
  );
}

function lastNameFromDisplay(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function displayNameForParentLine(line, hh) {
  const member = (hh?.members || []).find((m) => m.user_id === line?.owner_user_id);
  if (member?.display_name) return member.display_name;
  if (state.user?.id === line?.owner_user_id) {
    return state.user.display_name || "";
  }
  return "";
}

/** Slot 2: other parent last name; Mom/Dad if they share the household name and chose a title. */
function familyRoomSlot2Label(secondary, hh, slot1Label) {
  const last = lastNameFromDisplay(displayNameForParentLine(secondary, hh));
  const slot1 = String(slot1Label || "").trim().toLowerCase();
  if (last && last.toLowerCase() !== slot1) return last;
  const title = parentDisplayLabel(secondary, hh);
  if (title === "Mom" || title === "Dad") return title;
  return last || hh?.name || "Family";
}

function buildAdultFamilyRoomChoices(hh = state.households[0]) {
  const fromServer = hh?.family_room_choices_by_line?.[state.activeLineId];
  if (Array.isArray(fromServer) && fromServer.length) {
    return fromServer.slice(0, 2).map((c) => ({
      slot: Number(c.slot) || 1,
      householdId: c.householdId || c.household_id || hh.id,
      label: c.label,
    }));
  }
  const choices = [];
  if (!hh || !adultFamilyRoomApprovedIds(hh).has(state.activeLineId)) return choices;
  const slot1 = (hh.name || "Family").trim() || "Family";
  choices.push({ slot: 1, householdId: hh.id, label: slot1 });
  const otherHh = (state.households || []).find(
    (h) => h.id !== hh.id && adultFamilyRoomApprovedIds(h).has(state.activeLineId)
  );
  if (otherHh) {
    const otherAdmin = householdAdminParentLine(otherHh);
    choices.push({
      slot: 2,
      householdId: otherHh.id,
      label: otherAdmin
        ? familyRoomSlot2Label(otherAdmin, otherHh, slot1)
        : (otherHh.name || "Family").trim() || "Family",
    });
  } else {
    const secondary = householdSecondaryParentLine(hh);
    if (secondary) {
      choices.push({
        slot: 2,
        householdId: hh.id,
        label: familyRoomSlot2Label(secondary, hh, slot1),
      });
    }
  }
  return choices.slice(0, 2);
}

function tryFamilyRoomPickerDigit(digit) {
  const pick = state.familyRoomPicker;
  if (!pick?.choices?.length) return false;
  const choice = pick.choices.find((c) => String(c.slot) === String(digit));
  if (!choice) return false;
  closeFamilyRoomPickerSheet();
  joinAdultFamilyRoom(choice.householdId);
  return true;
}

function closeFamilyRoomPickerSheet() {
  state.familyRoomPicker = null;
  document.getElementById("familyroom-pick-sheet")?.remove();
}

function showFamilyRoomPickerSheet(choices) {
  closeFamilyRoomPickerSheet();
  state.familyRoomPicker = { choices };
  const wrap = document.createElement("div");
  wrap.id = "familyroom-pick-sheet";
  wrap.className = "sheet-modal";
  const buttons = choices
    .map((c, i) => {
      const label = String(c.label || `Family ${c.slot}`).replace(/</g, "");
      const hid = String(c.householdId || "").replace(/"/g, "");
      const cls = i === 0 ? "primary btn-block" : "ghost btn-block";
      return `<button type="button" class="${cls}" data-fr-pick="${hid}">${label}</button>`;
    })
    .join("");
  wrap.innerHTML = `
    <div class="sheet-modal-card" role="dialog" aria-modal="true" aria-labelledby="fr-pick-title">
      <h2 id="fr-pick-title">Which FamilyRoom?</h2>
      <p>Choose a family to join.</p>
      <div class="fr-pick-stack">${buttons}</div>
      <button type="button" class="linkish auth-link" id="fr-pick-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeFamilyRoomPickerSheet();
  });
  wrap.querySelectorAll("[data-fr-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hid = btn.getAttribute("data-fr-pick");
      closeFamilyRoomPickerSheet();
      if (hid) joinAdultFamilyRoom(hid);
    });
  });
  document.getElementById("fr-pick-cancel")?.addEventListener("click", closeFamilyRoomPickerSheet);
}

function startAdultFamilyRoomIvr() {
  if (state.call || (state.group && !state.group?.adultFamilyRoom)) return;
  const hh = state.households[0];
  const choices = buildAdultFamilyRoomChoices(hh);
  if (!choices.length) {
    const anyApproved = (state.households || []).some((h) =>
      adultFamilyRoomApprovedIds(h).has(state.activeLineId)
    );
    setFlash(
      anyApproved
        ? "No FamilyRoom available"
        : isKidExperience()
          ? "Ask a parent to approve you for FamilyRoom"
          : "Ask your Pod admin to approve you for FamilyRoom",
      anyApproved ? "info" : "warn"
    );
    return;
  }
  if (choices.length === 1) {
    joinAdultFamilyRoom(choices[0].householdId);
    return;
  }
  showFamilyRoomPickerSheet(choices);
}

function joinAdultFamilyRoom(householdId) {
  if (state.call || (state.group && !state.group?.adultFamilyRoom)) return;
  if (state.wsReplaced || !state.ws || state.ws.readyState !== 1) {
    reconnectWs();
  }
  if (!state.ws || state.ws.readyState !== 1) {
    setFlash("Not connected yet — wait a second", "warn");
    return;
  }
  state.group = {
    roomId: null,
    status: "connecting",
    hostLineId: state.activeLineId,
    members: [state.activeLineId],
    invited: [],
    adultFamilyRoom: true,
  };
  state.groupPeers = {};
  state.onHold = false;
  state.holdByLineId = null;
  state.speakerOn = true;
  paintCallLayer();
  requestWakeLock().catch(() => {});
  ensureGroupMic()
    .then(() => {
      unlockAudioCtx();
      applyPreferredCallAudio();
    })
    .catch((e) => {
      setFlash(e.message || "Microphone needed", "error");
      leaveGroup();
      render();
    });
  state.ws.send(
    JSON.stringify({
      type: "adultfamily.join",
      lineId: state.activeLineId,
      householdId,
    })
  );
}

async function onAdultFamilyRoomJoined(msg) {
  state.adultFamilyRoomPresence = {
    householdId: msg.householdId || state.households[0]?.id || null,
    roomId: msg.roomId,
    members: msg.members || [state.activeLineId],
  };
  if (state.group?.adultFamilyRoom && state.group.roomId === msg.roomId) {
    state.group.members = msg.members || state.group.members;
    state.group.talkPeers = msg.talkPeers || state.group.talkPeers;
    state.group.status = "active";
    paintCallLayer();
    patchAdultFamilyRoomPresenceChips();
    return;
  }
  state.group = {
    roomId: msg.roomId,
    householdId: msg.householdId,
    hostLineId: msg.hostLineId,
    members: msg.members || [state.activeLineId],
    invited: [],
    talkPeers: msg.talkPeers || (msg.members || []).filter((id) => id !== state.activeLineId),
    status: "connecting",
    adultFamilyRoom: true,
  };
  state.groupPeers = {};
  stopRing();
  stopDialTone();
  try {
    await ensureGroupMic();
    await requestWakeLock();
    const targets = state.group.talkPeers || [];
    for (const other of targets) {
      await groupOfferTo(other);
    }
    state.group.status = "active";
  } catch (e) {
    setFlash(e.message || "Could not join FamilyRoom", "error");
    leaveGroup();
    render();
    return;
  }
  paintCallLayer();
  patchAdultFamilyRoomPresenceChips();
}

function familyRoomPresenceMembers() {
  const list = state.familyRoomPresence?.members || [];
  return list.filter(Boolean);
}

function familyRoomPresenceListeners() {
  return state.familyRoomPresence?.listeners || [];
}

/**
 * Presence chip “active” (green) vs muted grey.
 * Joined members look active by default. Grey only for *other* peers filtered
 * from your in-session talk graph — never self, never a solo occupant, and
 * never when you’re only viewing the pad (not in TreeHouse / listen).
 */
function treeHousePresenceChipActive(memberId, members) {
  const me = state.activeLineId;
  if (memberId === me) return true;
  if ((members || []).length <= 1) return true;
  if (state.group?.listenOnly && (state.group.talkPeers || []).includes(memberId)) {
    return true;
  }
  const inSession = Boolean(
    state.group?.familyRoom || state.group?.listenOnly || state.playRoomListen
  );
  if (!inSession) return true;
  return canTalkInTreeHouse(me, memberId);
}

function familyRoomPresenceChipsHtml(opts = {}) {
  const members = familyRoomPresenceMembers();
  const listeners = familyRoomPresenceListeners();
  if (!members.length && !listeners.length) return "";
  const maxShow = opts.maxShow ?? 6;
  const me = state.activeLineId;
  const chips = [];
  for (const id of members) {
    const name = lineName(id);
    const isMe = id === me;
    const talk = treeHousePresenceChipActive(id, members);
    const cls = [
      "familyroom-chip",
      isMe ? "is-me" : "",
      talk ? "is-talk" : "is-muted-peer",
    ]
      .filter(Boolean)
      .join(" ");
    const tip = talk
      ? name
      : `${name} (in TreeHouse — not talk-connected)`;
    chips.push(
      `<span class="${cls}" title="${String(tip).replace(/"/g, "&quot;")}">${avatarHtml(name, id, "xs")}</span>`
    );
  }
  for (const li of listeners) {
    const child = li.childName || lineName(li.childLineId);
    const tip = `${child}’s parent is listening`;
    chips.push(
      `<span class="familyroom-chip is-parent-listen" title="${String(tip).replace(/"/g, "&quot;")}" aria-label="${String(tip).replace(/"/g, "&quot;")}"><span class="familyroom-listen-mark" aria-hidden="true">P</span></span>`
    );
  }
  const shown = chips.slice(0, maxShow);
  const extra = chips.length - shown.length;
  return `<div class="familyroom-presence" aria-label="${members.length} in TreeHouse">
    ${shown.join("")}
    ${extra > 0 ? `<span class="familyroom-chip-more">+${extra}</span>` : ""}
  </div>`;
}

function patchTreeHousePresenceChips() {
  const host = document.getElementById("familyroom-presence-host");
  if (!host) return;
  const html = familyRoomPresenceChipsHtml();
  host.innerHTML = html;
  host.hidden = !html;
  host.classList.toggle("has-members", Boolean(html));
  host.closest(".pad-treehouse")?.classList.toggle("has-presence", Boolean(html));
}

function adultFamilyRoomPresenceMembers() {
  return (state.adultFamilyRoomPresence?.members || []).filter(Boolean);
}

function adultFamilyRoomPresenceChipsHtml(opts = {}) {
  const members = adultFamilyRoomPresenceMembers();
  if (!members.length) return "";
  const maxShow = opts.maxShow ?? 6;
  const me = state.activeLineId;
  const chips = members.map((id) => {
    const name = lineName(id);
    const isMe = id === me;
    const cls = ["familyroom-chip", isMe ? "is-me" : "is-talk"].filter(Boolean).join(" ");
    return `<span class="${cls}" title="${String(name).replace(/"/g, "&quot;")}">${avatarHtml(name, id, "xs")}</span>`;
  });
  const shown = chips.slice(0, maxShow);
  const extra = chips.length - shown.length;
  return `<div class="familyroom-presence" aria-label="${members.length} in FamilyRoom">
    ${shown.join("")}
    ${extra > 0 ? `<span class="familyroom-chip-more">+${extra}</span>` : ""}
  </div>`;
}

function patchAdultFamilyRoomPresenceChips() {
  const host = document.getElementById("adult-familyroom-presence-host");
  if (!host) return;
  const html = adultFamilyRoomPresenceChipsHtml();
  host.innerHTML = html;
  host.hidden = !html;
  host.classList.toggle("has-members", Boolean(html));
  host.closest(".pad-adult-familyroom")?.classList.toggle("has-presence", Boolean(html));
}

function onAdultFamilyRoomPresence(msg) {
  const hh = state.households[0];
  if (hh && msg.householdId && msg.householdId !== hh.id) return;
  const sig = `${msg.roomId}|${(msg.members || []).join(",")}`;
  if (state._adultFrPresenceSig === sig && Date.now() - (state._adultFrPresenceAt || 0) < 400) {
    return;
  }
  state._adultFrPresenceSig = sig;
  state._adultFrPresenceAt = Date.now();
  state.adultFamilyRoomPresence = {
    householdId: msg.householdId || hh?.id || null,
    roomId: msg.roomId || null,
    members: Array.isArray(msg.members) ? msg.members : [],
  };
  if (state.group?.adultFamilyRoom && state.group.roomId === msg.roomId) {
    state.group.members = state.adultFamilyRoomPresence.members;
  }
  if (state.screen === "home" && state.nav === "phone") {
    patchAdultFamilyRoomPresenceChips();
  }
}

/** TreeHouse pad mark — CSS-masked /treehouse.svg */
function treeHouseHouseIconHtml() {
  return `<span class="familyroom-house treehouse-house" aria-hidden="true"></span>`;
}

/** FamilyRoom — classic house (hash is in the SVG/PNG art) */
function adultFamilyRoomHouseIconHtml() {
  return `<span class="familyroom-classic-house" aria-hidden="true"></span>`;
}

function renderTreeHouseSlot(extraClass = "") {
  const hh = state.households[0];
  const approved = familyRoomApprovedIds(hh);
  const parentPad = isHouseholdParentPad(hh);
  const canJoin = approved.has(state.activeLineId);
  const listening = Boolean(state.playRoomListen || state.group?.listenOnly);
  const inRoom = Boolean(state.group?.familyRoom) && !listening;
  const liveCount = familyRoomPresenceMembers().length;
  const kidsIn = treeHouseKidsInRoom(hh).length;
  let presence = "wait";
  let status = "Needs parent approval";
  let ready = canJoin;
  if (parentPad) {
    ready = true;
    presence = listening ? "on" : kidsIn || liveCount ? "on" : "away";
    status = listening
      ? `Listening · ${state.playRoomListen?.childName || "kid"}`
      : kidsIn
        ? `${kidsIn} in TreeHouse · tap to listen`
        : liveCount
          ? `${liveCount} in TreeHouse · tap to listen`
          : "Listen only when a kid is in";
  } else if (canJoin) {
    presence = liveCount > 0 ? "on" : "away";
    status = inRoom
      ? "You’re in TreeHouse"
      : liveCount
        ? `${liveCount} in TreeHouse`
        : "TreeHouse";
  }
  const aria = `TreeHouse, dial ${TREEHOUSE_SLOT}, ${status}`.replace(/"/g, "&quot;");
  const presenceHtml = familyRoomPresenceChipsHtml();
  return `<button class="speed-slot pad-familyroom pad-treehouse ${ready ? "" : "not-ready"} ${inRoom || listening ? "is-live" : ""} ${liveCount ? "has-presence" : ""} ${extraClass}" data-slot="${TREEHOUSE_SLOT}" data-familyroom="1" type="button" aria-label="${aria}">
    <span class="speed-face presence-${presence}" title="${status.replace(/"/g, "&quot;")}">
      <div id="familyroom-presence-host" class="familyroom-presence-host ${presenceHtml ? "has-members" : ""}" ${presenceHtml ? "" : "hidden"}>${presenceHtml}</div>
      <span class="speed-familyroom-glyph" aria-hidden="true">
        ${treeHouseHouseIconHtml()}
      </span>
    </span>
    <span class="speed-cap">
      <strong class="speed-name familyroom-wordmark">Tree<span>House</span></strong>
      <span class="speed-num" aria-hidden="true">${TREEHOUSE_SLOT}</span>
    </span>
  </button>`;
}

function renderAdultFamilyRoomSlot(extraClass = "") {
  const hh = state.households[0];
  const approved = adultFamilyRoomApprovedIds(hh);
  const canJoin = approved.has(state.activeLineId);
  const inRoom = Boolean(state.group?.adultFamilyRoom);
  const liveCount = adultFamilyRoomPresenceMembers().length;
  let presence = canJoin ? (liveCount > 0 ? "on" : "away") : "wait";
  let status = canJoin
    ? inRoom
      ? "You’re in FamilyRoom"
      : liveCount
        ? `${liveCount} in FamilyRoom`
        : "FamilyRoom"
    : "Needs parent approval";
  const aria = `FamilyRoom, dial pound, ${status}`.replace(/"/g, "&quot;");
  const presenceHtml = adultFamilyRoomPresenceChipsHtml();
  return `<button class="speed-slot pad-familyroom pad-adult-familyroom ${canJoin ? "" : "not-ready"} ${inRoom ? "is-live" : ""} ${liveCount ? "has-presence" : ""} ${extraClass}" data-adult-familyroom="1" type="button" aria-label="${aria}">
    <span class="speed-face presence-${presence}" title="${status.replace(/"/g, "&quot;")}">
      <div id="adult-familyroom-presence-host" class="familyroom-presence-host ${presenceHtml ? "has-members" : ""}" ${presenceHtml ? "" : "hidden"}>${presenceHtml}</div>
      <span class="speed-familyroom-glyph" aria-hidden="true">
        ${adultFamilyRoomHouseIconHtml()}
      </span>
    </span>
    <span class="speed-cap">
      <strong class="speed-name familyroom-wordmark">Family<span>Room</span></strong>
      <span class="speed-num speed-num-hash" aria-hidden="true">#</span>
    </span>
  </button>`;
}

async function ensureGroupMic() {
  await ensureMicStream();
  armMicForCall();
  return state.localStream;
}

async function makeGroupPc(peerLineId, opts = {}) {
  if (state.groupPeers[peerLineId]?.pc) return state.groupPeers[peerLineId];
  const recvOnly = Boolean(opts.recvOnly || state.group?.listenOnly);
  const stream = recvOnly ? null : await ensureGroupMic();
  const pc = new RTCPeerConnection({
    iceServers: await iceServers(),
    iceCandidatePoolSize: 4,
  });
  const stub = state.groupPeers[peerLineId];
  const peer = {
    pc,
    pendingIce: stub?.pendingIce?.length ? [...stub.pendingIce] : [],
    remoteReady: false,
    recvOnly,
  };
  state.groupPeers[peerLineId] = peer;
  if (recvOnly) {
    pc.addTransceiver("audio", { direction: "recvonly" });
  } else {
    await attachLocalMicToPc(pc);
  }
  pc.ontrack = (ev) => {
    const audio = peerAudioEl(peerLineId);
    if (audio) {
      audio.srcObject = ev.streams[0] || new MediaStream([ev.track]);
      audio.muted = false;
      audio.volume = 1;
      audio.play().catch(() => {});
    }
    kickGroupAudio();
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
  if (!peer?.pc) return;
  try {
    if (peer.pc.signalingState === "closed" || peer.pc.connectionState === "closed") return;
  } catch {
    return;
  }
  peer.remoteReady = true;
  const queued = peer.pendingIce.splice(0);
  for (const c of queued) {
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      if (!isInvalidStateError(e)) console.warn("[group-ice] flush", e);
    }
  }
}

async function groupOfferTo(peerLineId, opts = {}) {
  if (peerLineId === state.activeLineId) return;
  const peer = await makeGroupPc(peerLineId, opts);
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
  if (msg.familyRoom || msg.playRoom) {
    state.group.familyRoom = true;
    state.group.playRoom = true;
  }
  if (Array.isArray(msg.talkPeers)) state.group.talkPeers = msg.talkPeers;

  const isPlay = Boolean(state.group.familyRoom || state.group.playRoom);
  const isAdultFr = Boolean(state.group.adultFamilyRoom || msg.adultFamilyRoom);
  const listenOnly = Boolean(state.group.listenOnly || msg.listener);

  // Joiner creates offers to talk-approved peers only (TreeHouse) or everyone (group / FamilyRoom).
  if (msg.lineId === state.activeLineId) {
    if (!listenOnly) state.group.status = "connecting";
    stopRing();
    stopDialTone();
    try {
      if (!listenOnly) await ensureGroupMic();
      await requestWakeLock();
      const targets = isAdultFr
        ? state.group.members.filter((id) => id !== state.activeLineId)
        : isPlay
          ? myTreeHouseTalkPeers(state.group.members)
          : state.group.members.filter((id) => id !== state.activeLineId);
      state.group.talkPeers = targets;
      for (const other of targets) {
        await groupOfferTo(other, { recvOnly: listenOnly });
      }
      // TreeHouse is a room session even with zero talk peers (solo hangout / waiting).
      if (isPlay) markTreeHouseSessionLive();
      if (isAdultFr) state.group.adultFamilyRoom = true;
    } catch (e) {
      setFlash(e.message || "Could not join group call", "error");
      leaveGroup();
      render();
      return;
    }
  } else if (isPlay) {
    // Existing member: only mesh with talk-approved / listen path.
    const shouldOffer =
      canTalkInTreeHouse(state.activeLineId, msg.lineId) ||
      (state.group.listenOnly && (state.group.talkPeers || []).includes(msg.lineId)) ||
      Boolean(msg.listener && msg.lineId);
    // When a parent listener joins, talk peers offer TO the parent (msg.lineId).
    if (msg.listener && msg.lineId !== state.activeLineId) {
      const child = msg.listenForChildLineId;
      const iAmTarget =
        state.activeLineId === child ||
        canTalkInTreeHouse(child, state.activeLineId);
      if (iAmTarget && !state.groupPeers[msg.lineId]?.pc) {
        try {
          await groupOfferTo(msg.lineId);
        } catch (e) {
          console.warn("[playroom] listen offer failed", e);
        }
      }
    } else if (shouldOffer && msg.lineId !== state.activeLineId) {
      // New talk peer joined — joiner already offers; we wait for their offer.
    }
  }
  paintCallLayer();
}

async function onGroupOffer(msg) {
  if (!state.group || state.group.roomId !== msg.roomId) return;
  if (msg.toLineId !== state.activeLineId) return;
  try {
    const listenOnly = Boolean(state.group.listenOnly);
    if (!listenOnly) await ensureGroupMic();
    await requestWakeLock();
    const peer = await makeGroupPc(msg.fromLineId, { recvOnly: listenOnly });
    if (peer.pc.signalingState !== "stable" && peer.pc.remoteDescription) {
      console.info("[group] ignoring duplicate offer", msg.fromLineId);
      return;
    }
    await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await flushGroupIce(msg.fromLineId);
    if (peer.pc.signalingState !== "have-remote-offer") {
      console.warn("[group] cannot answer in state", peer.pc.signalingState);
      return;
    }
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
    if (state.group.familyRoom || state.group.playRoom || listenOnly) {
      markTreeHouseSessionLive();
    }
    paintCallLayer();
  } catch (e) {
    if (!isInvalidStateError(e)) console.warn("[group] offer failed", e);
  }
}

async function onGroupAnswer(msg) {
  if (!state.group || state.group.roomId !== msg.roomId) return;
  if (msg.toLineId !== state.activeLineId) return;
  const peer = state.groupPeers[msg.fromLineId];
  if (!peer?.pc) return;
  const pc = peer.pc;
  try {
    if (pc.signalingState === "stable" && pc.remoteDescription) {
      console.info("[group] ignoring duplicate answer", msg.fromLineId);
      return;
    }
    if (pc.signalingState !== "have-local-offer") {
      console.warn("[group] unexpected answer in state", pc.signalingState);
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await flushGroupIce(msg.fromLineId);
  } catch (e) {
    if (!isInvalidStateError(e)) console.warn("[group] answer failed", e);
    return;
  }
  if (state.group.status !== "active") state.group.status = "active";
  if (state.group.listenOnly) kickGroupAudio();
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
    state.speakerOn = true;
    paintCallLayer();
    applyPreferredCallAudio();
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
  state.holdByLineId = null;
  state.speakerOn = true;
  state.screen = "home";
  beginOutboundCallAudio(ids.map((_, i) => String((i % 9) + 1)).join("").slice(0, 3) || "1");
  paintCallLayer();
  requestWakeLock().catch(() => {});
  ensureGroupMic()
    .then(() => {
      unlockAudioCtx();
      applyPreferredCallAudio();
    })
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
  // Prefer Mom/Dad when the peer is a household parent with that title.
  for (const hh of state.households || []) {
    const line = (hh.lines || []).find((l) => l.id === id);
    if (line && (line.mode || "parent") !== "child") {
      const titled = parentDisplayLabel(line, hh);
      if (titled === "Mom" || titled === "Dad") return titled;
    }
  }
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
  if (label && !/^contact$/i.test(label)) {
    // Stale allowlist nickname for a Mom/Dad parent → show the title instead.
    if (entry?.target_line_id) {
      for (const hh of state.households || []) {
        const line = (hh.lines || []).find((l) => l.id === entry.target_line_id);
        if (!line || (line.mode || "parent") === "child") continue;
        const titled = parentDisplayLabel(line, hh);
        if (titled !== "Mom" && titled !== "Dad") continue;
        const bare = friendlyPersonName(label).toLowerCase();
        if (bare === titled.toLowerCase()) return titled;
        const lineBare = friendlyPersonName(line.name || line.child_label || "").toLowerCase();
        if (bare === lineBare) return titled;
        const member = (hh.members || []).find((m) => m.user_id === line.owner_user_id);
        const dn = friendlyPersonName(member?.display_name || "").toLowerCase();
        if (dn && bare === dn) return titled;
      }
    }
    return label;
  }
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
  ).filter((a) => !isHiddenTestReviewContact(a, hh));
}

/**
 * TestFlight review contact is Trevor↔test only.
 * Hide on kid pads and on every non-Trevor account (server also strips, belt-and-suspenders).
 */
function isHiddenTestReviewContact(entry, hh = state.households[0]) {
  const dir = state.directory.find((d) => d.id === entry?.target_line_id);
  const review =
    Boolean(entry?.is_test_review) ||
    Boolean(dir?.is_test_review) ||
    /^test$/i.test(String(entry?.label || "").trim());
  if (!review) return false;
  const username = String(state.user?.username || "").toLowerCase();
  if (username !== "trevor") return true;
  if (isKidExperience()) return true;
  const active = (hh?.lines || []).find((l) => l.id === state.activeLineId);
  if (active && (active.mode || "parent") === "child") return true;
  return false;
}

/** This parent’s circle from /api/me (one sphere per parent account). */
function mySphere(hh = state.households[0]) {
  if (!hh) return null;
  if (hh.my_sphere_id) {
    return (hh.spheres || []).find((s) => s.id === hh.my_sphere_id) || { id: hh.my_sphere_id, name: "My circle", is_mine: true };
  }
  return (hh.spheres || []).find((s) => s.is_mine) || null;
}

/**
 * Contacts in this parent’s circle for Parent UI.
 * Fail-open: if sphere membership isn’t tagged yet, show the full allowlist so pads/UI never go empty.
 */
function contactsInMyCircle(hh = state.households[0]) {
  const all = externalAllowlist(hh);
  const sph = mySphere(hh);
  if (!sph?.id) return all;
  const tagged = all.filter((a) => Array.isArray(a.sphere_ids) && a.sphere_ids.length);
  if (!tagged.length) return all;
  return all.filter((a) => !a.sphere_ids?.length || a.sphere_ids.includes(sph.id));
}

/** Parent → Contacts: rename circle + which circles appear on each kid’s speed dial. */
function renderParentCirclesBlock(hh, kidLines) {
  const sph = mySphere(hh);
  const spheres = hh?.spheres || [];
  const name = (sph?.name || "My circle").replace(/</g, "");
  const memberCount = Array.isArray(sph?.member_line_ids) ? sph.member_line_ids.length : contactsInMyCircle(hh).length;
  const kidBlocks =
    kidLines.length && spheres.length
      ? kidLines
          .map((l) => {
            const access = new Set(l.sphere_access || []);
            const label = (l.child_label || l.name || "Kid").replace(/</g, "");
            const checks = spheres
              .map((s) => {
                const sid = String(s.id).replace(/"/g, "");
                const sname = String(s.name || s.owner_display_name || "Circle")
                  .replace(/</g, "")
                  .replace(/"/g, "&quot;");
                const mine = s.is_mine ? " (yours)" : "";
                return `<label class="check-row"><input type="checkbox" data-kid-sphere="${l.id}" data-sphere-id="${sid}" ${
                  access.has(s.id) ? "checked" : ""
                } /> ${sname}${mine}</label>`;
              })
              .join("");
            return `<div class="parent-field" style="margin-top:10px;padding-top:10px">
              <h3 class="parent-subhead">${label}’s speed dial</h3>
              <p class="tiny">Check which parent lists this kid can call from. The same person on two lists still shows once. Unchecked lists stay off their phone.</p>
              ${checks}
              <button type="button" class="ghost" data-save-kid-spheres="${l.id}" style="margin-top:8px">Save for ${label}</button>
            </div>`;
          })
          .join("")
      : "";
  return `<div class="parent-field" style="margin-top:0;padding-top:0;border-top:0">
    <h3 class="parent-subhead">Your circle</h3>
    <p class="tiny"><strong>Mothership</strong> = the shared server. <strong>Pod</strong> = your family on it. <strong>Circle</strong> = <em>your</em> approved people for your kids — not a shared phone book. The other parent in your Pod has their own Circle.</p>
    <label>Circle name</label>
    <input id="sphere-name" maxlength="64" value="${name.replace(/"/g, "&quot;")}" placeholder="e.g. Trevor’s people" />
    <p class="tiny parent-inline-meta">${memberCount} ${memberCount === 1 ? "person" : "people"} · invite first, then both families approve</p>
    <button type="button" class="ghost" id="save-sphere-name" style="margin-top:8px">Save circle name</button>
    ${kidBlocks}
  </div>`;
}

/** Lines always allowed to join this household TreeHouse (kids only). */
function familyRoomAlwaysIds(hh = state.households[0]) {
  if (hh?.family_room_always?.length) return new Set(hh.family_room_always);
  // Fallback: child-mode lines in this household.
  return new Set(
    (hh?.lines || [])
      .filter((l) => l.id && (l.mode || "parent") === "child")
      .map((l) => l.id)
  );
}

function familyRoomApprovedIds(hh = state.households[0]) {
  const ids = new Set(familyRoomAlwaysIds(hh));
  for (const id of hh?.family_room_approved || []) ids.add(id);
  for (const m of hh?.family_room_members || []) {
    if (m?.line_id) ids.add(m.line_id);
  }
  return ids;
}

/** Parent → TreeHouse: join approvals, talk pairs, listen-only. */
function renderTreeHouseParentBlock(hh) {
  const always = familyRoomAlwaysIds(hh);
  const approved = familyRoomApprovedIds(hh);
  const candidates = [];
  const seen = new Set();
  for (const l of hh?.lines || []) {
    if (!l.id || seen.has(l.id)) continue;
    seen.add(l.id);
    const isKid = (l.mode || "parent") === "child";
    candidates.push({
      line_id: l.id,
      name: l.child_label || friendlyPersonName(l.name) || l.name,
      kind: isKid ? "kid" : "parent",
      always: isKid, // kids always join; parents use listen-only
    });
  }
  for (const a of hh?.allowlist || []) {
    if (!a.target_line_id || seen.has(a.target_line_id)) continue;
    if (isHiddenTestReviewContact(a, hh)) continue;
    if ((hh?.lines || []).some((l) => l.id === a.target_line_id)) continue;
    seen.add(a.target_line_id);
    candidates.push({
      line_id: a.target_line_id,
      name: contactDisplayName(a),
      kind: "contact",
      always: false,
    });
  }
  const joinRows = candidates
    .map((c) => {
      const locked = Boolean(c.always);
      const on = locked || approved.has(c.line_id);
      const label = String(c.name || "Line").replace(/</g, "");
      const kindLabel =
        c.kind === "parent"
          ? "parent · listen only"
          : c.kind === "kid"
            ? "kid · always allowed"
            : "family";
      const action = locked
        ? `<span class="tiny familyroom-locked-chip" title="Kids in this house can always join TreeHouse">Always on</span>`
        : c.kind === "parent"
          ? `<span class="tiny familyroom-locked-chip" title="Parents listen from the section below — they don’t join as talkers">Listen below</span>`
          : `<button type="button" class="${on ? "ghost tiny-btn danger" : "primary tiny-btn"}" data-familyroom-toggle="${c.line_id}" data-approved="${on ? "1" : "0"}">${
              on ? "Remove" : "Allow in"
            }</button>`;
      return `<li class="familyroom-approve-row${locked ? " is-always" : ""}">
        <span>${label}<small class="tiny"> · ${kindLabel}</small></span>
        ${action}
      </li>`;
    })
    .join("");

  const joinEligible = candidates.filter((c) => c.always || approved.has(c.line_id));
  const talkPairs = hh?.family_room_talk_pairs || [];
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairSet = new Set(talkPairs.map((p) => pairKey(p.line_a, p.line_b)));
  const talkKids = joinEligible.filter((c) => c.kind !== "parent");
  let talkRows = "";
  for (let i = 0; i < talkKids.length; i++) {
    for (let j = i + 1; j < talkKids.length; j++) {
      const a = talkKids[i];
      const b = talkKids[j];
      const bothHouseKids = a.always && b.always;
      const on = bothHouseKids || pairSet.has(pairKey(a.line_id, b.line_id));
      const aName = String(a.name || "").replace(/</g, "");
      const bName = String(b.name || "").replace(/</g, "");
      talkRows += `<li class="familyroom-approve-row${bothHouseKids ? " is-always" : ""}">
        <span>${aName} ↔ ${bName}${bothHouseKids ? `<small class="tiny"> · kids in this Pod</small>` : ""}</span>
        ${
          bothHouseKids
            ? `<span class="tiny familyroom-locked-chip">Always talk</span>`
            : `<button type="button" class="${on ? "ghost tiny-btn danger" : "primary tiny-btn"}" data-playroom-talk="${a.line_id}" data-playroom-talk-b="${b.line_id}" data-on="${on ? "1" : "0"}">${
                on ? "Unlink" : "Allow talk"
              }</button>`
        }
      </li>`;
    }
  }

  const live = familyRoomPresenceMembers();
  const liveSet = new Set(live);
  const kidLines = (hh?.lines || []).filter((l) => (l.mode || "parent") === "child");
  const listeningChild = state.playRoomListen?.childLineId;
  const listenRows = kidLines
    .map((l) => {
      const name = String(l.child_label || friendlyPersonName(l.name) || l.name || "Kid").replace(
        /</g,
        ""
      );
      const inRoom = liveSet.has(l.id);
      const on = listeningChild === l.id;
      return `<li class="familyroom-approve-row">
        <span>${name}<small class="tiny"> · ${inRoom ? "in TreeHouse now" : "not in room"}</small></span>
        <button type="button" class="${on ? "ghost tiny-btn danger" : "primary tiny-btn"}" data-playroom-listen="${l.id}" data-on="${on ? "1" : "0"}" ${
          !inRoom && !on ? "disabled" : ""
        }>${on ? "Stop listening" : "Listen only"}</button>
      </li>`;
    })
    .join("");

  const explicitCount = [...approved].filter((id) => !always.has(id)).length;
  return `<div class="parent-field" style="margin-top:0;padding-top:0;border-top:0">
    <p class="tiny">TreeHouse is the house button (<strong>0</strong>) — a hangout room for kids. Kids in this house can always go in. Cousins and other family need your OK first. Two kids only hear each other if you allow both (brothers and sisters always can). Parents <strong>listen only</strong>, and everyone in the room hears that a parent is listening.</p>
    <p class="tiny parent-inline-meta">${always.size} kids · ${explicitCount} contact${explicitCount === 1 ? "" : "s"} · max ${MAX_FAMILY_ROOM}${
      live.length ? ` · ${live.length} in room now` : ""
    }</p>
    <h3 class="parent-subhead" style="margin-top:12px">Who can join</h3>
    ${
      candidates.length
        ? `<ul class="guardian-list familyroom-approve-list">${joinRows}</ul>`
        : `<p class="tiny">Add a child line or invite a contact, then approve outside contacts for TreeHouse.</p>`
    }
    <h3 class="parent-subhead" style="margin-top:14px">Who can hear each other</h3>
    <p class="tiny">Kids in this house always hear each other. For cousins and friends, tap Allow talk so both sides can hear — never one-way.</p>
    ${
      talkRows
        ? `<ul class="guardian-list familyroom-approve-list">${talkRows}</ul>`
        : `<p class="tiny">Approve a contact to join first, then allow talk pairs here.</p>`
    }
    <h3 class="parent-subhead parent-subhead-with-badge" style="margin-top:14px">${withBetaBadge("Listen only")}</h3>
    <p class="tiny">Hear what your child hears. Everyone in TreeHouse hears “{child}’s parent is listening.” It is never silent.</p>
    ${
      listenRows
        ? `<ul class="guardian-list familyroom-approve-list">${listenRows}</ul>`
        : `<p class="tiny">Add a kid line to enable listen-only.</p>`
    }
  </div>`;
}

/** Household admin → FamilyRoom (# IVR): approve kids and adults. */
function renderAdultFamilyRoomParentBlock(hh) {
  if (!isHouseholdAdmin(hh)) {
    return `<p class="tiny">Only the Pod admin can choose who may enter FamilyRoom (the <strong>#</strong> button).</p>`;
  }
  const approved = adultFamilyRoomApprovedIds(hh);
  const candidates = [];
  const seen = new Set();
  for (const l of hh?.lines || []) {
    if (!l.id || seen.has(l.id)) continue;
    seen.add(l.id);
    const isKid = (l.mode || "parent") === "child";
    candidates.push({
      line_id: l.id,
      name: isKid
        ? l.child_label || friendlyPersonName(l.name) || l.name
        : parentDisplayLabel(l, hh),
      kind: isKid ? "kid" : "parent",
    });
  }
  for (const a of hh?.allowlist || []) {
    if (!a.target_line_id || seen.has(a.target_line_id)) continue;
    if (isHiddenTestReviewContact(a, hh)) continue;
    seen.add(a.target_line_id);
    candidates.push({
      line_id: a.target_line_id,
      name: contactDisplayName(a),
      kind: "contact",
    });
  }
  const kindLabel = (kind) =>
    kind === "kid" ? "kid in this house" : kind === "parent" ? "parent in this house" : "family";
  const rows = candidates
    .map((c) => {
      const on = approved.has(c.line_id);
      const label = String(c.name || "Line").replace(/</g, "");
      return `<li class="familyroom-approve-row">
        <span>${label}<small class="tiny"> · ${kindLabel(c.kind)}</small></span>
        <button type="button" class="${on ? "ghost tiny-btn danger" : "primary tiny-btn"}" data-adult-familyroom-toggle="${c.line_id}" data-approved="${on ? "1" : "0"}">${
          on ? "Remove" : "Approve"
        }</button>
      </li>`;
    })
    .join("");
  return `<div class="parent-field">
    <p class="tiny">FamilyRoom is the <strong>#</strong> button (when you’re not already on a call). After you approve someone, kids and adults can talk together. In the app they pick the family from a list. On a house phone, a voice asks them to press <strong>1</strong> for ${String(
      hh?.name || "your family"
    ).replace(/</g, "")}, or <strong>2</strong> for the other parent’s last name (or Mom / Dad if you set that in Account).</p>
    ${
      rows
        ? `<ul class="guardian-list familyroom-approve-list">${rows}</ul>`
        : `<p class="tiny">Add a household line or a contact, then approve them for FamilyRoom.</p>`
    }
  </div>`;
}

/** Sphere ids that gate the active line’s dial pad (parent = own circle; kid = attached circles). */
function activeLineSphereGateIds(hh = state.households[0]) {
  const active = (hh?.lines || []).find((l) => l.id === state.activeLineId);
  if (!active) return null;
  if ((active.mode || "parent") === "child") {
    return new Set(active.sphere_access || []);
  }
  // Parent pad: only contacts in *this* parent’s circle (co-parent contacts stay in theirs).
  if (hh?.my_sphere_id) return new Set([hh.my_sphere_id]);
  const mine = (hh?.spheres || []).find((s) => s.is_mine);
  return mine ? new Set([mine.id]) : null;
}

/** True if contact identity is visible on the active line’s pad via shared circle membership. */
function contactInActiveSphereGate(entry, hh = state.households[0]) {
  const gate = activeLineSphereGateIds(hh);
  if (!gate || !gate.size) return false;
  const ids = entry?.sphere_ids || [];
  return ids.some((id) => gate.has(id));
}

/**
 * Designated admin parent — owner’s parent line, else first parent line.
 * Kid softphone pad 1; ATA dial 1. Matches server householdAdminParentLine.
 */
function householdAdminParentLine(hh = state.households[0]) {
  const parents = (hh?.lines || [])
    .filter((l) => l.id && (l.mode || "parent") !== "child")
    .slice()
    .sort((a, b) =>
      String(a.created_at || a.id).localeCompare(String(b.created_at || b.id))
    );
  if (!parents.length) return null;
  const ownerId = hh?.owner_user_id;
  if (ownerId) {
    const ownerLine = parents.find((l) => l.owner_user_id === ownerId);
    if (ownerLine) return ownerLine;
  }
  return parents[0];
}

/** Second parent-mode line in the household (excluding admin). */
function householdSecondaryParentLine(hh = state.households[0]) {
  const admin = householdAdminParentLine(hh);
  const parents = (hh?.lines || [])
    .filter((l) => l.id && (l.mode || "parent") !== "child")
    .slice()
    .sort((a, b) =>
      String(a.created_at || a.id).localeCompare(String(b.created_at || b.id))
    );
  return parents.find((l) => l.id !== admin?.id) || null;
}

/** Slot 2 stays reserved only when another parent-mode line exists (and isn't this pad). */
function isSecondaryParentSlotReserved(hh = state.households[0]) {
  const secondary = householdSecondaryParentLine(hh);
  return Boolean(secondary && secondary.id !== state.activeLineId);
}

/** @deprecated use householdAdminParentLine */
function householdHomeParentLine(hh = state.households[0]) {
  return householdAdminParentLine(hh);
}

function parentTitleForUserId(userId, hh = state.households[0]) {
  if (!userId) return null;
  const member = (hh?.members || []).find((m) => m.user_id === userId);
  if (member?.parent_title) return member.parent_title;
  if (state.user?.id === userId && state.user?.parent_title) return state.user.parent_title;
  return null;
}

/** Mom / Dad / name for a parent-mode line. */
function parentDisplayLabel(line, hh = state.households[0]) {
  if (!line) return "Parent";
  const title = parentTitleForUserId(line.owner_user_id, hh);
  if (title === "mom") return "Mom";
  if (title === "dad") return "Dad";
  return line.child_label || friendlyPersonName(line.name) || "Parent";
}

function adultFamilyRoomApprovedIds(hh = state.households[0]) {
  return new Set(hh?.adult_family_room_approved || []);
}

function isHouseholdAdmin(hh = state.households[0]) {
  return Boolean(hh?.owner_user_id && state.user?.id === hh.owner_user_id);
}

/**
 * Primary household child for **parent** softphone pad 1.
 * Prefer: active line when it is a child; else Analog Phone target kid when set;
 * else first child by created_at then id. Additional kids fill 3–9 (TreeHouse is 0).
 */
function householdPad0ChildLine(hh = state.households[0]) {
  const kids = (hh?.lines || [])
    .filter((l) => l.id && (l.mode || "parent") === "child")
    .slice()
    .sort((a, b) =>
      String(a.created_at || a.id).localeCompare(String(b.created_at || b.id))
    );
  if (!kids.length) return null;
  const activeKid = kids.find((l) => l.id === state.activeLineId);
  if (activeKid) return activeKid;
  if (state.ataTargetLineId) {
    const ataKid = kids.find((l) => l.id === state.ataTargetLineId);
    if (ataKid) return ataKid;
  }
  return kids[0];
}

/** Next free speed-dial slot from `min`–9; marks `taken`. */
function claimSpeedDialSlot(taken, min = 2) {
  for (let s = min; s <= 9; s++) {
    if (!taken.has(s)) {
      taken.add(s);
      return s;
    }
  }
  return null;
}

/**
 * Speed-dial / call targets for the active softphone:
 * Pad 0 = TreeHouse (rendered separately). Pad 1 = locked child (parent pad) or admin parent (kid pad).
 * Pad 2 = secondary parent when present, else contacts. Pads 3–9 = kids / contacts.
 */
function dialableAllowlist(hh = state.households[0]) {
  // Parent preview: show what Grandma’s pad looks like (assigned kids on 1…n).
  if (isGpPreviewMode()) {
    const rel = gpPreviewRelative(hh);
    const kidIds = rel?.kid_line_ids || [];
    const kids = householdKidLines(hh).filter((l) => kidIds.includes(l.id));
    const ordered = kidIds
      .map((id) => kids.find((k) => k.id === id))
      .filter(Boolean);
    return ordered.map((kid, i) => ({
      id: `gp-preview-${rel.id}-${kid.id}`,
      target_line_id: kid.id,
      label: kid.child_label || friendlyPersonName(kid.name) || "Grandchild",
      speed_dial: i === 0 ? ADMIN_PARENT_SLOT : Math.min(2 + (i - 1), 9),
      favorite: 1,
      always_allow: 1,
      mutual: true,
      household_line: true,
      home_grandchild: i === 0,
      locked_slot: true,
      gp_preview: true,
    }));
  }

  const active = state.activeLineId;
  const seenTargets = new Set();
  const external = externalAllowlist(hh).filter((a) => {
    if (seenTargets.has(a.target_line_id)) return false;
    seenTargets.add(a.target_line_id);
    return true;
  });
  const adminParent = householdAdminParentLine(hh);
  const adminParentId = adminParent?.id || null;
  const secondaryParent = householdSecondaryParentLine(hh);
  const secondaryParentId =
    secondaryParent && secondaryParent.id !== active ? secondaryParent.id : null;
  const activeLine = (hh?.lines || []).find((l) => l.id === active) || null;
  const parentPad = Boolean(activeLine) && (activeLine.mode || "parent") !== "child";
  const primaryChild = parentPad ? householdPad0ChildLine(hh) : null;
  const primaryChildId = primaryChild?.id || null;

  const siblingLines = (hh?.lines || [])
    .filter((l) => l.id && l.id !== active)
    .filter((l) => l.id !== adminParentId)
    .filter((l) => l.id !== secondaryParentId)
    .filter((l) => l.id !== primaryChildId)
    .slice()
    .sort((a, b) => {
      if (parentPad) {
        const aChild = (a.mode || "parent") === "child" ? 0 : 1;
        const bChild = (b.mode || "parent") === "child" ? 0 : 1;
        if (aChild !== bChild) return aChild - bChild;
      }
      return String(a.created_at || a.id).localeCompare(String(b.created_at || b.id));
    });

  const taken = new Set([TREEHOUSE_SLOT, ADMIN_PARENT_SLOT]);
  if (secondaryParentId) taken.add(SECONDARY_PARENT_SLOT);
  const contactMin = secondaryParentId ? 3 : 2;

  const toSiblingEntry = (l, speed) => {
    const label =
      (l.mode || "parent") === "child"
        ? l.child_label || friendlyPersonName(l.name) || "Child"
        : parentDisplayLabel(l, hh);
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
    siblings = siblingLines.map((l) => toSiblingEntry(l, claimSpeedDialSlot(taken, contactMin)));
    externalsOut = external.map((a) => {
      const want = Number(a.speed_dial);
      let speed =
        Number.isInteger(want) && want >= contactMin && want <= 9 && !taken.has(want) ? want : null;
      if (speed == null) speed = claimSpeedDialSlot(taken, contactMin);
      else taken.add(speed);
      return speed === a.speed_dial ? a : { ...a, speed_dial: speed };
    });
  } else {
    for (const a of external) {
      const n = Number(a.speed_dial);
      if (Number.isInteger(n) && n >= contactMin && n <= 9) taken.add(n);
    }
    siblings = siblingLines.map((l) => toSiblingEntry(l, claimSpeedDialSlot(taken, contactMin)));
    externalsOut = external.map((a) => {
      const n = Number(a.speed_dial);
      if (n === TREEHOUSE_SLOT || n === ADMIN_PARENT_SLOT) {
        const speed = claimSpeedDialSlot(taken, contactMin);
        return speed == null ? { ...a, speed_dial: null } : { ...a, speed_dial: speed };
      }
      if (secondaryParentId && n === SECONDARY_PARENT_SLOT) {
        const speed = claimSpeedDialSlot(taken, contactMin);
        return speed == null ? { ...a, speed_dial: null } : { ...a, speed_dial: speed };
      }
      return a;
    });
  }

  const out = [...siblings, ...externalsOut];

  if (secondaryParentId && !isGrandparentExperience()) {
    out.unshift({
      id: `hh-secondary-${secondaryParentId}`,
      target_line_id: secondaryParentId,
      label: parentDisplayLabel(secondaryParent, hh),
      speed_dial: SECONDARY_PARENT_SLOT,
      favorite: 1,
      always_allow: 1,
      mutual: true,
      household_line: true,
      secondary_parent: true,
      locked_slot: true,
    });
  }

  // Grandparent pad: slot 1 = primary grandchild (circle contact), not "Add kid".
  if (parentPad && isGrandparentExperience()) {
    const gc = pickPrimaryGrandchildContact(hh, external);
    if (gc) {
      const idx = out.findIndex((e) => e.target_line_id === gc.target_line_id);
      if (idx >= 0) out.splice(idx, 1);
      taken.add(ADMIN_PARENT_SLOT);
      out.unshift({
        ...gc,
        id: gc.id || `gp-home-1-${gc.target_line_id}`,
        speed_dial: ADMIN_PARENT_SLOT,
        home_grandchild: true,
        locked_slot: true,
      });
    }
  } else if (parentPad && primaryChild && primaryChild.id !== active) {
    out.unshift({
      id: `hh-home-1-${primaryChild.id}`,
      target_line_id: primaryChild.id,
      label: primaryChild.child_label || friendlyPersonName(primaryChild.name) || "Child",
      speed_dial: ADMIN_PARENT_SLOT,
      favorite: 1,
      always_allow: 1,
      mutual: true,
      household_line: true,
      home_child: true,
      locked_slot: true,
    });
  } else if (!parentPad && adminParent && adminParent.id !== active) {
    out.unshift({
      id: `hh-home-1-${adminParent.id}`,
      target_line_id: adminParent.id,
      label: parentDisplayLabel(adminParent, hh),
      speed_dial: ADMIN_PARENT_SLOT,
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

/** Prefer a child-mode contact in this adult’s circle for pad #1. */
function pickPrimaryGrandchildContact(hh, external = externalAllowlist(hh)) {
  const list = (external || []).filter((a) => a?.target_line_id);
  if (!list.length) return null;
  const modeOf = (lineId) => {
    const dir = state.directory.find((d) => d.id === lineId);
    if (dir?.mode) return dir.mode;
    for (const h of state.households || []) {
      const line = (h.lines || []).find((l) => l.id === lineId);
      if (line) return line.mode || "parent";
    }
    return null;
  };
  const kids = list.filter((a) => modeOf(a.target_line_id) === "child");
  const pool = kids.length ? kids : list;
  const mutual = pool.filter((a) => a.mutual);
  const pick = (mutual.length ? mutual : pool).slice().sort((a, b) => {
    const as = a.speed_dial == null ? 99 : Number(a.speed_dial);
    const bs = b.speed_dial == null ? 99 : Number(b.speed_dial);
    return as - bs;
  })[0];
  return pick || null;
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
const AVATAR_HUES_MODERN = [122, 138, 148, 160, 172, 145, 40, 46];
/*
 * 90s Tech — atomic purple / grape-led fruit plastics (clear shell over dark internals).
 * Mid-dark so white initials stay readable.
 */
const AVATAR_FRUIT_RETRO = [
  { h: 268, s: 62, l: 34 }, /* Grape / atomic */
  { h: 280, s: 58, l: 36 }, /* Electric violet */
  { h: 300, s: 55, l: 34 }, /* Magenta-grape */
  { h: 328, s: 55, l: 34 }, /* Hot pink */
  { h: 218, s: 50, l: 32 }, /* Blueberry */
  { h: 118, s: 48, l: 28 }, /* Lime accent */
  { h: 352, s: 58, l: 34 }, /* Strawberry */
  { h: 24, s: 70, l: 34 }, /* Tangerine */
];
/* 70s–80s wood veneer: teak / walnut / rust — avoid bright avocado tops. */
const AVATAR_HUES_WOOD = [
  { h: 28, s: 42, l: 32 },
  { h: 18, s: 45, l: 28 },
  { h: 35, s: 40, l: 30 },
  { h: 12, s: 48, l: 30 },
  { h: 42, s: 38, l: 28 },
  { h: 22, s: 44, l: 26 },
  { h: 95, s: 28, l: 28 }, /* muted olive, not neon avocado */
  { h: 8, s: 50, l: 30 },
];
/* CGA/EGA mid tones (not #00FF00 bloom) — dark enough for white ink. */
const AVATAR_HUES_DOS = [
  { h: 120, s: 70, l: 28 },
  { h: 55, s: 75, l: 32 },
  { h: 180, s: 65, l: 30 },
  { h: 300, s: 55, l: 32 },
  { h: 0, s: 70, l: 32 },
  { h: 210, s: 65, l: 34 },
  { h: 90, s: 55, l: 28 },
  { h: 40, s: 80, l: 32 },
];
/* 16-bit jewel tones — capped lightness for white pixel labels. */
const AVATAR_HUES_BIT = [
  { h: 330, s: 65, l: 34 },
  { h: 210, s: 70, l: 36 },
  { h: 140, s: 55, l: 30 },
  { h: 45, s: 70, l: 34 },
  { h: 270, s: 60, l: 36 },
  { h: 15, s: 75, l: 34 },
  { h: 185, s: 55, l: 30 },
  { h: 300, s: 55, l: 34 },
];
/* Aero / Frutiger — sky, teal, lime, soft violet (mid-dark for white ink). */
const AVATAR_HUES_AERO = [
  { h: 200, s: 58, l: 36 },
  { h: 175, s: 48, l: 34 },
  { h: 145, s: 42, l: 32 },
  { h: 220, s: 50, l: 38 },
  { h: 260, s: 40, l: 36 },
  { h: 25, s: 55, l: 38 },
  { h: 190, s: 52, l: 32 },
  { h: 320, s: 35, l: 36 },
];
/* Classic 80s windbreaker — teal, purple, cream, navy (mid-dark for white ink). */
const AVATAR_HUES_WINDBREAKER = [
  { h: 168, s: 72, l: 28 },
  { h: 280, s: 58, l: 30 },
  { h: 210, s: 45, l: 26 },
  { h: 175, s: 55, l: 32 },
  { h: 295, s: 50, l: 28 },
  { h: 40, s: 35, l: 36 },
  { h: 160, s: 60, l: 26 },
  { h: 265, s: 48, l: 32 },
];
/* Millennial greige — near-zero chroma charcoal/taupe (dark enough for white ink). */
const AVATAR_HUES_MILLENNIAL = [
  { h: 40, s: 6, l: 32 },
  { h: 30, s: 4, l: 28 },
  { h: 200, s: 5, l: 30 },
  { h: 0, s: 0, l: 26 },
  { h: 50, s: 8, l: 34 },
  { h: 220, s: 4, l: 28 },
  { h: 25, s: 5, l: 30 },
  { h: 0, s: 0, l: 36 },
];
/* iTunes / Aqua metal — steel blues + classic Aqua candy (mid-dark for white ink). */
const AVATAR_HUES_TUNES = [
  { h: 210, s: 35, l: 36 },
  { h: 205, s: 55, l: 38 },
  { h: 220, s: 20, l: 32 },
  { h: 200, s: 45, l: 34 },
  { h: 230, s: 25, l: 30 },
  { h: 195, s: 40, l: 36 },
  { h: 215, s: 50, l: 40 },
  { h: 0, s: 0, l: 34 },
];
/* Xenon / Zenon Y2K future — hot magenta, electric violet, neon cyan (mid-dark). */
const AVATAR_HUES_XENON = [
  { h: 300, s: 70, l: 36 },
  { h: 280, s: 65, l: 34 },
  { h: 190, s: 70, l: 32 },
  { h: 320, s: 60, l: 38 },
  { h: 260, s: 55, l: 36 },
  { h: 175, s: 55, l: 30 },
  { h: 330, s: 65, l: 34 },
  { h: 220, s: 40, l: 36 },
];
/* GBA / Pokémon — LCD olive, menu blue, fire red, electric yellow (mid-dark). */
const AVATAR_HUES_GBA = [
  { h: 120, s: 40, l: 28 },
  { h: 210, s: 55, l: 34 },
  { h: 5, s: 70, l: 36 },
  { h: 48, s: 70, l: 34 },
  { h: 140, s: 35, l: 30 },
  { h: 230, s: 45, l: 32 },
  { h: 25, s: 60, l: 34 },
  { h: 280, s: 30, l: 30 },
];
/* 80s Dad — denim, burgundy, forest polo, khaki (mid-dark). */
const AVATAR_HUES_DAD = [
  { h: 215, s: 45, l: 34 },
  { h: 350, s: 50, l: 30 },
  { h: 145, s: 40, l: 28 },
  { h: 40, s: 25, l: 36 },
  { h: 220, s: 35, l: 30 },
  { h: 0, s: 45, l: 32 },
  { h: 160, s: 30, l: 28 },
  { h: 30, s: 20, l: 34 },
];
/* Emo / Hot Topic — black, maroon, purple, hot pink undertone (mid-dark). */
const AVATAR_HUES_EMO = [
  { h: 0, s: 0, l: 18 },
  { h: 340, s: 55, l: 28 },
  { h: 280, s: 40, l: 26 },
  { h: 320, s: 60, l: 32 },
  { h: 0, s: 5, l: 22 },
  { h: 350, s: 45, l: 30 },
  { h: 260, s: 35, l: 28 },
  { h: 0, s: 0, l: 26 },
];
/* TomSpace / MySpace — hot pink, magenta, purple, lime, cyan clash. */
const AVATAR_HUES_TOMSPACE = [
  { h: 320, s: 90, l: 42 },
  { h: 300, s: 85, l: 38 },
  { h: 280, s: 70, l: 40 },
  { h: 190, s: 85, l: 38 },
  { h: 100, s: 80, l: 36 },
  { h: 340, s: 75, l: 40 },
  { h: 260, s: 65, l: 42 },
  { h: 210, s: 90, l: 42 },
];
/* Craig / Craigslist — link blue, visited purple, gray result rows. */
const AVATAR_HUES_CRAIG = [
  { h: 240, s: 90, l: 42 },
  { h: 275, s: 68, l: 32 },
  { h: 0, s: 0, l: 38 },
  { h: 210, s: 35, l: 40 },
  { h: 30, s: 12, l: 42 },
  { h: 250, s: 55, l: 36 },
  { h: 0, s: 0, l: 48 },
  { h: 200, s: 40, l: 36 },
];
/* Backrooms — sickly yellow / olive / brown (mid-dark for white ink). */
const AVATAR_HUES_BACKROOMS = [
  { h: 48, s: 45, l: 32 },
  { h: 40, s: 35, l: 28 },
  { h: 70, s: 30, l: 30 },
  { h: 30, s: 40, l: 26 },
  { h: 55, s: 50, l: 34 },
  { h: 25, s: 25, l: 28 },
  { h: 80, s: 28, l: 30 },
  { h: 35, s: 38, l: 30 },
];

/* Cartoon Pop — saturated toon candy (mid for white ink). */
const AVATAR_HUES_CARTOON = [
  { h: 210, s: 90, l: 48 },
  { h: 350, s: 85, l: 48 },
  { h: 45, s: 95, l: 48 },
  { h: 145, s: 70, l: 38 },
  { h: 280, s: 70, l: 48 },
  { h: 20, s: 90, l: 48 },
  { h: 190, s: 75, l: 40 },
  { h: 320, s: 70, l: 46 },
];
/* Baja — tropical cyan / teal / lime (mid for white ink). */
/* Baja — neon teal liquid / electric lime / deep wave (mid for dark ink). */
const AVATAR_HUES_BAJA = [
  { h: 176, s: 95, l: 34 },
  { h: 172, s: 80, l: 28 },
  { h: 78, s: 95, l: 42 },
  { h: 180, s: 70, l: 26 },
  { h: 168, s: 85, l: 32 },
  { h: 72, s: 90, l: 38 },
  { h: 185, s: 55, l: 24 },
  { h: 160, s: 70, l: 30 },
];
/* Coaster — park lawn / dirt / wood / sky (mid for white ink). */
const AVATAR_HUES_COASTER = [
  { h: 105, s: 45, l: 32 },
  { h: 30, s: 40, l: 34 },
  { h: 195, s: 55, l: 38 },
  { h: 45, s: 70, l: 40 },
  { h: 25, s: 35, l: 30 },
  { h: 85, s: 40, l: 30 },
  { h: 15, s: 45, l: 36 },
  { h: 210, s: 40, l: 36 },
];
/* 2013 flat UI — saturated solid app-icon hues (mid for white ink). */
const AVATAR_HUES_FLAT = [
  { h: 211, s: 100, l: 42 },
  { h: 4, s: 90, l: 48 },
  { h: 145, s: 70, l: 36 },
  { h: 280, s: 65, l: 42 },
  { h: 35, s: 95, l: 48 },
  { h: 190, s: 80, l: 38 },
  { h: 340, s: 75, l: 48 },
  { h: 0, s: 0, l: 32 },
];
/* ADA high contrast — solid primary hues with white ink (never pastel). */
const AVATAR_HUES_HC = [
  { h: 210, s: 100, l: 32 },
  { h: 0, s: 85, l: 38 },
  { h: 140, s: 70, l: 28 },
  { h: 45, s: 100, l: 38 },
  { h: 280, s: 70, l: 36 },
  { h: 190, s: 90, l: 30 },
  { h: 25, s: 95, l: 40 },
  { h: 0, s: 0, l: 18 },
];

function avatarHueIndex(seed, len) {
  let h = 0;
  const s = String(seed || "x");
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * 17) % len;
  return h;
}

/** Always pair fill + ink so theme skins never strand black-on-black or white-on-lime. */
function avatarStyle(seed) {
  const theme = getUiTheme();
  const inkLight = "color:#fff;text-shadow:0 1px 1px rgba(0,0,0,0.45);";
  if (theme === "retro90s") {
    const fruit = AVATAR_FRUIT_RETRO[avatarHueIndex(seed, AVATAR_FRUIT_RETRO.length)];
    return `${inkLight}background:linear-gradient(145deg,hsl(${fruit.h} ${fruit.s}% ${fruit.l + 4}%),hsl(${fruit.h} ${fruit.s + 4}% ${fruit.l - 6}%));`;
  }
  if (theme === "wood70s") {
    const w = AVATAR_HUES_WOOD[avatarHueIndex(seed, AVATAR_HUES_WOOD.length)];
    return `${inkLight}background:linear-gradient(145deg,hsl(${w.h} ${w.s}% ${w.l + 4}%),hsl(${w.h} ${w.s + 4}% ${w.l - 8}%));`;
  }
  if (theme === "dos80s") {
    const d = AVATAR_HUES_DOS[avatarHueIndex(seed, AVATAR_HUES_DOS.length)];
    return `${inkLight}background:linear-gradient(180deg,hsl(${d.h} ${d.s}% ${d.l + 4}%),hsl(${d.h} ${d.s}% ${d.l - 6}%));`;
  }
  if (theme === "bit1632") {
    const b = AVATAR_HUES_BIT[avatarHueIndex(seed, AVATAR_HUES_BIT.length)];
    return `${inkLight}background:linear-gradient(180deg,hsl(${b.h} ${b.s}% ${b.l + 4}%),hsl(${b.h} ${b.s}% ${b.l - 6}%));`;
  }
  if (theme === "aero2000s") {
    const a = AVATAR_HUES_AERO[avatarHueIndex(seed, AVATAR_HUES_AERO.length)];
    return `${inkLight}background:linear-gradient(160deg,hsl(${a.h} ${a.s}% ${a.l + 10}%) 0%,hsl(${a.h} ${a.s + 5}% ${a.l}%) 55%,hsl(${a.h} ${a.s}% ${a.l - 8}%) 100%);`;
  }
  if (theme === "windbreaker80s") {
    const w = AVATAR_HUES_WINDBREAKER[avatarHueIndex(seed, AVATAR_HUES_WINDBREAKER.length)];
    return `${inkLight}background:linear-gradient(145deg,hsl(${w.h} ${w.s}% ${w.l + 6}%) 0%,hsl(${w.h} ${w.s + 4}% ${w.l}%) 50%,hsl(${w.h} ${w.s}% ${w.l - 8}%) 100%);`;
  }
  if (theme === "millennialGray") {
    const g = AVATAR_HUES_MILLENNIAL[avatarHueIndex(seed, AVATAR_HUES_MILLENNIAL.length)];
    return `${inkLight}background:linear-gradient(180deg,hsl(${g.h} ${g.s}% ${g.l + 6}%),hsl(${g.h} ${g.s}% ${g.l - 6}%));`;
  }
  if (theme === "tunes2000s") {
    const t = AVATAR_HUES_TUNES[avatarHueIndex(seed, AVATAR_HUES_TUNES.length)];
    return `${inkLight}background:linear-gradient(180deg,hsl(${t.h} ${t.s}% ${t.l + 12}%) 0%,hsl(${t.h} ${t.s + 5}% ${t.l}%) 48%,hsl(${t.h} ${t.s}% ${t.l - 10}%) 100%);`;
  }
  if (theme === "xenon2000s") {
    const x = AVATAR_HUES_XENON[avatarHueIndex(seed, AVATAR_HUES_XENON.length)];
    return `${inkLight}background:linear-gradient(145deg,hsl(${x.h} ${x.s}% ${x.l + 10}%) 0%,hsl(${x.h} ${x.s}% ${x.l}%) 50%,hsl(${(x.h + 40) % 360} ${x.s - 10}% ${x.l - 8}%) 100%);`;
  }
  if (theme === "gba2000s") {
    const g = AVATAR_HUES_GBA[avatarHueIndex(seed, AVATAR_HUES_GBA.length)];
    return `${inkLight}background:linear-gradient(180deg,hsl(${g.h} ${g.s}% ${g.l + 6}%),hsl(${g.h} ${g.s}% ${g.l - 6}%));`;
  }
  if (theme === "dad80s") {
    const d = AVATAR_HUES_DAD[avatarHueIndex(seed, AVATAR_HUES_DAD.length)];
    return `${inkLight}background:linear-gradient(145deg,hsl(${d.h} ${d.s}% ${d.l + 6}%),hsl(${d.h} ${d.s + 4}% ${d.l - 8}%));`;
  }
  if (theme === "emo2000s") {
    const e = AVATAR_HUES_EMO[avatarHueIndex(seed, AVATAR_HUES_EMO.length)];
    return `${inkLight}background:linear-gradient(160deg,hsl(${e.h} ${e.s}% ${e.l + 8}%),hsl(${e.h} ${e.s}% ${e.l - 6}%));`;
  }
  if (theme === "tomspace") {
    const t = AVATAR_HUES_TOMSPACE[avatarHueIndex(seed, AVATAR_HUES_TOMSPACE.length)];
    return `${inkLight}background:linear-gradient(145deg,hsl(${t.h} ${t.s}% ${t.l + 10}%),hsl(${(t.h + 40) % 360} ${t.s - 5}% ${t.l - 8}%));`;
  }
  if (theme === "craigslist") {
    const c = AVATAR_HUES_CRAIG[avatarHueIndex(seed, AVATAR_HUES_CRAIG.length)];
    return `${inkLight}background:hsl(${c.h} ${c.s}% ${c.l}%);`;
  }
  if (theme === "flat2013") {
    /* Candy tile (--pad-flat) is the fill — no second dark circle on the key. */
    return "color:#fff;background:transparent;";
  }
  if (theme === "highContrast" || theme === "highContrastDark") {
    /* Pad face carries the color — initials stay white, no nested disc. */
    return "color:#fff;font-weight:800;background:transparent;";
  }
  if (theme === "backrooms") {
    /* Fluorescent tile (--pad-br) is the fill — no second muddy circle. */
    return "color:#1a1408;background:transparent;";
  }
  if (theme === "cartoon2000s") {
    return "color:#fff;text-shadow:1px 1px 0 rgba(26,26,46,0.35);background:transparent;";
  }
  if (theme === "coaster") {
    /* Bright circular toolbar buttons — tile color from --pad-co, not a second fill. */
    return "color:#fff;text-shadow:1px 1px 0 rgba(0,0,0,0.45);background:transparent;";
  }
  if (theme === "baja") {
    return "color:#fff;text-shadow:0 1px 1px rgba(2,26,28,0.45);background:transparent;";
  }
  if (theme === "windbreaker80s") {
    return "color:#fff;text-shadow:0 1px 1px rgba(4,30,26,0.45);background:transparent;";
  }
  if (theme === "dad80s") {
    return "color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.45);background:transparent;";
  }
  if (theme === "bit1632") {
    return "color:#fff;text-shadow:1px 1px 0 rgba(0,0,0,0.45);background:transparent;";
  }
  const hue = AVATAR_HUES_MODERN[avatarHueIndex(seed, AVATAR_HUES_MODERN.length)];
  const amber = hue < 60;
  const okish = hue >= 140 && hue <= 150;
  const satTop = amber ? 44 : okish ? 38 : 34;
  const lightTop = amber ? 28 : okish ? 34 : 30;
  const satBot = amber ? 38 : okish ? 32 : 28;
  const lightBot = amber ? 13 : okish ? 16 : 14;
  return `color:var(--ink);background:linear-gradient(145deg,hsl(${hue} ${satTop}% ${lightTop}%),hsl(${hue} ${satBot}% ${lightBot}%));`;
}

/** Re-apply initials/avatar face colors after a theme switch (inline styles). */
function refreshAvatarPalettes(root = document) {
  root.querySelectorAll("[data-avatar-seed]").forEach((el) => {
    const seed = el.getAttribute("data-avatar-seed");
    if (seed == null) return;
    el.style.cssText = avatarStyle(seed);
  });
}

function avatarHtml(name, seed, sizeClass = "", photoUrl = null) {
  const url = photoUrl === undefined || photoUrl === null ? lineAvatarUrl(seed) : photoUrl;
  if (url) {
    return `<div class="avatar has-photo ${sizeClass}" aria-hidden="true"><img src="${url}" alt="" /></div>`;
  }
  const seedAttr = String(seed ?? name ?? "x").replace(/"/g, "");
  return `<div class="avatar ${sizeClass}" data-avatar-seed="${seedAttr}" style="${avatarStyle(seed)}" aria-hidden="true">${initials(name)}</div>`;
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
 * Peer line has an ATA (FXS) — soft hold must use bridged Asterisk MOH, not WebRTC replaceTrack.
 * Cap/WKWebView MediaStreamDestination tracks are often silent after mute.
 */
function peerLineHasAta(lineId) {
  if (!lineId) return false;
  const fromHh = allAccessibleLines().find((l) => l.id === lineId);
  if (fromHh?.ata?.sip_extension) return true;
  const fromDir = (state.directory || []).find((d) => d.id === lineId);
  if (fromDir?.ata?.sip_extension) return true;
  if (state.ataStatusByLine?.[lineId]?.sip_extension) return true;
  return false;
}

/** Soft-initiated hold → bridge (same shape as bridged notifySoftphoneHold). */
function notifySoftphoneHold(onHold, byLineId) {
  const call = state.call;
  if (!call || state.group) return;
  if (!state.ws || state.ws.readyState !== 1) return;
  const fromLineId = call.fromLineId || state.activeLineId;
  const toLineId =
    call.toLineId === state.activeLineId ? call.fromLineId : call.toLineId;
  try {
    const payload = {
      type: "call.hold",
      callId: call.callId,
      fromLineId,
      toLineId,
      onHold: Boolean(onHold),
    };
    if (byLineId) payload.byLineId = byLineId;
    state.ws.send(JSON.stringify(payload));
  } catch (err) {
    console.warn("[hold] call.hold send failed", err);
  }
}

/** Directory / household mode for a line id. */
function lineModeOf(lineId) {
  if (!lineId) return null;
  const fromDir = (state.directory || []).find((d) => d.id === lineId);
  if (fromDir?.mode) return fromDir.mode;
  for (const h of state.households || []) {
    const line = (h.lines || []).find((l) => l.id === lineId);
    if (line) return line.mode || "parent";
  }
  const fromAll = allAccessibleLines().find((l) => l.id === lineId);
  return fromAll?.mode || null;
}

function lineIsChild(lineId) {
  return (lineModeOf(lineId) || "parent") === "child";
}

/**
 * Held party normally has no Resume (they didn't put anyone on hold).
 * Exception: parent/grandparent may override a child's hold.
 */
function canOverrideRemoteHold() {
  if (!state.onHold || !state.holdByLineId) return false;
  if (state.holdByLineId === state.activeLineId) return false;
  if (isKidExperience()) return false;
  return lineIsChild(state.holdByLineId);
}

/** Show Hold, or Resume when we control the hold (initiator or adult override). */
function shouldShowHoldControl() {
  if (!state.onHold) return true;
  if (state.holdByLineId === state.activeLineId) return true;
  return canOverrideRemoteHold();
}

function holdControlLabel() {
  return state.onHold ? "Resume" : "Hold";
}

/**
 * 90s office hold music (synthesized) — soft electric-piano muzak loop.
 * Routed to a MediaStreamTrack for the *remote* party via replaceTrack — not local speakers.
 * Soft↔soft only; soft↔ATA uses Asterisk MOH via call.hold.
 * @returns {Promise<MediaStreamTrack | null>}
 */
async function startHoldMusic() {
  stopHoldMusic();
  try {
    const ctx = ensureAudioCtx();
    if (!ctx) return null;
    // Cap/WKWebView: destination tracks are silent unless the context is running.
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn("[hold] AudioContext resume failed", err);
      }
    }
    if (ctx.state !== "running") {
      console.warn("[hold] AudioContext not running before MOH destination", ctx.state);
    }

    const master = ctx.createGain();
    // Cap iOS: slightly higher gain — MediaStreamDestination often attenuates.
    master.gain.value = isNativeIosShell() ? 0.32 : 0.22;
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
  } catch (err) {
    console.warn("[hold] startHoldMusic failed", err);
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
      const remoteEl = typeof remoteAudio === "function" ? remoteAudio() : document.getElementById("remote-audio");
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

/** TreeHouse (familyroom/playroom) — hold would mute the whole mesh; not allowed. */
function isTreeHouseSession() {
  return Boolean(state.group?.familyRoom || state.group?.playRoom || state.playRoomListen);
}

async function applyHoldAudio() {
  // TreeHouse: never put the room on hold (no MOH swap / remote mute).
  if (isTreeHouseSession()) {
    if (state.onHold) {
      state.onHold = false;
      state.holdByLineId = null;
      stopHoldMusic();
      setOutboundMicEnabled(!state.muted);
      const audio = remoteAudio();
      if (audio) audio.muted = false;
      for (const el of groupAudioRoot()?.querySelectorAll("audio") || []) el.muted = false;
    }
    return;
  }
  if (state.onHold) {
    // Holder: silence remote earpiece + stop sending mic.
    setOutboundMicEnabled(false);
    const audio = remoteAudio();
    if (audio) audio.muted = true;
    for (const el of groupAudioRoot()?.querySelectorAll("audio") || []) el.muted = true;
    const ataPeer = peerLineHasAta(otherLineId(state.call));
    if (ataPeer) {
      // Soft↔ATA: bridge plays Asterisk MOH on FXS — Cap replaceTrack MOH is often silent.
      stopHoldMusic();
    } else {
      // Soft↔soft: synthesize hold music onto the outbound track.
      const musicTrack = await startHoldMusic();
      if (musicTrack) await replaceOutboundAudio(musicTrack);
    }
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
  if (isTreeHouseSession()) return;
  if (state.onHold && !shouldShowHoldControl()) return;
  const next = !state.onHold;
  if (next) {
    state.onHold = true;
    state.holdByLineId = state.activeLineId || null;
    notifySoftphoneHold(true, state.holdByLineId);
    void applyHoldAudio();
  } else {
    // Holder resume, or adult override of a child's hold.
    state.onHold = false;
    state.holdByLineId = null;
    notifySoftphoneHold(false, state.activeLineId);
    void applyHoldAudio();
  }
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

/**
 * Grandparent / relative UX: phone + messages first; Settings (not Parent) with
 * Quiet Time, Analog, approve family. Explicit profile_role wins; otherwise any
 * adult household with no kid lines (invite-only relatives).
 * Parents can also preview a provisioned grandparent’s chrome (session only).
 */
function isGpPreviewMode() {
  return Boolean(state.gpPreviewRelativeId) && !isKidExperience();
}

function gpPreviewRelative(hh = state.households[0]) {
  const id = state.gpPreviewRelativeId;
  if (!id) return null;
  return (hh?.provisioned_relatives || []).find((r) => r.id === id) || null;
}

function exitGpPreview() {
  state.gpPreviewRelativeId = "";
  state._forceFullParentSettings = false;
  state.nav = "controls";
  localStorage.setItem("kl_nav", "controls");
  state.parentAccOpen = "parent-grandparents";
  state.parentScrollTo = "parent-grandparents";
  setFlash("Back to your parent phone", "ok");
  render();
}

function startGpPreview(relativeId) {
  const hh = state.households[0];
  const rel = (hh?.provisioned_relatives || []).find((r) => r.id === relativeId);
  if (!rel) {
    setFlash("Grandparent not found", "error");
    render();
    return;
  }
  state.managingGrandparentId = relativeId;
  state.gpPreviewRelativeId = relativeId;
  state.nav = "phone";
  localStorage.setItem("kl_nav", "phone");
  state.screen = "home";
  setFlash(
    `Preview: ${rel.display_label || rel.display_name}'s phone — tap Exit preview when done`,
    "ok"
  );
  render();
}

function gpPreviewBannerHtml() {
  if (!isGpPreviewMode()) return "";
  const rel = gpPreviewRelative();
  const name = String(rel?.display_label || rel?.display_name || "Grandparent").replace(/</g, "");
  return `<div class="gp-preview-banner" role="status">
    <div>
      <strong>Previewing ${name}’s phone</strong>
      <span class="tiny">Looks like their simple version. Calls and Settings changes are off here — edit login and kids under Manage.</span>
    </div>
    <button type="button" class="primary" id="exit-gp-preview">Exit preview</button>
  </div>`;
}

function bindGpPreviewChrome() {
  document.getElementById("exit-gp-preview")?.addEventListener("click", () => exitGpPreview());
}

function isGrandparentExperience() {
  if (isKidExperience()) return false;
  if (isGpPreviewMode()) return true;
  const role = String(state.user?.profile_role || "").toLowerCase();
  if (role === "grandparent") return true;
  if (role === "parent") return false;
  const hh = state.households[0];
  if (!hh) return false;
  return householdKidLines(hh).length === 0;
}

/**
 * Plain wording for late Gen X / Boomer / Silent Gen.
 * Short sentences, no tech slang, no “circles / VIP / adapter / speed dial.”
 */
function gpEsc(s) {
  return String(s || "").replace(/</g, "");
}

function gpCallName(contactOrName) {
  if (!contactOrName) return "them";
  if (typeof contactOrName === "string") return gpEsc(contactOrName);
  return gpEsc(contactDisplayName(contactOrName) || "them");
}

/** Family invites are parent-only (never kid line accounts). */
function canInviteFamily() {
  return Boolean(state.user) && !isKidExperience() && !isGrandparentExperience();
}

/** SVG QR for invite/join URLs — large enough to scan across a table. */
function inviteQrSvg(url) {
  if (!url) return "";
  try {
    return toSvg(String(url), {
      errorCorrectionLevel: "M",
      margin: 2,
      moduleSize: 10,
      foreground: "#0b1611",
      background: "#ffffff",
    });
  } catch {
    return "";
  }
}

function paintInviteQr(elOrId, url) {
  const el = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  const svg = inviteQrSvg(url);
  if (!svg) {
    el.replaceChildren();
    el.setAttribute("hidden", "");
    return;
  }
  el.removeAttribute("hidden");
  el.innerHTML = svg;
  el.setAttribute("aria-label", `QR code for invite link`);
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
  if (lock && pageScrollTop() > 0) {
    window.scrollTo(0, 0);
    if (document.body) document.body.scrollTop = 0;
    if (document.documentElement) document.documentElement.scrollTop = 0;
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

/** Header wordmark only — taps go to Phone dialer via bindAppChrome / leave-vm.
 * Rotary mark lives on the Phone dock tab (not header chrome). */
function homeBrandLockupHtml() {
  return `<button type="button" class="home-brand-lockup" aria-label="Phone dialer" title="Phone dialer">
        <span class="mark wordmark home-wordmark">Phone<span>Home</span></span>
      </button>`;
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
      ${homeBrandLockupHtml()}
      <div class="who">${escapeWho(who)}</div>
    </div>`;
}

/** Dock / section pages — always show PhoneHome, with the page name as subtitle. */
function pageBrandHtml(sectionWho) {
  return `
    <div class="home-brand">
      ${homeBrandLockupHtml()}
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

function deleteAccountConfirmOk(value) {
  return String(value ?? "").trim().toLowerCase() === "delete";
}

function bindDeleteAccountConfirm() {
  const input = document.getElementById("delete-account-confirm");
  const btn = document.getElementById("delete-parent-account");
  if (!input || !btn) return;
  const sync = () => {
    btn.disabled = !deleteAccountConfirmOk(input.value);
  };
  sync();
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !btn.disabled) {
      e.preventDefault();
      btn.click();
    }
  });
}

async function confirmAndDeleteParentAccount() {
  const input = document.getElementById("delete-account-confirm");
  const typed = input?.value ?? "";
  if (!deleteAccountConfirmOk(typed)) {
    setFlash('Type "delete" to confirm account deletion', "error");
    input?.focus();
    return false;
  }
  try {
    await api("/api/account/delete", {
      method: "POST",
      body: JSON.stringify({ confirm: typed.trim() }),
    });
    hardReleaseMicStream();
    state.sessionId = "";
    state.user = null;
    state.households = [];
    state.childMode = false;
    await clearPersistedAuth({ keepLogin: false });
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
  void syncIosAppBadge();
  if (isNativeIosShell() && !callKitEnabled()) void registerIosApnsToken(lastIosApnsToken);
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

/** Kid on a house phone — shared by splash and How it works slide 1. */
function splashStoryHtml() {
  return `<figure class="splash-story">
    <div class="splash-story-hero">
      <img src="/assets/analog/kid-landline.jpg" width="1400" height="933" alt="A young kid talking on a house landline phone" />
    </div>
  </figure>`;
}

function tutorialBrandSlide() {
  return TUTORIAL_SLIDES.find((s) => s.id === "brand") || TUTORIAL_SLIDES[0];
}

/** Kicker / title / body — same type as How it works slides. */
function tutorialSlideCopyHtml(slide) {
  const kicker = slide.beta
    ? `<p class="tutorial-kicker">${slide.kicker} ${betaBadgeHtml()}</p>`
    : `<p class="tutorial-kicker">${slide.kicker}</p>`;
  return `
    ${kicker}
    <h2 class="tutorial-title">${slide.title}</h2>
    <p class="tutorial-lead">${slide.body}</p>`;
}

/** Splash and How it works #1 share this hero (rotary + photo). */
function brandSplashHeroHtml() {
  return `
    ${splashBrandHeroHtml({ compact: true })}
    ${splashStoryHtml()}`;
}

function ht801ProductThumbsHtml() {
  return `<ul class="ata-photos-thumbs">
    <li><img src="/assets/analog/ht801-v2-1.png" width="500" height="500" alt="Grandstream HT801 v2, angled top view" /></li>
    <li><img src="/assets/analog/ht801-v2-2.png" width="500" height="500" alt="Grandstream HT801 v2 top: POWER, PHONE, and NET lights" /></li>
    <li><img src="/assets/analog/ht801-v2-3.png" width="500" height="500" alt="Grandstream HT801 v2 back: NET ethernet, reset, power, and phone jack" /></li>
  </ul>`;
}

/** Kid on a house phone + official Grandstream HT801 v2 product shots. */
function analogPhotosHtml() {
  return `<figure class="ata-photos">
    <div class="ata-photos-hero">
      <img src="/assets/analog/kid-landline.jpg" width="1400" height="933" alt="A young kid talking on a house landline phone" />
      <figcaption class="ata-photos-caption">The house phone kids actually pick up.</figcaption>
    </div>
    <div class="ata-photos-product" role="group" aria-label="Grandstream HT801 v2 analog adapter">
      <p class="tiny ata-photos-product-label">The box it plugs into — Grandstream HT801 v2</p>
      ${ht801ProductThumbsHtml()}
    </div>
  </figure>`;
}

function ataShopSearchLinksHtml(extraClass = "") {
  const cls = ["ata-shop-links", extraClass].filter(Boolean).join(" ");
  return `<div class="${cls}" role="group" aria-label="Search for Grandstream HT801 v2">
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
      <p class="tiny ata-intro-compact-text"><strong>Need an adapter?</strong> Search for Grandstream HT801 v2:</p>
      ${ataShopSearchLinksHtml("ata-shop-links-inline")}
    </div>`;
  }
  return `<div class="ata-intro" id="ata-intro" role="region" aria-labelledby="ata-intro-title">
    <h3 class="parent-subhead" id="ata-intro-title">What is Analog Phone?</h3>
    <p class="ata-intro-body">A regular house phone (corded or cordless) plugs into a small <strong>Grandstream HT801 v2</strong> box. PhoneHome talks to that box — you don’t plug the house phone into the iPhone.</p>
    <p class="tiny">The box is about the size of a deck of cards. It needs a home Ethernet cable (and its power brick).</p>
    <p class="tiny ata-intro-shop-label">Find a Grandstream HT801 v2:</p>
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
    (search: Grandstream HT801 v2)
  </p>`;
}

/** Click-path for the HT801 v2 web admin (same Wi-Fi as the box). */
function analogHt801AdminStepsHtml({ purpose = "upload" } = {}) {
  const afterLogin =
    purpose === "config-path"
      ? `<li>On the left, tap <strong>Maintenance</strong>, then <strong>Upgrade</strong>.</li>
  <li>Set <strong>Config Upgrade via</strong> to <strong>HTTPS</strong>.</li>
  <li>Paste the copied link into <strong>Config Server Path</strong>.</li>
  <li>Leave <strong>Firmware Server Path</strong> empty.</li>
  <li>Tap <strong>Save</strong> and <strong>Apply</strong>, then reboot the box.</li>`
      : `<li>On the left, tap <strong>Maintenance</strong>, then <strong>Upgrade</strong>.</li>
  <li>Scroll to <strong>Upload Configuration</strong> (not Firmware, not Config Server Path).</li>
  <li>Tap <strong>Upload</strong> / Choose File and pick the <span class="mono">config.xml</span> you just downloaded.</li>
  <li>Wait until it finishes. If it asks, tap <strong>Reboot</strong> (or left menu <strong>Maintenance → Reboot</strong>).</li>`;
  return `<ol class="ata-admin-steps">
  <li>Plug a regular phone into the <strong>green PHONE jack</strong> on the back of the box.</li>
  <li>Pick up. Dial <span class="mono">***</span> (three stars). Wait for “Enter the menu option.”</li>
  <li>Dial <span class="mono">02</span>. It reads the box’s IP (like <span class="mono">192.168.1.50</span>).</li>
  <li>On a phone or laptop on the <strong>same Wi‑Fi</strong> as the box, open a browser and go to <span class="mono">https://</span> that IP.</li>
  <li>If you see a certificate warning, tap <strong>Advanced</strong>, then <strong>Proceed</strong> / Continue — the box uses its own certificate.</li>
  <li>Username: <span class="mono">admin</span>. Password: the sticker on the <strong>bottom</strong> of the box (or the one you chose last time).</li>
  ${afterLogin}
</ol>
<p class="tiny">Older HT801 (tabs across the top, no left menu): open the <strong>Maintenance</strong> tab, then look for <strong>Upload Configuration</strong>.</p>`;
}

function analogFanvilAdminStepsHtml() {
  return `<ol class="ata-admin-steps">
  <li>Find the G100S IP (sticker or your router’s device list).</li>
  <li>On the same Wi‑Fi, open <span class="mono">https://</span> that IP.</li>
  <li>Log in (sticker password).</li>
  <li>Go to <strong>System → Backup / Flash</strong>.</li>
  <li>Under Import, choose the <span class="mono">.txt</span> you downloaded, then apply and reboot.</li>
</ol>`;
}

function addKidCardHtml({ prominent = false } = {}) {
  return `<div class="add-kid-card${prominent ? " add-kid-card-empty" : " parent-field"}" id="add-kid">
  <h3 class="parent-subhead">${prominent ? "Who’s the kid?" : "Add another kid"}</h3>
  <p class="tiny">${
    prominent
      ? "Type their first name. PhoneHome makes <strong>their</strong> phone — yours stays yours."
      : "Another child in this family. Their phone stays separate from yours."
  }</p>
  <form id="add-kid-form" class="add-kid-form">
    <label for="add-kid-name">First name</label>
    <input id="add-kid-name" maxlength="64" placeholder="e.g. Maya" autocomplete="given-name" enterkeyhint="done" required />
    <button type="submit" class="primary" id="add-kid-btn">${prominent ? "Add kid" : "Add another kid"}</button>
  </form>
</div>`;
}

/** Kid lines in this household (for Contacts / Kids UI — not only Analog targets). */
function householdKidLines(hh = state.households[0]) {
  return (hh?.lines || []).filter((l) => (l.mode || "parent") === "child");
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
      detail: "Add a kid first (Parent → Kids), then link an adapter.",
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
        ? `Saved (ext ${ext}) but not registered yet — tap Download config, upload on the box, then reboot. Wait about a minute.`
        : "Saved but not registered yet — Download config, upload on the box, reboot.",
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
    if (entryOrId.household_line || entryOrId.home_parent || entryOrId.home_child || entryOrId.locked_slot)
      return false;
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
    const activeLine = (hh.lines || []).find((l) => l.id === state.activeLineId);
    const parentPad = Boolean(activeLine) && (activeLine.mode || "parent") !== "child";
    setFlash(
      String(entryId).startsWith("hh-home-0-")
        ? parentPad
          ? "Pad 0 is locked to the household child"
          : "Home (0) is locked to the parent line"
        : "House lines keep their own slots — drag external contacts only",
      "warn"
    );
    return;
  }
  const slot = Number(toSlot);
  if (slot === TREEHOUSE_SLOT) {
    setFlash("Pad 0 is TreeHouse — contacts use 2–9", "warn");
    return;
  }
  if (slot === ADMIN_PARENT_SLOT) {
    setFlash("Pad 1 is locked to the household child or parent", "warn");
    return;
  }
  if (slot === SECONDARY_PARENT_SLOT && isSecondaryParentSlotReserved(hh)) {
    setFlash("Pad 2 is reserved for the co-parent when present", "warn");
    return;
  }
  if (!Number.isInteger(slot) || slot < 2 || slot > 9) {
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
    if (
      !Number.isInteger(toSlot) ||
      toSlot < 2 ||
      toSlot === TREEHOUSE_SLOT ||
      toSlot === ADMIN_PARENT_SLOT ||
      (toSlot === SECONDARY_PARENT_SLOT && isSecondaryParentSlotReserved()) ||
      toSlot === fromSlot ||
      slotEl.hasAttribute("data-familyroom")
    ) {
      return;
    }
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
      if (
        slotN === TREEHOUSE_SLOT ||
        slotN === ADMIN_PARENT_SLOT ||
        (slotN === SECONDARY_PARENT_SLOT && isSecondaryParentSlotReserved()) ||
        slotN === fromSlot
      )
        return;
      if (s.hasAttribute("data-familyroom")) return;
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
      toSlot >= 2 &&
      toSlot <= 9 &&
      toSlot !== TREEHOUSE_SLOT &&
      toSlot !== ADMIN_PARENT_SLOT &&
      !(toSlot === SECONDARY_PARENT_SLOT && isSecondaryParentSlotReserved()) &&
      toSlot !== fromSlot &&
      !target?.hasAttribute("data-familyroom")
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

  // TreeHouse (#1): never rearrangeable. Parent long-press → Parent → TreeHouse.
  root.querySelectorAll(".speed-slot[data-familyroom]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      if (isKidExperience() || isChildMode()) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const pointerId = e.pointerId;
      let armed = false;
      let cancelledEarly = false;
      const prevTouchAction = el.style.touchAction;
      el.style.touchAction = "none";

      const armTimer = setTimeout(() => {
        if (cancelledEarly) return;
        armed = true;
        suppressClickUntil = Date.now() + 450;
        if (navigator.vibrate) navigator.vibrate(28);
        void openParentPanel({ scrollTo: "parent-treehouse" });
      }, LONG_MS);

      const teardown = () => {
        clearTimeout(armTimer);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        el.style.touchAction = prevTouchAction;
      };

      const onMove = (ev) => {
        if (ev.pointerId !== pointerId) return;
        if (armed) return;
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (dist > CANCEL_PX) {
          cancelledEarly = true;
          clearTimeout(armTimer);
          el.style.touchAction = prevTouchAction;
        }
      };
      const onUp = (ev) => {
        if (ev.pointerId !== pointerId) return;
        teardown();
        if (armed) suppressClickUntil = Date.now() + 450;
      };
      const onCancel = (ev) => {
        if (ev.pointerId !== pointerId) return;
        teardown();
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    });
  });

  root.querySelectorAll(".speed-slot[data-entry], .contact-tile[data-entry]").forEach((el) => {
    const entryId = el.getAttribute("data-entry");
    if (!entryId) return;
    // Locked pad 0 (Home/parent on kid pads, child on parent pads) — not rearrangeable.
    if (String(entryId).startsWith("hh-home-0-") || el.classList.contains("slot-locked")) return;
    // TreeHouse is fixed at pad 0 — never drag/reorder.
    if (el.hasAttribute("data-familyroom") || Number(el.getAttribute("data-slot")) === TREEHOUSE_SLOT) {
      return;
    }
    const rawSlot = el.getAttribute("data-slot");
    const fromSlot = rawSlot != null && rawSlot !== "" ? Number(rawSlot) : null;
    if (fromSlot === TREEHOUSE_SLOT || fromSlot === ADMIN_PARENT_SLOT) return;
    if (fromSlot === SECONDARY_PARENT_SLOT && isSecondaryParentSlotReserved()) return;

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
  // Parent pad synthesizes primary household child onto locked pad 1.
  // Do NOT use dialableAllowlist(activeLine): when Gemma’s line is active, she is
  // omitted from her own pad and this step never completes.
  const childOnDial0 = (() => {
    if (!hasChild) return false;
    const parentLine = (hh?.lines || []).find((l) => (l.mode || "parent") !== "child");
    if (!parentLine) return true; // child-only household — pad synthesis still applies
    const saved = state.activeLineId;
    state.activeLineId = parentLine.id;
    try {
      const slot1 = dialableAllowlist(hh).find((a) => Number(a.speed_dial) === ADMIN_PARENT_SLOT);
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
      label: "Create your sign-in",
      detail: accountDone ? "Username saved" : "Pick a username and password",
      done: accountDone,
      scrollTo: "parent-account",
      required: true,
    },
    {
      id: "child",
      label: "Add a kid",
      detail: hasChild
        ? childLines.length === 1
          ? childLines[0].child_label || childLines[0].name || "Kid ready"
          : `${childLines.length} kids`
        : "A kid’s app or house phone",
      done: hasChild,
      scrollTo: "parent-kids",
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
      label: "Kid on speed dial",
      detail: childOnDial0
        ? "Your kid is on button 1"
        : hasChild
          ? "Your kid should appear on button 1"
          : "Add a kid first — they land on button 1",
      done: childOnDial0,
      scrollTo: hasChild ? "parent-people" : "parent-kids",
      required: true,
    },
    {
      id: "hours",
      label: "Quiet Time schedule",
      detail: scheduleDone
        ? hh.schedule_preset && hh.schedule_preset !== "open"
          ? `Schedule · ${hh.schedule_preset}`
          : "Quiet Time set"
        : "Pick bedtime or school hours for your kids",
      done: scheduleDone,
      scrollTo: "parent-hours",
      required: true,
    },
    {
      id: "sounds",
      label: "Ringer & greeting",
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
    {
      id: "analog",
      label: "House phone",
      detail: hasAta ? "Adapter connected" : "Optional — analog adapter later",
      done: hasAta,
      scrollTo: "parent-ata",
      required: false,
    },
  ];
}

/**
 * Grandparent / relative checklist — not the parent “add a kid / PIN” board.
 * Only: know your login, get family on the phone, optional quiet / house phone.
 */
function grandparentSetupSteps(hh = state.households[0]) {
  const user = state.user;
  const accountDone = Boolean(user?.username && user?.has_password);
  const gc = pickPrimaryGrandchildContact(hh);
  const pending = pendingApprovals(hh);
  const familyDone = Boolean(gc && (gc.mutual || gc.home_grandchild));
  const familyName = gc ? contactDisplayName(gc) : "";
  const quietOn = Boolean(hh?.dnd);
  const hasAta = (hh?.lines || []).some((l) => l.ata);

  return [
    {
      id: "account",
      label: "How you sign in",
      detail: accountDone
        ? `Your name to sign in is ${gpEsc(user.username)}`
        : "Ask your son or daughter for the name and password they made for you",
      done: accountDone,
      action: "account",
      required: true,
    },
    {
      id: "family",
      label: familyDone ? "Your family is ready" : "Add your family",
      detail: familyDone
        ? familyName
          ? `${gpEsc(familyName)} is button 1 — tap it once to call`
          : "Ready — tap button 1 to call"
        : pending.length
          ? "Tap Yes, add them — then use button 1 to call"
          : "When your family shows up, tap Yes, add them",
      done: familyDone,
      action: "family",
      required: true,
    },
    {
      id: "quiet",
      label: "Silence the phone",
      detail: quietOn
        ? "On — your phone will not ring until you turn this off"
        : "Optional — stop the phone from ringing for a while",
      done: quietOn,
      action: "quiet",
      required: false,
    },
    {
      id: "analog",
      label: "Old-fashioned house phone",
      detail: hasAta
        ? "Connected"
        : "Optional — only if you also use a regular wall phone",
      done: hasAta,
      action: "analog",
      required: false,
    },
  ];
}


/** Setup steps for the current experience (parent vs grandparent). */
function setupStepsForUser(hh = state.households[0]) {
  return isGrandparentExperience() ? grandparentSetupSteps(hh) : parentSetupSteps(hh);
}

function parentSetupSummary(hh = state.households[0]) {
  const steps = setupStepsForUser(hh);
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
    grandparent: isGrandparentExperience(),
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

/** Full setup board from Help / banner — not auto-opened after sign-in. */
function shouldShowSetupBoard(hh = state.households[0]) {
  if (!state.user || !hh) return false;
  if (isKidExperience() || isChildMode()) return false;
  if (!hh.lines?.length) return false;
  const { allRequiredDone } = parentSetupSummary(hh);
  if (allRequiredDone && !state.setupForceShow) return false;
  if (state.setupForceShow) return true;
  return !setupChecklistDismissed() && !allRequiredDone;
}

/** Compact home banner while required setup is still incomplete. */
function shouldShowSetupBanner(hh = state.households[0]) {
  if (!state.user || !hh) return false;
  if (isKidExperience() || isChildMode()) return false;
  if (state.screen === "setup") return false;
  // Grandparents: prefer the big “add family” banner when someone is waiting.
  if (isGrandparentExperience() && pendingApprovals(hh).length) return false;
  return !parentSetupSummary(hh).allRequiredDone;
}

function setupBannerHtml(hh) {
  if (!shouldShowSetupBanner(hh)) return "";
  const { requiredDone, requiredTotal, openRequired, pct, grandparent } = parentSetupSummary(hh);
  const next = openRequired[0];
  const nextLabel = next ? next.label : grandparent ? "Almost done" : "Finish setup";
  const title = grandparent ? "A few steps to get started" : "Finish setup";
  return `<button type="button" class="setup-banner${grandparent ? " gp-setup-banner" : ""}" id="open-setup-banner" aria-label="${title}, ${requiredDone} of ${requiredTotal} done. Next: ${nextLabel}">
    <span class="setup-banner-meta">
      <strong>${title}</strong>
      <small>${grandparent ? nextLabel : `${requiredDone}/${requiredTotal} · ${nextLabel}`}</small>
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
 * Jump from a grandparent setup step into the right simple screen.
 * @param {string} action
 */
async function runGrandparentSetupAction(action) {
  state.setupForceShow = false;
  dismissSetupChecklist();
  if (action === "family") {
    state.screen = "manage-contacts";
    state.nav = "phone";
    render();
    return;
  }
  if (action === "account" || action === "quiet") {
    state.screen = "home";
    state.nav = "controls";
    localStorage.setItem("kl_nav", "controls");
    state.gpSettingsFocus = action;
    render();
    return;
  }
  if (action === "analog") {
    await openParentPanel({ scrollTo: "parent-ata" });
    return;
  }
  state.screen = "home";
  state.nav = "phone";
  localStorage.setItem("kl_nav", "phone");
  render();
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

/** Auto-open Approve was trapping adults (esp. grandparents) in a full-screen
 *  contacts page with no dock. Prefer an on-home banner instead. */
function shouldAutoOpenApprovals(_hh) {
  return false;
}

function markApprovalsPrompted(hh) {
  const key = pendingApprovalKey(hh);
  if (key) sessionStorage.setItem("kl_pending_prompt", key);
  else sessionStorage.removeItem("kl_pending_prompt");
}

/** Big home banner: approve grandchild / family without leaving Phone. */
function pendingApprovalsBannerHtml(hh) {
  if (isKidExperience()) return "";
  const pending = pendingApprovals(hh);
  if (!pending.length) return "";
  const first = pending[0];
  const name = friendlyPersonName(first.name).replace(/</g, "");
  const more = pending.length > 1 ? ` (+${pending.length - 1} more)` : "";
  const lead = isGrandparentExperience()
    ? `<strong>${name}</strong>${more} can be added to your phone`
    : `<strong>${name}</strong>${more} needs your OK to call`;
  return `<div class="gp-approve-banner" role="region" aria-label="${
    isGrandparentExperience() ? "Add family to your phone" : "Approve family"
  }">
    <p>${lead}</p>
    <div class="gp-approve-actions">
      <button type="button" class="primary" id="banner-approve-first">${
        isGrandparentExperience()
          ? pending.length === 1
            ? `Yes, add ${name}`
            : "Yes, add them"
          : `Approve${pending.length === 1 ? ` ${name}` : ""}`
      }</button>
      <button type="button" class="ghost" id="banner-open-approvals">${
        isGrandparentExperience() ? "See who" : "Review"
      }</button>
      <button type="button" class="ghost" id="banner-later-approvals">Not now</button>
    </div>
  </div>`;
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
  if ((line.mode || "parent") !== "child") {
    const ok = confirm(
      "This locks THIS phone as a kid phone.\n\nTo add a kid and keep your parent phone, cancel and use Parent → Kids."
    );
    if (!ok) return;
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

/**
 * Identity of the call sheet layout. Same key ⇒ keep DOM (presence/render used to
 * remount and restart sheetPresent, which looked like the incoming sheet flickering).
 */
function callLayerMountKey() {
  if (
    callKitOwnsUi() &&
    state.call &&
    !state.group &&
    state.call.status === "incoming" &&
    !callKitGate.answered
  ) {
    return `hidden-callkit:${state.call.callId || ""}`;
  }
  if (state.group) {
    const status = state.group.status || "calling";
    const isFr = Boolean(state.group.familyRoom || state.group.playRoom);
    const listenOnly = Boolean(state.group.listenOnly);
    const hostId = state.group.hostLineId || state.group.fromLineId || "";
    const members = state.group.members || [];
    const invited = (state.group.invited || []).filter((id) => !members.includes(id));
    const people = [...members, ...invited.map((id) => `w:${id}`)].join(",");
    const phase =
      status === "incoming" ? "incoming" : status === "active" || status === "connecting" ? "in-call" : "outbound";
    return `g:${state.group.roomId || ""}:${phase}:${status}:${isFr ? 1 : 0}:${listenOnly ? 1 : 0}:${hostId}:${people}`;
  }
  if (!state.call) {
    if (state.vmMonitor?.role === "callee") {
      return `vm:${state.vmMonitor.callId || state.vmMonitor.fromLineId || ""}`;
    }
    return "empty";
  }
  let status = state.call.status;
  if (callKitOwnsUi() && callKitGate.answered && status === "incoming") {
    status = "connecting";
  }
  const phase =
    status === "incoming" ? "incoming" : status === "active" || status === "connecting" ? "in-call" : "outbound";
  return `c:${state.call.callId || ""}:${phase}:${status}:${otherLineId(state.call) || ""}`;
}

/** Soft-update labels/banners without remounting (mute, hold, ICE hint, etc.). */
function patchCallLayerChrome() {
  const layer = document.getElementById("call-layer");
  if (!layer) return;

  const muteBtn = document.getElementById("mute");
  if (muteBtn) muteBtn.textContent = state.muted ? "Unmute" : "Mute";

  const holdBtn = document.getElementById("hold");
  if (holdBtn) holdBtn.textContent = holdControlLabel();

  const speakerBtn = document.getElementById("speaker");
  if (speakerBtn) {
    speakerBtn.setAttribute("aria-pressed", state.speakerOn ? "true" : "false");
    speakerBtn.textContent = state.speakerOn ? "Earpiece" : "Speaker";
  }

  const identity = layer.querySelector(".call-identity");
  if (identity) {
    let still = identity.querySelector(".still-banner");
    if (state.stillPrompt && !still) {
      still = document.createElement("p");
      still.className = "still-banner";
      still.textContent = "Are you still there?";
      identity.appendChild(still);
    } else if (!state.stillPrompt && still) {
      still.remove();
    }

    const isFr = Boolean(state.group?.familyRoom || state.group?.playRoom);
    const wantHold = state.group ? Boolean(!isFr && state.onHold) : Boolean(state.onHold);
    let holdBanner = identity.querySelector(".hold-banner");
    if (wantHold && !holdBanner) {
      holdBanner = document.createElement("p");
      holdBanner.className = "hold-banner";
      holdBanner.textContent = "On hold";
      identity.appendChild(holdBanner);
    } else if (!wantHold && holdBanner) {
      holdBanner.remove();
    }
  }

  if (state.call && !state.group) {
    let status = state.call.status;
    if (callKitOwnsUi() && callKitGate.answered && status === "incoming") {
      status = "connecting";
    }
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
    const kicker = layer.querySelector(".call-kicker");
    if (kicker) kicker.textContent = title;

    const mediaHint =
      state.iceState === "connected"
        ? "Private · encrypted voice"
        : state.iceState === "disconnected"
          ? "Reconnecting…"
          : status === "connecting"
            ? "Setting up a private line…"
            : status === "incoming"
              ? "Someone you approved is calling"
              : "Waiting for them to pick up…";
    const media = layer.querySelector(".call-media");
    if (media) media.textContent = mediaHint;
  } else if (state.group?.familyRoom || state.playRoomListen) {
    patchTreeHouseCallLayerPresence();
  } else if (state.group) {
    const status = state.group.status || "calling";
    const isFr = Boolean(state.group.familyRoom || state.group.playRoom);
    const listenOnly = Boolean(state.group.listenOnly);
    const members = state.group.members || [];
    const media = layer.querySelector(".call-media");
    if (media && status !== "incoming") {
      media.textContent = listenOnly
        ? `Hearing ${state.playRoomListen?.childName || "your child"}’s mix`
        : isFr
          ? `${members.length} in TreeHouse`
          : `${members.length} on the line`;
    }
  }
}

/** Mark first paint only — CSS .call-enter runs a short fade; remounts stay still. */
function armCallLayerEnterAnimation(layer) {
  if (!layer || layer.dataset.entered === "1") return;
  layer.dataset.entered = "1";
  layer.classList.add("call-enter");
  const clear = () => layer.classList.remove("call-enter");
  layer.addEventListener("animationend", clear, { once: true });
  setTimeout(clear, 500);
}

function paintCallLayer() {
  const root = callRoot();
  if (!root) return;
  const mountKey = callLayerMountKey();
  const existing = document.getElementById("call-layer");
  // Hard lock while softphone is ringing: never tear down the sheet for key churn.
  const ringLock =
    !callKitOwnsUi() &&
    ((state.call?.status === "incoming" && state.call?.callId) ||
      (state.group?.status === "incoming" && state.group?.roomId));
  const ringId = state.group?.status === "incoming"
    ? `g:${state.group.roomId}`
    : state.call?.status === "incoming"
      ? `c:${state.call.callId}`
      : "";
  if (ringLock && existing && existing.dataset.ringId === ringId) {
    root.dataset.paintKey = mountKey;
    root.hidden = false;
    patchCallLayerChrome();
    return;
  }
  // Presence refresh / duplicate offer / toast paint must not restart enter anim.
  if (root.dataset.paintKey === mountKey) {
    if (mountKey !== "empty" && !mountKey.startsWith("hidden-callkit") && !mountKey.startsWith("vm:")) {
      patchCallLayerChrome();
    }
    return;
  }
  root.dataset.paintKey = mountKey;

  // Native iOS + CallKit ON: system Answer/Decline while ringing. After answer,
  // iOS foregrounds the app — show mute/hold/end. CallKit OFF (default): always
  // show in-app softphone ring/answer card (alert APNs wake).
  if (mountKey.startsWith("hidden-callkit")) {
    stopRing();
    root.innerHTML = "";
    root.hidden = true;
    return;
  }
  root.hidden = false;
  if (state.group) {
    const status = state.group.status || "calling";
    const isFr = Boolean(state.group.familyRoom || state.group.playRoom);
    const listenOnly = Boolean(state.group.listenOnly);
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
    const roomLabel = isFr ? "TreeHouse" : "Group call";
    const title =
      status === "incoming"
        ? roomLabel
        : listenOnly
          ? `Listening · ${state.playRoomListen?.childName || who}`
          : status === "active"
            ? roomLabel
            : status === "connecting"
              ? listenOnly
                ? "Starting listen…"
                : "Connecting…"
              : isFr
                ? "Joining TreeHouse…"
                : "Calling group…";
    const timer =
      state.callStartedAt && inCall
        ? formatDuration(Date.now() - state.callStartedAt)
        : inCall
          ? "0:00"
          : "";
    root.innerHTML = `
      <div id="call-layer" class="call-stage group ${status}${isFr ? " familyroom" : ""}${listenOnly ? " listen-only" : ""}" data-ring-id="${
        status === "incoming" ? `g:${state.group.roomId || ""}` : ""
      }">
        <div class="call-stage-bg" aria-hidden="true"></div>
        <div class="call-card cinematic">
          <div class="call-identity">
          <p class="call-kicker">${title}</p>
          <div class="group-avatars ${ringing ? "pulse" : ""}">
            ${people
              .map(
                (p) => `
              <div class="group-avatar-item ${p.waiting ? "waiting" : ""} ${
                  isFr &&
                  !listenOnly &&
                  p.id !== state.activeLineId &&
                  members.length > 1 &&
                  !canTalkInTreeHouse(state.activeLineId, p.id)
                    ? "muted-peer"
                    : ""
                }">
                ${avatarHtml(lineName(p.id), p.id, "lg")}
                <span>${p.id === state.activeLineId ? "You" : lineName(p.id)}</span>
              </div>`
              )
              .join("")}
          </div>
          <h2 class="call-who">${
            status === "incoming" ? who : listenOnly ? "Listen only" : isFr ? "TreeHouse" : "Group"
          }</h2>
          <p class="call-media">${
            status === "incoming"
              ? "Join this group call?"
              : listenOnly
                ? `Hearing ${state.playRoomListen?.childName || "your child"}’s mix`
                : isFr
                  ? `${members.length} in TreeHouse`
                  : `${members.length} on the line`
          }</p>
          ${timer ? `<p class="call-timer" id="call-timer">${timer}</p>` : ""}
          ${state.stillPrompt ? `<p class="still-banner">Are you still there?</p>` : ""}
          ${!isFr && state.onHold ? `<p class="hold-banner">On hold</p>` : ""}
          </div>
          <div class="call-actions ${status === "incoming" ? "incoming" : inCall ? "in-call" : "outbound"}">
            ${
              inCall && !listenOnly
                ? `<div class="call-secondary">
            ${
              status === "active" && !isFr && shouldShowHoldControl()
                ? `<button class="ghost" id="hold">${holdControlLabel()}</button>`
                : ""
            }
            <button class="ghost" id="mute">${state.muted ? "Unmute" : "Mute"}</button>
            ${
              isNativeIosShell() && callKitEnabled()
                ? `<button class="ghost" id="speaker" aria-pressed="${state.speakerOn ? "true" : "false"}">${
                    state.speakerOn ? "Earpiece" : "Speaker"
                  }</button>`
                : ""
            }
            </div>`
                : inCall && listenOnly
                  ? `<div class="call-secondary">
            ${
              isNativeIosShell() && callKitEnabled()
                ? `<button class="ghost" id="speaker" aria-pressed="${state.speakerOn ? "true" : "false"}">${
                    state.speakerOn ? "Earpiece" : "Speaker"
                  }</button>`
                : ""
            }
            </div>`
                  : ""
            }
            ${status === "incoming" ? `<button type="button" class="danger call-hangup" id="hangup">Decline</button>` : ""}
            ${status === "incoming" ? `<button type="button" class="primary call-answer" id="accept">Answer</button>` : ""}
            ${
              status !== "incoming"
                ? hangupButtonHtml(
                    undefined,
                    listenOnly ? "Stop listening" : isFr ? "Leave" : "Hang up"
                  )
                : ""
            }
          </div>
        </div>
      </div>`;
    armCallLayerEnterAnimation(document.getElementById("call-layer"));
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
    document.getElementById("speaker")?.addEventListener("click", toggleSpeaker);
    return;
  }
  if (!state.call) {
    if (state.vmMonitor?.role === "callee") paintVmMonitor();
    else root.innerHTML = "";
    return;
  }
  let status = state.call?.status;
  // Brief window: CallKit answered but acceptCall has not yet set connecting.
  if (callKitOwnsUi() && callKitGate.answered && status === "incoming") {
    status = "connecting";
  }
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
            ? "Someone you approved is calling"
            : "Waiting for them to pick up…";
  const ringing = status === "incoming" || status === "ringing" || status === "calling";

  root.innerHTML = `
    <div id="call-layer" class="call-stage ${status}" data-ring-id="${
      status === "incoming" ? `c:${state.call.callId || ""}` : ""
    }">
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
          ${
            status === "active" && shouldShowHoldControl()
              ? `<button class="ghost" id="hold">${holdControlLabel()}</button>`
              : ""
          }
          <button class="ghost" id="mute">${state.muted ? "Unmute" : "Mute"}</button>
          ${
            isNativeIosShell() && callKitEnabled()
              ? `<button class="ghost" id="speaker" aria-pressed="${state.speakerOn ? "true" : "false"}">${
                  state.speakerOn ? "Earpiece" : "Speaker"
                }</button>`
              : ""
          }
          </div>`
              : ""
          }
          ${status === "incoming" ? `<button type="button" class="danger call-hangup" id="hangup">Decline</button>` : ""}
          ${status === "incoming" ? `<button type="button" class="primary call-answer" id="accept">Answer</button>` : ""}
          ${status !== "incoming" ? hangupButtonHtml() : ""}
        </div>
      </div>
    </div>`;

  armCallLayerEnterAnimation(document.getElementById("call-layer"));
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
  document.getElementById("speaker")?.addEventListener("click", toggleSpeaker);
}

function renderWelcome() {
  const invite = new URLSearchParams(location.search).get("invite") || "";
  const showHost = new URLSearchParams(location.search).get("host") === "1";
  app.innerHTML = `
    <div class="auth-screen" id="welcome-root">
      <div class="auth-hero welcome-hero">
        ${splashBrandHeroHtml({ compact: true })}
        <p class="auth-promise">The home phone, reborn.</p>
        <p class="auth-sub">Family & trusted friends · app or analog · no strangers</p>
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
            ? `<button class="linkish auth-link" type="button" id="go-host">Set up a Mothership (setup code)</button>`
            : `<details class="welcome-advanced"><summary>Advanced</summary>
                <button class="linkish auth-link" type="button" id="go-host">Set up a Mothership (setup code)</button>
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
        <button type="button" class="primary btn-block faceid-btn" id="faceid-login" hidden></button>
        <p class="tiny auth-or" id="faceid-or" hidden>or type your password</p>
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
        <p class="tiny auth-hint" id="faceid-setup-hint" hidden>Sign in once on this iPhone to turn on Face ID for next time.</p>
        <p class="tiny auth-hint" id="forget-saved-login" hidden>
          <button type="button" class="linkish" id="forget-login">Forget saved sign-in on this iPhone</button>
        </p>
        <p class="tiny auth-hint">Forgot password? Ask whoever runs the Mothership — they can reset it.</p>
        <nav class="auth-alt" aria-label="Other sign-in options">
          <button type="button" class="linkish auth-link" id="go-register">Create an account</button>
          <button type="button" class="linkish auth-link" id="use-code">Use 6-digit code instead</button>
        </nav>
      </div>
      <div class="sheet auth-sheet auth-code-sheet" id="code-sheet" hidden>
        <div class="auth-head">
          <h2>6-digit code</h2>
          <p class="auth-lede">Mothership setup code, or an older one-time login code.</p>
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
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await persistSession(data.sessionId);
      const saved = await persistPasswordLogin(username, password);
      if (saved) setFlash("Face ID sign-in is ready on this iPhone", "ok");
      else if (isNativeIosShell()) {
        setFlash("Signed in, but Face ID could not save a password. Open Parent → Account.", "warn");
      }
      await refresh();
      if (state.pendingGuardianCode) {
        try {
          await api("/api/guardian-invites/redeem", {
            method: "POST",
            body: JSON.stringify({ code: state.pendingGuardianCode }),
          });
          setFlash("You’re now a co-parent for that kid", "ok");
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
      await persistSession(data.sessionId);
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
  const userEl = document.getElementById("username");
  if (userEl && lastUsername()) userEl.value = lastUsername();
  void setupFaceIdLogin();
  queueMicrotask(() => document.getElementById("username")?.focus());
}

function faceIdButtonLabel(biometry) {
  if (biometry === "touch") return "Sign in with Touch ID";
  if (biometry === "passcode") return "Sign in with device passcode";
  return "Sign in with Face ID";
}

async function setupFaceIdLogin() {
  const btn = document.getElementById("faceid-login");
  const or = document.getElementById("faceid-or");
  const forgetWrap = document.getElementById("forget-saved-login");
  const forgetBtn = document.getElementById("forget-login");
  const plugin = await nativePluginReady();
  if (!btn || !plugin?.hasSavedLogin) return;
  let info = { saved: false, username: "", biometry: "none" };
  try {
    info = await plugin.hasSavedLogin();
  } catch {
    return;
  }
  if (!info?.saved) {
    const hint = document.getElementById("faceid-setup-hint");
    if (hint) hint.hidden = false;
    return;
  }
  btn.hidden = false;
  if (or) or.hidden = false;
  if (forgetWrap) forgetWrap.hidden = false;
  btn.textContent = faceIdButtonLabel(info.biometry);
  const named = document.getElementById("username");
  if (named && info.username && !named.value) named.value = info.username;
  const runFaceId = async () => {
    setFlash("");
    try {
      const creds = await plugin.getLogin({ reason: "Sign in to PhoneHome" });
      const username = String(creds?.username || "").trim();
      const password = String(creds?.password || "");
      if (!username || !password) throw new Error("No saved sign-in");
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await persistSession(data.sessionId);
      await persistPasswordLogin(username, password);
      await refresh();
    } catch (e) {
      const msg = String(e?.message || "");
      if (/cancel/i.test(msg)) return;
      setFlash(msg || "Could not sign in with Face ID", "error");
      render();
    }
  };
  btn.onclick = () => void runFaceId();
  if (forgetBtn) {
    forgetBtn.onclick = async () => {
      await clearPersistedAuth({ keepLogin: false });
      btn.hidden = true;
      if (or) or.hidden = true;
      forgetWrap.hidden = true;
    };
  }
  if (info.biometry !== "none" && !faceIdAutoTried) {
    faceIdAutoTried = true;
    queueMicrotask(() => void runFaceId());
  }
}

function faceIdKindLabel(biometry) {
  if (biometry === "touch") return "Touch ID";
  if (biometry === "passcode") return "device passcode";
  if (biometry === "optic") return "Optic ID";
  return "Face ID";
}

async function bindFaceIdAccountSettings() {
  const status = document.getElementById("faceid-account-status");
  const enableWrap = document.getElementById("faceid-enable-wrap");
  const forgetBtn = document.getElementById("faceid-forget");
  const enableBtn = document.getElementById("faceid-enable");
  if (!status) return;
  const plugin = await nativePluginReady();
  if (!plugin?.saveLogin && !plugin?.hasSavedLogin) {
    status.textContent = "This iPhone app build cannot save Face ID yet. Reinstall PhoneHome from Xcode.";
    return;
  }
  const username = String(state.user?.username || "").trim();
  let info = { saved: false, username: "", biometry: "none" };
  try {
    info = (await plugin.hasSavedLogin?.()) || info;
  } catch {
    status.textContent = "Could not check Face ID on this iPhone.";
    return;
  }
  const kind = faceIdKindLabel(info.biometry);
  if (info.saved) {
    status.textContent = `${kind} is ready for ${info.username || username || "this account"}.`;
    if (enableWrap) enableWrap.hidden = true;
    if (forgetBtn) forgetBtn.hidden = false;
  } else if (!username) {
    status.textContent = "Create a username and password first, then you can save Face ID on this iPhone.";
    if (enableWrap) enableWrap.hidden = true;
  } else {
    status.textContent = `${kind} needs your password saved once on this iPhone.`;
    if (enableWrap) enableWrap.hidden = false;
  }
  if (forgetBtn && !forgetBtn.dataset.bound) {
    forgetBtn.dataset.bound = "1";
    forgetBtn.addEventListener("click", async () => {
      try {
        await plugin.clearLogin?.();
      } catch {
        /* ignore */
      }
      setFlash("Face ID sign-in forgotten on this iPhone", "ok");
      await bindFaceIdAccountSettings();
    });
  }
  if (enableBtn && !enableBtn.dataset.bound) {
    enableBtn.dataset.bound = "1";
    enableBtn.addEventListener("click", async () => {
      const password = document.getElementById("faceid-enable-pass")?.value || "";
      if (!password) {
        setFlash("Enter your password", "warn");
        return;
      }
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
        await persistSession(data.sessionId);
        const saved = await persistPasswordLogin(username, password);
        const passEl = document.getElementById("faceid-enable-pass");
        if (passEl) passEl.value = "";
        if (saved) setFlash("Face ID sign-in is ready on this iPhone", "ok");
        else setFlash("Password was correct, but this iPhone could not save it. Rebuild the PhoneHome app.", "error");
        await bindFaceIdAccountSettings();
      } catch (e) {
        setFlash(e.message || "That password did not work", "error");
      }
    });
  }
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
      await persistSession(data.sessionId);
      await persistPasswordLogin(
        document.getElementById("reg-user").value.trim(),
        document.getElementById("reg-pass").value
      );
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
        <p class="tiny auth-hint">Forgot later? Ask the Mothership admin to reset your password.</p>
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
      const saved = await persistPasswordLogin(
        needsUser ? document.getElementById("set-user").value.trim() : state.user?.username,
        document.getElementById("set-pass").value
      );
      setFlash(
        saved
          ? "Login saved — Face ID sign-in is ready on this iPhone."
          : "Login saved — use username and password next time.",
        "ok"
      );
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

/**
 * Canonical rotary desk-phone glyph (Trevor SVG → /rotary-phone.svg).
 * Used in Phone dock tab, splash hero, Parent → Analog Phone accordion.
 * CSS mask + currentColor → gold; splash/logo keep soft plate via .logo-badge.
 */
function rotaryPhoneSvg() {
  return `<span class="rotary-phone-glyph" aria-hidden="true"></span>`;
}

/** Dock Phone tab — bare rotary glyph (larger; centered in shared dock icon slot). */
function dockPhoneIconHtml() {
  return `<span class="rotary-phone-glyph dock-phone-glyph" aria-hidden="true"></span>`;
}
/** App logo mark — same rotary glyph in a soft raised circular badge (not icon.svg tile). */
function logoMarkHtml(extraClass = "") {
  const cls = extraClass ? `logo-badge ${extraClass}` : "logo-badge";
  return `<span class="${cls}" aria-hidden="true">${rotaryPhoneSvg()}</span>`;
}

/** Brand wordmark — matches home/topbar Phone<span>Home</span> treatment. */
function brandWordmarkHtml(extraClass = "") {
  const cls = ["mark", "wordmark", "home-wordmark", extraClass].filter(Boolean).join(" ");
  return `<div class="${cls}">Phone<span>Home</span></div>`;
}

/**
 * Splash / welcome hero: gold rotary glyph + wordmark (not the framed app-icon tile).
 * Framed icon.svg inside .splash-mark was clipping/double-rounding after the rotary asset swap.
 */
function splashBrandHeroHtml({ compact = false } = {}) {
  const wrap = compact ? "splash-hero-lockup compact" : "splash-hero-lockup";
  const rings = compact
    ? `<span class="splash-ring"></span>`
    : `<span class="splash-ring"></span><span class="splash-ring delay"></span>`;
  return `
    <div class="${wrap}">
      <div class="splash-hero-glyph-wrap" aria-hidden="true">
        ${rings}
        <span class="splash-hero-glyph">${rotaryPhoneSvg()}</span>
      </div>
      ${brandWordmarkHtml("splash-brand")}
    </div>`;
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

/** Cassette / answering-machine tape — Messages inbox (not a chat bubble). */
function voicemailSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M4 4.75h16A2.25 2.25 0 0 1 22.25 7v10A2.25 2.25 0 0 1 20 19.25H4A2.25 2.25 0 0 1 1.75 17V7A2.25 2.25 0 0 1 4 4.75zM8.25 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm7.5 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>`;
}

/** Generated inclusive demo faces for How it works slides (not real contacts). */
function tutorialFaceHtml(file, alt) {
  return `<img class="tutorial-face" src="/assets/tutorial/${file}" width="320" height="320" alt="${alt}" />`;
}

function tutorialFaceCardHtml(file, name) {
  return `<figure class="tutorial-face-card">
    ${tutorialFaceHtml(file, name)}
    <figcaption>${name}</figcaption>
  </figure>`;
}

function tutorialScene(id) {
  if (id === "brand") {
    return `
      <div class="scene scene-brand">
        ${brandSplashHeroHtml()}
      </div>`;
  }
  if (id === "treehouse" || id === "playroom" || id === "familyroom") {
    return `
      <div class="scene scene-th-room">
        <div class="scene-th-kids">
          ${tutorialFaceCardHtml("kid-maya.jpg", "Maya")}
          ${tutorialFaceCardHtml("kid-jamal.jpg", "Jamal")}
          ${tutorialFaceCardHtml("kid-sofia.jpg", "Sofia")}
        </div>
        <div class="scene-th-pad">
          ${tutorialTreeHouseHouseHtml()}
          <span class="scene-th-pad-n">0</span>
          <strong>TreeHouse</strong>
        </div>
        <p class="scene-th-listen">Maya’s parent is listening</p>
      </div>`;
  }
  if (id === "circles") {
    return `
      <div class="scene scene-kid-calls">
        <div class="scene-kid-calls-who">
          ${tutorialFaceHtml("kid-maya.jpg", "Maya")}
          <p>Maya can call</p>
        </div>
        <div class="scene-kid-calls-list">
          ${tutorialFaceCardHtml("grand-eleanor.jpg", "Grandma")}
          ${tutorialFaceCardHtml("cousin-priya.jpg", "Priya")}
          ${tutorialFaceCardHtml("parent-kenji.jpg", "Dad")}
        </div>
      </div>`;
  }
  if (id === "invite") {
    let demoUrl = "https://y5876647.eero.online:8443/";
    try {
      if (location.protocol === "https:" && location.host) demoUrl = `${location.origin}/`;
    } catch {
      /* bundled / file */
    }
    const qr = inviteQrSvg(demoUrl);
    return `
      <div class="scene scene-invite">
        <figure class="tutorial-invite-visual">
          <img src="/assets/analog/invite-qr-table.jpg" width="1536" height="1024" alt="Two parents at the table. One shows a PhoneHome QR code; the other is ready to scan." />
          ${
            qr
              ? `<div class="tutorial-invite-qr" role="img" aria-label="Example PhoneHome QR code">${qr}</div>`
              : ""
          }
        </figure>
      </div>`;
  }
  if (id === "phone") {
    return `
      <div class="scene scene-phone">
        <div class="scene-phone-app">
          <span class="scene-way-label">In the app</span>
          <div class="scene-way-faces">
            ${tutorialFaceCardHtml("grand-nokomis.jpg", "Grandma")}
            ${tutorialFaceCardHtml("kid-owen.jpg", "Owen")}
            ${tutorialFaceCardHtml("parent-kenji.jpg", "Dad")}
          </div>
        </div>
        <div class="scene-phone-house">
          <span class="scene-way-label">House phone</span>
          <img class="scene-way-photo" src="/assets/analog/kid-landline-call.jpg" width="1280" height="720" alt="A kid talking on a house landline" />
        </div>
      </div>`;
  }
  if (id === "next") {
    return `
      <div class="scene scene-next">
        <ol class="tutorial-next-steps">
          <li>
            ${tutorialFaceHtml("parent-amara.jpg", "A parent")}
            <span><strong>Sign in</strong><small>Your account</small></span>
          </li>
          <li>
            ${tutorialFaceHtml("kid-maya.jpg", "A child")}
            <span><strong>Add a kid</strong><small>Their phone</small></span>
          </li>
          <li>
            ${tutorialFaceHtml("grand-eleanor.jpg", "Grandma")}
            <span><strong>Invite family</strong><small>One person to start</small></span>
          </li>
        </ol>
      </div>`;
  }
  if (id === "install") {
    const platform = installPlatform();
    const canQuick = Boolean(deferredInstallPrompt);
    const steps =
      platform === "ios"
        ? ["Safari", "Share", "Add to Home Screen"]
        : platform === "android"
          ? canQuick
            ? ["Tap Install", "Open from Home"]
            : ["Chrome menu", "Install app"]
          : ["Share or Install", "Add to Home Screen"];
    return `
      <div class="scene scene-install">
        <div class="scene-home-icon" aria-hidden="true">
          <span class="scene-home-glyph">${logoMarkHtml()}</span>
          <span class="scene-home-label">PhoneHome</span>
        </div>
        <ol class="tutorial-next-steps tutorial-install-steps">
          ${steps
            .map(
              (label, i) =>
                `<li><span class="splash-path-n">${i + 1}</span><span><strong>${label}</strong></span></li>`
            )
            .join("")}
        </ol>
      </div>`;
  }
  if (id === "safety") {
    return `
      <div class="scene scene-safety">
        <ul class="scene-safety-cards">
          <li>
            <strong>Encrypted</strong>
            <span>App and house phone. We don't listen in.</span>
          </li>
          <li>
            <strong>Your tools</strong>
            <span>Quiet Time, PIN, and Timeout</span>
          </li>
          <li>
            <strong>Activity</strong>
            <span>Who called — not what they said</span>
          </li>
        </ul>
      </div>`;
  }
  if (id === "themes") {
    return `
      <div class="scene scene-themes">
        ${uiThemeSelectorHtml({ bare: true })}
      </div>`;
  }
  return "";
}


function advanceFromSplash() {
  if (state.splashTimer) {
    clearTimeout(state.splashTimer);
    state.splashTimer = null;
  }
  // Splash already is How it works #1 (same hero + copy). Continue starts at “tap a face”.
  state.tutorialFromSettings = false;
  state.tutorialIndex = 1;
  state.tutorialFarthest = 1;
  state.screen = "tutorial";
  render();
}

function skipSplashToSignIn() {
  if (mustCompleteHowItWorks()) return;
  if (state.splashTimer) {
    clearTimeout(state.splashTimer);
    state.splashTimer = null;
  }
  state.screen = "welcome";
  render();
}

/**
 * Cold-start splash: iOS Add to Home Screen steps (or compact tip for parents on other devices).
 * Browser tabs only — hidden in the native app and installed PWA.
 */
function splashHomescreenHtml() {
  if (isInstalledPhoneHome()) return "";
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
  if (state.splashTimer) {
    clearTimeout(state.splashTimer);
    state.splashTimer = null;
  }
  app.innerHTML = `
    <div class="splash splash-story-screen${homescreen ? " splash-with-setup" : ""}" id="splash-root">
      <div class="splash-glow" aria-hidden="true"></div>
      ${brandSplashHeroHtml()}
      <div class="splash-brand-copy">
        ${tutorialSlideCopyHtml(tutorialBrandSlide())}
      </div>
      ${splashPathPreviewHtml()}
      ${homescreen}
      <div class="splash-continue-row">
        <button type="button" class="primary btn-block" id="splash-continue">How it works</button>
        ${
          mustCompleteHowItWorks()
            ? ""
            : `<button type="button" class="linkish auth-link" id="splash-signin">Already have an account? Sign in</button>`
        }
      </div>
      <p class="splash-hint" id="splash-hint">Next: How it works</p>
    </div>
  `;
  document.getElementById("splash-continue")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    advanceFromSplash();
  });
  document.getElementById("splash-signin")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    skipSplashToSignIn();
  });
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
  const gp = isGrandparentExperience();
  const summary = parentSetupSummary(hh);
  const { steps, requiredDone, requiredTotal, pct, allRequiredDone, openRequired, optionalOpen } = summary;
  const next = openRequired[0] || steps.find((s) => !s.done) || null;
  const nextOpenIdx = steps.findIndex((s) => !s.done);
  const analogOpen = optionalOpen.some((s) => s.id === "analog");
  const title = gp
    ? allRequiredDone
      ? "You’re all set"
      : "A few steps to get started"
    : allRequiredDone
      ? "You’re set"
      : "Finish family setup";
  const lede = gp
    ? allRequiredDone
      ? analogOpen
        ? "Tap button 1 once to call your family. A regular house phone is optional."
        : "Tap button 1 once to call your family."
      : "We will walk you through it. Big buttons. Plain words."
    : allRequiredDone
      ? analogOpen
        ? "The family line is ready. A house phone is optional."
        : "The family line is ready. Go call someone."
      : `${requiredDone} of ${requiredTotal} required — tap a step to jump in.`;
  const checkSvg =
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.3 16.3 5 12l1.4-1.4 2.9 2.9 8.3-8.3L19 6.6z"/></svg>';
  const chevronSvg =
    '<svg class="setup-step-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>';

  const listHtml = steps
    .map((step, i) => {
      const isNow = !step.done && i === nextOpenIdx;
      const cls = [step.done ? "done" : "", isNow ? "now" : "", step.required ? "" : "optional"]
        .filter(Boolean)
        .join(" ");
      const status = step.done ? "Done" : isNow ? "Next" : step.required ? "To do" : "Optional";
      const detail = String(step.detail || "").replace(/</g, "&lt;");
      const label = String(step.label || "").replace(/</g, "&lt;");
      const mark = step.done
        ? `<span class="setup-step-mark is-done" aria-hidden="true">${checkSvg}</span>`
        : `<span class="setup-step-mark ${isNow ? "is-now" : ""}" aria-hidden="true">${i + 1}</span>`;
      const scroll = step.scrollTo || "";
      const action = step.action || "";
      return `<li class="${cls}" data-step="${step.id}">
        <button type="button" class="setup-step-go" data-setup-step="${step.id}" data-scroll="${scroll}" data-action="${action}">
          ${mark}
          <span class="setup-step-copy">
            <strong>${label}</strong>
            <span>${detail}</span>
          </span>
          <em class="setup-step-status">${status}</em>
          ${chevronSvg}
        </button>
      </li>`;
    })
    .join("");

  const progressHtml = allRequiredDone
    ? `<p class="setup-board-ready">${checkSvg} ${gp ? "You can make calls now" : "All required steps done"}</p>`
    : gp
      ? `<p class="setup-board-ready gp-setup-hint">${
          openRequired[0]
            ? String(openRequired[0].detail || openRequired[0].label).replace(/</g, "&lt;")
            : "A few things left"
        }</p>`
      : `<div class="setup-board-progress" aria-label="${requiredDone} of ${requiredTotal} required steps">
        <div class="setup-board-progress-meta">
          <span>${requiredDone} of ${requiredTotal} required</span>
          <strong>${pct}%</strong>
        </div>
        <div class="setup-board-track" aria-hidden="true"><i style="width:${pct}%"></i></div>
      </div>`;

  const topActions = allRequiredDone
    ? `<div class="setup-board-actions setup-board-actions-top">
        <button type="button" class="primary btn-block" id="setup-skip">${gp ? "Go to my phone" : "Go to phone"}</button>
        ${
          analogOpen
            ? `<button type="button" class="ghost btn-block" id="setup-analog">${gp ? "Set up a regular house phone" : "Set up house phone"}</button>`
            : ""
        }
      </div>`
    : "";

  const bottomActions = allRequiredDone
    ? ""
    : `<div class="btn-row ${next ? "two" : ""} setup-board-actions">
        <button type="button" class="ghost" id="setup-skip">${gp ? "Skip for now — go to phone" : "Skip for now"}</button>
        ${
          next
            ? `<button type="button" class="primary" id="setup-next">${gp ? "Next step" : `Next · ${String(next.label).replace(/</g, "&lt;")}`}</button>`
            : ""
        }
      </div>`;

  const listHead = allRequiredDone ? (gp ? "Finished" : "Finished") : gp ? "What to do" : "Your list";
  const note = gp
    ? allRequiredDone
      ? "Need help later? Open Settings at the bottom, then Your family."
      : "You can still use the phone. Open Settings anytime if you get stuck."
    : allRequiredDone
      ? "Reopen anytime from Parent → Help → Finish setup."
      : "Calling stays available — reopen anytime from Parent → Help → Finish setup.";

  app.innerHTML = `
    <div class="setup-board${allRequiredDone ? " is-complete" : ""}${gp ? " gp-setup-board" : ""}" id="setup-board">
      <header class="setup-board-hero">
        ${brandWordmarkHtml("brand splash-brand")}
        <p class="tutorial-kicker">${gp ? "Simple setup" : "Family setup"}</p>
        <h1>${title}</h1>
        <p class="lede">${lede}</p>
        ${progressHtml}
      </header>
      ${topActions}
      <section class="sheet control-card setup-card setup-checklist" aria-labelledby="setup-list-head">
        <div class="setup-card-head">
          <h2 id="setup-list-head">${listHead}</h2>
          ${gp ? "" : `<p class="tiny">${requiredDone}/${requiredTotal} required</p>`}
        </div>
        <ol class="setup-board-list" aria-label="${gp ? "Grandparent setup" : "Parent setup checklist"}">
          ${listHtml}
        </ol>
      </section>
      ${gp ? uiThemeSelectorHtml({ setup: true, grandparent: true }) : uiThemeSelectorHtml({ setup: true })}
      ${bottomActions}
      <p class="tiny setup-board-note">${note}</p>
    </div>
  `;

  const goParentStep = async (scrollTo) => {
    state.setupForceShow = false;
    dismissSetupChecklist();
    await openParentPanel({ scrollTo });
  };

  document.querySelectorAll("[data-setup-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (gp) {
        void runGrandparentSetupAction(btn.getAttribute("data-action") || "family");
      } else {
        void goParentStep(btn.getAttribute("data-scroll") || "parent-line");
      }
    });
  });
  document.getElementById("setup-next")?.addEventListener("click", () => {
    if (!next) return;
    if (gp) void runGrandparentSetupAction(next.action || "family");
    else void goParentStep(next.scrollTo);
  });
  document.getElementById("setup-analog")?.addEventListener("click", () => {
    if (gp) void runGrandparentSetupAction("analog");
    else void goParentStep("parent-ata");
  });
  document.getElementById("setup-skip")?.addEventListener("click", () => {
    dismissSetupChecklist();
    state.screen = "home";
    state.nav = "phone";
    localStorage.setItem("kl_nav", "phone");
    render();
  });
  bindUiThemeSelector(document.getElementById("setup-board") || document);
}


function finishTutorial({ completed = false } = {}) {
  if (isForcedHowItWorksRun() && !completed) return;
  localStorage.setItem(TUTORIAL_KEY, "1");
  if (completed) {
    try {
      localStorage.setItem(HOW_IT_WORKS_INSTALL_KEY, "1");
    } catch {
      /* private mode */
    }
  }
  const fromSettings = state.tutorialFromSettings;
  state.tutorialFromSettings = false;
  if (fromSettings) {
    if (state.user) {
      state.nav = "controls";
      state.parentScrollTo = "parent-help";
      state.screen = "home";
    } else state.screen = "welcome";
  } else if (state.user) {
    const hh = state.households[0];
    if (!hh || !hh.lines?.length) {
      state.screen = state.mode === "join" ? "join" : "host";
    } else {
      state.screen = "home";
      state.nav = "phone";
      localStorage.setItem("kl_nav", "phone");
    }
    void bootIosCallKit();
  } else if (state.pendingGuardianCode) {
    state.screen = "login";
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
  const forced = isForcedHowItWorksRun();
  const canQuickInstall = slide.id === "install" && Boolean(deferredInstallPrompt);
  const progressSegs = Array.from({ length: n }, (_, i) => {
    const cls = i === state.tutorialIndex ? "on" : i < state.tutorialIndex ? "done" : "";
    const locked = forced && i > state.tutorialFarthest;
    if (locked) return `<span class="tp-seg ${cls}" aria-hidden="true"></span>`;
    return `<button type="button" class="tp-seg ${cls}" data-jump="${i}" aria-label="Go to step ${i + 1}"></button>`;
  }).join("");
  app.innerHTML = `
    <div class="tutorial" id="tutorial-root">
      <div class="tutorial-top">
        ${forced ? "" : `<button type="button" class="linkish tutorial-skip-top" id="skip">Skip</button>`}
        <div class="tutorial-progress" aria-label="Step ${state.tutorialIndex + 1} of ${n}">
          ${progressSegs}
        </div>
      </div>
      <div class="tutorial-stage">
        <div class="tutorial-body">
          <div class="tutorial-visual scene-${slide.id}">
            ${tutorialScene(slide.id)}
          </div>
          ${tutorialSlideCopyHtml(slide)}
        </div>
        <div class="tutorial-footer">
          ${canQuickInstall ? `<button class="primary" id="pwa-install" type="button">Install</button>` : ""}
          <div class="btn-row ${state.tutorialIndex > 0 ? "two" : ""}">
            ${state.tutorialIndex > 0 ? `<button class="ghost" id="prev">Back</button>` : ""}
            <button class="${canQuickInstall ? "ghost" : "primary"}" id="next">${last ? "Let’s go" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const goNext = () => {
    if (last) finishTutorial({ completed: true });
    else {
      state.tutorialIndex += 1;
      state.tutorialFarthest = Math.max(state.tutorialFarthest || 0, state.tutorialIndex);
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
  document.getElementById("skip")?.addEventListener("click", () => finishTutorial());
  document.querySelectorAll("[data-jump]").forEach((btn) => {
    btn.onclick = () => {
      const jump = Number(btn.getAttribute("data-jump"));
      if (forced && jump > state.tutorialFarthest) return;
      state.tutorialIndex = jump;
      render();
    };
  });
  if (slide.id === "themes") {
    bindUiThemeSelector(document.querySelector(".scene-themes") || document);
    document.querySelector(".scene-themes .theme-grid")?.addEventListener(
      "touchstart",
      (e) => e.stopPropagation(),
      { passive: true }
    );
  }

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
        <p class="auth-lede">${needsAuth ? "Enter the Mothership setup code (from whoever runs the server)." : needsFamily ? "Name your Pod — your family on this Mothership." : "Name this phone’s line."}</p>
      </div>
      <div class="sheet auth-sheet">
        ${flashHtml("inline")}
        ${
          needsAuth
            ? `
          <form id="host-login-form" class="auth-form">
            <div class="auth-field">
              <label for="code">Mothership setup code</label>
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
              <label for="hh-name">Pod name</label>
              <input id="hh-name" placeholder="e.g. Carlston" enterkeyhint="go" />
            </div>
            <button class="primary btn-block" type="submit" id="create-hh">Create your Pod</button>
          </form>`
              : needsLine
                ? `
          <form id="host-line-form" class="auth-form">
            <div class="auth-field">
              <label for="line-name">Line name</label>
              <input id="line-name" placeholder="e.g. Trevor’s phone" value="${state.user.display_name}'s phone" enterkeyhint="go" />
            </div>
            <button class="primary btn-block" type="submit" id="add-line">Add app</button>
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
      await persistSession(data.sessionId);
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
          name: document.getElementById("line-name").value || "App",
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
            <button class="primary btn-block" type="submit" id="add-line">Add app</button>
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
      await persistSession(data.sessionId);
      await persistPasswordLogin(
        document.getElementById("reg-user").value.trim(),
        document.getElementById("reg-pass").value
      );
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
          name: document.getElementById("line-name").value || "App",
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
  const gp = isGrandparentExperience();
  const settingsLabel = gp ? "Settings" : "Parent";
  const activityLabel = gp ? "Recent" : "Activity";
  const messagesLabel = gp ? "Messages" : "Messages";
  const parentBtn = isChildMode()
    ? `<button type="button" class="dock-btn" data-nav="parent-unlock"><span>${parentSvg()}</span>Parent</button>`
    : `<button type="button" class="dock-btn ${active === "controls" ? "on" : ""}" data-nav="controls"><span>${parentSvg()}</span>${settingsLabel}</button>`;
  return `
    <nav class="dock" data-gp-chrome="${gp ? "1" : "0"}" style="--dock-i:${dockIndex(active)}" aria-label="Main">
      <i class="dock-indicator" aria-hidden="true"></i>
      <button type="button" class="dock-btn ${active === "phone" ? "on" : ""}" data-nav="phone"><span>${dockPhoneIconHtml()}</span>Phone</button>
      <button type="button" class="dock-btn ${active === "activity" ? "on" : ""}" data-nav="activity"><span>${activitySvg()}</span>${activityLabel}</button>
      <button type="button" class="dock-btn ${active === "voicemail" ? "on" : ""}" data-nav="voicemail"><span>${voicemailSvg()}</span>${messagesLabel}${unreadVm ? `<em class="${unreadVm ? "blink" : ""}">${Math.min(unreadVm, 9)}</em>` : ""}</button>
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
  if (state.nav === "activity") return isGrandparentExperience() ? "Recent calls" : "Activity";
  if (state.nav === "voicemail") return "Messages";
  if (state.nav === "controls") return isGrandparentExperience() ? "Settings" : "Parent";
  const hh = state.households[0];
  const family = hh?.name || "Family";
  if (isKidExperience()) {
    const person = childWhoName();
    return family.trim().toLowerCase() === String(person).trim().toLowerCase()
      ? `Child · ${person}`
      : `Child · ${family}`;
  }
  if (isGrandparentExperience()) {
    const rel = gpPreviewRelative();
    if (rel) {
      const name = rel.display_label || rel.display_name || "Grandparent";
      return `Preview · ${name}`;
    }
    const person = state.user?.display_name || "Family";
    return `Family · ${person}`;
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
  const wantGp = isGrandparentExperience();
  const hasGp = dock.dataset.gpChrome === "1";
  if (wantUnlock !== hasUnlock || wantGp !== hasGp) {
    // Rebuild when Child unlock or Parent↔Settings labels change (incl. GP preview).
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
  if (nav === "activity") markMissedCallsSeen();
  render();
  void syncIosAppBadge();
}

function bindAppChrome(shell) {
  if (!shell || shell.dataset.chromeBound === "1") return;
  shell.dataset.chromeBound = "1";
  shell.addEventListener("click", (e) => {
    const brandHome = e.target.closest(".home-brand-lockup");
    if (brandHome) {
      void onDockNav("phone");
      return;
    }
    const talkToday = e.target.closest("button.usage-bar");
    if (talkToday) {
      void onDockNav("activity");
      return;
    }
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
            ${homeBrandLockupHtml()}
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
    shell.classList.toggle("grandparent-chrome", isGrandparentExperience());
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
  const a11y = `aria-label="Open activity" title="Open activity"`;
  if (cap == null) {
    return `<button type="button" class="usage-bar open" ${a11y}><div class="usage-meta"><span>Talk today</span><strong>${used} min</strong></div></button>`;
  }
  const pct = Math.min(100, Math.round((used / Math.max(cap, 1)) * 100));
  const hot = pct >= 90;
  return `<button type="button" class="usage-bar ${hot ? "hot" : ""}" ${a11y}>
    <div class="usage-meta"><span>Talk today</span><strong>${used} / ${cap} min</strong></div>
    <div class="usage-track"><i style="width:${pct}%"></i></div>
  </button>`;
}

function statusLine(hh, onlineCount) {
  const gp = isGrandparentExperience();
  if (hh.kill_switch) {
    return { text: gp ? "Calls are paused" : "Timeout is on", live: false, danger: true };
  }
  if (hh.dnd) {
    return {
      text: gp ? "Phone is silent" : "Quiet Time on — VIP still ring",
      live: false,
      danger: true,
    };
  }
  if (isQuietHoursActiveClient(hh)) {
    const name = quietWindowName(hh);
    const range = `${formatQuietClock(hh.quiet_start)}–${formatQuietClock(hh.quiet_end)}`;
    return { text: `${name} · ${range}`, live: false };
  }
  if (isParentDndActiveClient(hh)) {
    return {
      text: `Your phone · ${formatQuietClock(hh.parent_quiet_start)}–${formatQuietClock(hh.parent_quiet_end)}`,
      live: false,
    };
  }
  if (state.ataPreferred) {
    return {
      text: gp ? "Calls go to the house phone" : "Calls ring the analog phone",
      live: true,
    };
  }
  const cap = hh.daily_cap_minutes;
  const used = hh.usage_today_minutes || 0;
  if (cap != null) {
    return {
      text: gp
        ? `${used} of ${cap} minutes used today`
        : `${used}/${cap} min today · ${onlineCount} online`,
      live: onlineCount > 0,
    };
  }
  return {
    text: onlineCount
      ? gp
        ? onlineCount === 1
          ? "1 person is free to call"
          : `${onlineCount} people are free to call`
        : `${onlineCount} online`
      : gp
        ? "Ready when you are"
        : "Waiting for family",
    live: onlineCount > 0,
  };
}

function approvalStatus(entry) {
  if (entry?.mutual) {
    return {
      ready: true,
      label: isGrandparentExperience() ? "You can call" : "Ready to call",
      badge: "ok",
    };
  }
  const who = contactDisplayName(entry || { label: "", target_line_id: "" }) || "them";
  if (isChildMode()) return { ready: false, label: `Waiting for ${who}`, badge: "wait" };
  if (isGrandparentExperience()) {
    return { ready: false, label: "They still need to add you", badge: "wait" };
  }
  return { ready: false, label: "Needs their OK", badge: "wait" };
}

/** Other households’ lines in our circle not yet on our allowlist (and not declined). */
function pendingApprovals(hh) {
  const approved = new Set((hh?.allowlist || []).map((a) => a.target_line_id));
  const declined = new Set(hh?.declined_line_ids || []);
  const mySphere = (hh?.spheres || []).find((s) => s.is_mine || s.id === hh?.my_sphere_id);
  const inMyCircle = new Set(mySphere?.member_line_ids || []);
  return (state.directory || []).filter((d) => {
    if (d.household_id === hh?.id || approved.has(d.id) || declined.has(d.id)) return false;
    if (inMyCircle.size && !inMyCircle.has(d.id)) return false;
    return true;
  });
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

/** localStorage cursor: inbound missed calls at/before this ISO are "seen" for icon badge. */
function missedSeenStorageKey(lineId = state.activeLineId) {
  return lineId ? `ph_missed_seen_${lineId}` : "";
}

/**
 * Inbound missed calls for the active line that the user hasn't opened Activity for yet.
 * Outbound no-answer is the caller's leave-a-message flow, not a badge on their icon.
 */
function unseenMissedCallCount(hh = state.households[0]) {
  const lineId = state.activeLineId;
  if (!lineId) return 0;
  const seenAt = localStorage.getItem(missedSeenStorageKey(lineId)) || "";
  let n = 0;
  for (const log of activityLogsForLine(hh?.call_logs, lineId)) {
    if (log.outcome !== "missed") continue;
    if (log.to_line_id !== lineId) continue;
    const when = log.ended_at || log.started_at || "";
    if (seenAt && when && when <= seenAt) continue;
    n += 1;
  }
  // Optimistic CallKit bump only until the missed row shows up in call_logs.
  if (n > 0) {
    state.pendingNativeMissed = 0;
    return n;
  }
  return Math.max(0, Number(state.pendingNativeMissed) || 0);
}

/** Badge = unread VM (server `listened`) + unseen inbound missed (local Activity cursor). */
function iosAppBadgeCount(hh = state.households[0]) {
  return unreadVoicemailCount(hh) + unseenMissedCallCount(hh);
}

function markMissedCallsSeen(hh = state.households[0]) {
  const lineId = state.activeLineId;
  const key = missedSeenStorageKey(lineId);
  if (!key) return;
  let max = localStorage.getItem(key) || "";
  for (const log of activityLogsForLine(hh?.call_logs, lineId)) {
    if (log.outcome !== "missed" || log.to_line_id !== lineId) continue;
    const when = log.ended_at || log.started_at || "";
    if (when > max) max = when;
  }
  const now = new Date().toISOString();
  if (now > max) max = now;
  localStorage.setItem(key, max);
  state.pendingNativeMissed = 0;
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
  const gpWait = isGrandparentExperience();
  wrap.innerHTML = `
    <div class="sheet-modal-card" role="dialog" aria-labelledby="wait-sheet-title">
      <h2 id="wait-sheet-title">${isKidExperience() ? `Waiting for ${name}` : gpWait ? `Not quite yet` : `${name} isn’t ready yet`}</h2>
      <p>${
        isKidExperience()
          ? `They still need to approve you on their phone. Ask a parent if you need help.`
          : gpWait
            ? `<strong>${name}</strong> still needs to add you on their phone. Ask them (or their parent) to open PhoneHome and add you. Then you can call.`
          : `<strong>${name}</strong> still needs to approve you on their phone before you can call. Ask them to open Approve callers and add you.`
      }</p>
      <div class="btn-row ${canInviteFamily() ? "two" : ""}">
        <button type="button" class="primary btn-block" id="wait-sheet-ok">${gpWait ? "OK" : "Got it"}</button>
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
  if (!isGpPreviewMode() && shouldAutoOpenApprovals(hh)) {
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
  const treeHouseTile = { familyRoom: true };
  const activeLine = (hh?.lines || []).find((l) => l.id === state.activeLineId) || null;
  const parentPad = Boolean(activeLine) && (activeLine.mode || "parent") !== "child";

  const gpPad = isGrandparentExperience();
  const renderSpeedSlot = (c, n, extraClass = "") => {
    if (c?.familyRoom || n === TREEHOUSE_SLOT) {
      return renderTreeHouseSlot(extraClass);
    }
    if (!c) {
      if (n === ADMIN_PARENT_SLOT) {
        if (parentPad && gpPad) {
          return `<button class="speed-slot empty pad-home ${extraClass}" data-slot="${ADMIN_PARENT_SLOT}" data-open-approvals="1" type="button" aria-label="Add family on dial 1">
            <span class="speed-face">
              <span class="speed-placeholder speed-key-glyph" aria-hidden="true">${ADMIN_PARENT_SLOT}</span>
            </span>
            <span class="speed-cap">
              <strong class="speed-name">Family</strong>
              <span class="speed-tap-hint">Tap to add them</span>
            </span>
          </button>`;
        }
        if (parentPad && !householdKidLines(hh).length) {
          return `<button class="speed-slot empty pad-home ${extraClass}" data-slot="${ADMIN_PARENT_SLOT}" data-add-kid="1" type="button" aria-label="Add a kid">
            <span class="speed-face">
              <span class="speed-placeholder speed-key-glyph" aria-hidden="true">${ADMIN_PARENT_SLOT}</span>
            </span>
            <span class="speed-name">Add kid</span>
          </button>`;
        }
        const emptyName = parentPad ? "Child" : "Parent";
        return `<button class="speed-slot empty pad-home slot-locked ${extraClass}" data-slot="${ADMIN_PARENT_SLOT}" type="button" disabled aria-label="${emptyName} — unavailable on this line">
            <span class="speed-face">
              <span class="speed-placeholder speed-key-glyph" aria-hidden="true">${ADMIN_PARENT_SLOT}</span>
            </span>
            <span class="speed-name">${emptyName}</span>
          </button>`;
      }
      // Grandparents: empty keys are just numbers — no “+ add contact” clutter.
      if (gpPad) {
        return `<button class="speed-slot empty slot-locked ${extraClass}" data-slot="${n}" type="button" disabled aria-label="Dial ${n} — empty">
                <span class="speed-face">
                  <span class="speed-placeholder speed-key-glyph" aria-hidden="true">${n}</span>
                </span>
              </button>`;
      }
      return `<button class="speed-slot empty ${extraClass}" data-slot="${n}" data-add="1" type="button" aria-label="Add contact to dial ${n}">
                <span class="speed-face">
                  <span class="speed-placeholder speed-key-glyph" aria-hidden="true">+</span>
                </span>
                <span class="speed-cap">
                  <span class="speed-num" aria-hidden="true">${n}</span>
                </span>
              </button>`;
    }
    const st = approvalStatus(c);
    const name = contactDisplayName(c);
    // Kid pads: locked 1 caption is Mom/Dad/parent name. Parent pads: show the child's name.
    const padLabel = n === ADMIN_PARENT_SLOT && c.home_parent ? parentDisplayLabel(
      (hh?.lines || []).find((l) => l.id === c.target_line_id),
      hh
    ) : speedPadLabel(name);
    const presence = st.ready ? (c.online ? "on" : "away") : "wait";
    const status = st.ready ? (c.online ? "Online" : "Away") : st.label;
    const aria = (st.ready ? `Call ${name}, dial ${n}, ${status}` : `${name}, dial ${n}, ${status}`).replace(
      /"/g,
      "&quot;"
    );
    // Slot 2 is locked only when a co-parent tile is synthesized (locked_slot / secondary_parent).
    const locked =
      n === ADMIN_PARENT_SLOT ||
      c.locked_slot ||
      c.home_parent ||
      c.home_child ||
      c.home_grandchild ||
      c.secondary_parent;
    const removable = isRemovableSpeedDialEntry(c);
    const hasPhoto = lineHasAvatar(c.target_line_id);
    const faceName = friendlyPersonName(name);
    const faceNameAttr = faceName.replace(/"/g, "&quot;");
    const faceInner = hasPhoto
      ? avatarHtml(name, c.target_line_id, "speed")
      : `<span class="speed-initials-key" data-avatar-seed="${String(c.target_line_id).replace(/"/g, "")}" style="${avatarStyle(c.target_line_id)}" aria-hidden="true">
            <span class="speed-initials" data-full-name="${faceNameAttr}">${faceName.replace(/</g, "&lt;")}</span>
          </span>`;
    const tapHint = gpPad
      ? st.ready
        ? `<span class="speed-tap-hint">Tap once to call</span>`
        : `<span class="speed-tap-hint">Not ready yet</span>`
      : "";
    // Grandparents always see the name under the button (not only when there’s a photo).
    const caption =
      gpPad || hasPhoto
      ? `<span class="speed-cap">
                  <strong class="speed-name">${padLabel}</strong>
                  ${tapHint}
                  <span class="speed-num" aria-hidden="true">${n}</span>
                </span>`
      : `<span class="speed-cap">
                  <span class="speed-num" aria-hidden="true">${n}</span>
                </span>`;
    const deleteBadge = removable
      ? `<span class="speed-delete" role="button" tabindex="-1" data-delete-entry="${c.id}" aria-label="Remove ${name.replace(/"/g, "&quot;")} from speed dial">×</span>`
      : "";
    return `<button class="speed-slot ${st.ready ? "" : "not-ready"} ${locked ? "slot-locked pad-home" : ""} ${gpPad && st.ready ? "gp-call-ready" : ""} ${gpPad && n === ADMIN_PARENT_SLOT && st.ready ? "gp-primary-call" : ""} ${extraClass}" data-slot="${n}" data-entry="${c.id}" data-${st.ready ? "call" : "wait"}="${c.target_line_id}" type="button" aria-label="${aria}">
                ${deleteBadge}
                <span class="speed-face presence-${presence}" title="${status.replace(/"/g, "&quot;")}">
                  ${faceInner}
                </span>
                ${caption}
              </button>`;
  };

  const hasKidLine = householdKidLines(hh).length > 0;
  const gpPrimary = gpPad ? pickPrimaryGrandchildContact(hh) || contacts.find((c) => Number(c.speed_dial) === ADMIN_PARENT_SLOT) : null;
  const gpPrimaryName = gpPrimary ? contactDisplayName(gpPrimary) : "";
  const gpPrimaryReady = Boolean(gpPrimary && approvalStatus(gpPrimary).ready);
  const waitTip = gpPad
    ? ""
    : contacts.length
    ? readyCount > 0
      ? ""
      : `<p class="tiny home-wait-tip">Waiting on their OK</p>`
    : pending.length
      ? ""
      : `<p class="tiny home-wait-tip">${
          isKidExperience()
            ? "Ask a parent to add family"
            : !hasKidLine
              ? `Add your kid first — tap <strong>1</strong> or open <button type="button" class="linkish" id="home-add-kid">Parent → Kids</button>`
              : "Invite family to get started"
        }</p>`;

  const gpCoachHtml = gpPad
    ? `<div class="gp-call-coach" role="region" aria-label="How to make a call">
        <p class="gp-call-coach-title">${
          gpPrimaryReady && gpPrimaryName
            ? `To call <strong>${String(gpPrimaryName).replace(/</g, "")}</strong>, tap the big <strong>1</strong>`
            : pending.length
              ? "First add your family above, then tap button <strong>1</strong>"
              : "Tap a person’s picture once to call them"
        }</p>
      </div>`
    : "";

  setAppPage(`
      <div class="phone-stack">
        <div class="phone-fit-chrome">
          ${gpPreviewBannerHtml()}
          ${state.celebrate && !isGpPreviewMode() ? `<p class="celebrate-banner">${state.celebrate}</p>` : ""}
          ${isGpPreviewMode() ? "" : liveCallBannerHtml(hh)}
          ${isGpPreviewMode() ? "" : newVoicemailBannerHtml(hh)}
          ${isGpPreviewMode() ? "" : setupBannerHtml(hh)}
          ${isGpPreviewMode() ? "" : pendingApprovalsBannerHtml(hh)}
          ${
            showCreds
              ? `<p class="creds-banner">Create a username &amp; password so you can sign in next time without a code.
                  <button type="button" class="linkish inline" id="go-set-pass">Set it up</button>
                  <button type="button" class="linkish inline" id="dismiss-creds">Not now</button></p>`
              : ""
          }
          ${
            !isSecureMicContext()
              ? `<p class="flash-banner warn">Calls need the secure PhoneHome address — open the app from the usual link, not a 10.x number.</p>`
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
            <h1 class="home-title">${gpPad ? "Your phone" : "Speed dial"}</h1>
            <div class="home-pad-head-actions">
              ${
                state.speedDialEditing
                  ? `<button type="button" class="speed-dial-done" id="speed-dial-done">Done</button>`
                  : canInviteFamily() && !gpPad
                    ? `<button type="button" class="invite-btn" id="invite" title="Invite family" aria-label="Invite family">${inviteSvg()}<span>Invite</span></button>`
                    : ""
              }
            </div>
          </div>

          ${gpCoachHtml}
          ${waitTip ? `<div class="home-pad-lead">${waitTip}</div>` : ""}

          <div class="speed-grid ${isSpeedDialLayoutLocked() ? "layout-locked" : ""} ${state.speedDialEditing ? "is-editing" : ""}${gpPad ? " gp-speed-grid" : ""}">
            ${dialSlots.map((c, idx) => renderSpeedSlot(c, idx + 1)).join("")}
            <button class="speed-slot empty pad-action" data-pad="star" type="button" aria-label="${gpPad ? "Messages" : "Star — Messages"}">
              <span class="speed-face">
                <span class="speed-placeholder speed-key-glyph" aria-hidden="true">*</span>
              </span>
              <span class="speed-cap">
                <strong class="speed-name">${gpPad ? "Messages" : "Msgs"}</strong>
                ${gpPad ? `<span class="speed-tap-hint">Voice mail</span>` : ""}
              </span>
            </button>
            ${
              gpPad
                ? `<button class="speed-slot empty pad-action" type="button" disabled aria-label="Not used">
              <span class="speed-face"><span class="speed-placeholder speed-key-glyph" aria-hidden="true">0</span></span>
              <span class="speed-name">—</span>
            </button>`
                : `${renderSpeedSlot(treeHouseTile, TREEHOUSE_SLOT)}
            ${renderAdultFamilyRoomSlot()}`
            }
          </div>
        </div>
      </div>
  `);

  paintToast();
  bindGpPreviewChrome();
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
  const goHomeAddKid = () => {
    void openParentPanel({ scrollTo: "parent-kids" });
  };
  document.getElementById("home-add-kid")?.addEventListener("click", goHomeAddKid);
  document.querySelectorAll("[data-add-kid]").forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      if (state.speedDialEditing) return;
      goHomeAddKid();
    };
  });
  document.getElementById("speed-dial-done")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    exitSpeedDialEditMode();
  });
  document.querySelector(".speed-grid")?.addEventListener(
    "click",
    (e) => {
      const slot = e.target.closest("[data-slot]")?.getAttribute("data-slot");
      if (slot && tryFamilyRoomPickerDigit(slot)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
  document.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => {
      if (state.speedDialEditing) return;
      const slot = b.closest("[data-slot]")?.getAttribute("data-slot");
      if (slot && tryFamilyRoomPickerDigit(slot)) return;
      openApprove();
    };
  });
  document.querySelectorAll("[data-call]").forEach((btn) => {
    btn.onclick = () => {
      if (state.speedDialEditing) return;
      const slot = btn.closest("[data-slot]")?.getAttribute("data-slot");
      if (slot && tryFamilyRoomPickerDigit(slot)) return;
      placeCall(btn.getAttribute("data-call"));
    };
  });
  document.querySelectorAll("[data-familyroom]").forEach((btn) => {
    btn.onclick = () => {
      if (state.speedDialEditing) return;
      if (tryFamilyRoomPickerDigit(TREEHOUSE_SLOT)) return;
      void unlockAudioCtx().then(() => playDtmf(String(TREEHOUSE_SLOT), 0.09));
      if (state.group?.familyRoom && !state.group.listenOnly) {
        setFlash("You’re already in TreeHouse", "info");
        return;
      }
      if (isHouseholdParentPad()) {
        parentTreeHousePadAction();
        return;
      }
      joinTreeHouse();
    };
  });
  document.querySelectorAll("[data-wait]").forEach((btn) => {
    btn.onclick = () => {
      if (state.speedDialEditing) return;
      const slot = btn.closest("[data-slot]")?.getAttribute("data-slot");
      if (slot && tryFamilyRoomPickerDigit(slot)) return;
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
  document.querySelectorAll("[data-adult-familyroom]").forEach((btn) => {
    btn.onclick = () => {
      if (state.speedDialEditing) return;
      void unlockAudioCtx().then(() => playDtmf("#", 0.09));
      if (state.call || (state.group && !state.group?.adultFamilyRoom)) {
        setFlash("Finish your call first", "info");
        return;
      }
      if (state.group?.adultFamilyRoom) {
        setFlash("You’re already in FamilyRoom", "info");
        return;
      }
      startAdultFamilyRoomIvr();
    };
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
        void syncIosAppBadge();
        // Parent / Activity / Messages: keep data fresh but never remount.
        // A full render() reset scroll and slammed open sections back to default.
        if (state.nav && state.nav !== "phone") {
          if (state.nav === "controls") patchAnalogPhoneStatus(state.households[0]);
          return;
        }
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
  markMissedCallsSeen(hh);
  void syncIosAppBadge();
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
      patchDockVmBadge(hh);
      void syncIosAppBadge();
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
    : ["profile-photo", "profile-name", "profile-greeting", "profile-sounds"];
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
      keywords: "name display label kid label line app identity rename",
    },
    base[1],
    {
      id: "profile-sounds",
      kind: "section",
      title: "Ringer & speaker",
      keywords:
        "sounds ringer ring volume style speaker screening answering machine classic chirp chime modern urgent callkit lock screen answer voip",
    },
    {
      id: "profile-parent-controls",
      kind: "action",
      title: "Parental controls",
      keywords: "household parent quiet time pin child mode contacts account help more parental",
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

function parentTitlePickerHtml() {
  const cur = state.user?.parent_title || "";
  return `<label>I’m this child’s</label>
    <div class="ringer-grid" style="margin-bottom:10px">
      ${[
        ["", "Use my name"],
        ["mom", "Mom"],
        ["dad", "Dad"],
      ]
        .map(
          ([id, label]) =>
            `<button type="button" class="ringer-opt ${cur === id ? "on" : ""}" data-parent-title="${id}">${label}</button>`
        )
        .join("")}
    </div>
    <button type="button" class="primary" data-save-parent-title style="margin-bottom:12px">Save Mom / Dad label</button>`;
}

function bindParentTitlePicker() {
  document.querySelectorAll("[data-parent-title]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-parent-title]").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
    });
  });
  document.querySelectorAll("[data-save-parent-title]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const picked =
          document.querySelector("[data-parent-title].on")?.getAttribute("data-parent-title") ?? "";
        const data = await api("/api/user/profile", {
          method: "PATCH",
          body: JSON.stringify({ parent_title: picked || null }),
        });
        state.user = data.user || state.user;
        setFlash(
          picked === "mom"
            ? "Saved — kids will see you as Mom"
            : picked === "dad"
              ? "Saved — kids will see you as Dad"
              : "Saved — kids will see your name",
          "ok"
        );
        await refresh();
      } catch (e) {
        setFlash(e.message || "Could not save parent label", "error");
        render();
      }
    });
  });
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
          ${!kid ? parentTitlePickerHtml() : ""}
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
          <p class="tiny">Volume and ring sound for the <strong>incoming</strong> ringer — not the caller’s ringback.</p>
          <label id="profile-ring-volume-label">Volume (${ringVol})</label>
          <input id="profile-ring-volume" type="range" min="0" max="100" step="5" value="${ringVol}" />
          <label style="margin-top:10px">Ring sound</label>
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
          <h3 class="parent-subhead parent-subhead-with-badge">${withBetaBadge("Speaker (call screening)")}</h3>
          <p class="tiny">Optional — off by default. Like a 90s answering machine speaker: play the caller’s message out loud while they record. Messages still save either way.</p>
          <label class="check-row">
            <input type="checkbox" id="profile-answering-machine" ${line?.answering_machine ? "checked" : ""} />
            Play messages out loud as they’re left
          </label>
        </div>
        ${iosCallKitToggleHtml("profile-ios-callkit")}`;

  const parentControlsCard = !kid
    ? `<section class="sheet control-card" id="profile-parent-controls">
        <h2>Parental controls</h2>
        <p class="tiny">Quiet Time, PIN, Child mode, and people live here.</p>
        <button type="button" class="primary" id="profile-to-parent">Open parental controls</button>
      </section>`
    : "";

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
        "How this app is labeled for family.",
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
          : "Edit any household line’s picture and greeting — your app stays on the line that’s ringing for you."
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
        <a href="#profile-parent-controls">Parental controls</a>
      </nav>`
          : ""
      }
      ${sections.join("\n")}
      ${parentControlsCard}
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
        // Only accordion sections toggle; parental-controls is a flat card.
        if (el.hasAttribute("data-profile-acc")) setProfileAccordionOpen(id, kid);
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
  bindParentTitlePicker();
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
  bindIosCallKitToggle("profile-ios-callkit");
}

const PARENT_ACC_IDS = [
  "parent-themes",
  "parent-kids",
  "parent-people",
  "parent-coparents",
  "parent-grandparents",
  "parent-treehouse",
  "parent-adult-familyroom",
  "parent-hours",
  "parent-pin",
  "parent-ata",
  "parent-line",
  "parent-help",
  "parent-account",
];

/** Old section ids now live inside This phone, Themes, or Kids. */
const PARENT_ACC_ALIASES = {
  "parent-sounds": "parent-line",
  "parent-appearance": "parent-themes",
  "add-kid": "parent-kids",
};

function canonicalParentAccId(id) {
  if (!id) return "";
  return PARENT_ACC_ALIASES[id] || id;
}

function parentGroupLabel(groupId, title) {
  return `<p class="parent-group-label" data-parent-group="${groupId}">${title}</p>`;
}

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
    id: "parent-kids",
    kind: "section",
    title: "Kids",
    keywords:
      "kids children add kid add child first name new kid profile delete kid erase photo greeting house phone",
  },
  {
    id: "parent-people",
    kind: "section",
    title: "Contacts & speed dials",
    keywords:
      "contacts people speed dial invite family allowlist nickname vip dial pad slots",
  },
  {
    id: "parent-coparents",
    kind: "section",
    title: "Co-parents",
    keywords:
      "co-parent second parent guardian authorized parents invite code share mom dad dual parent other parents",
  },
  {
    id: "parent-grandparents",
    kind: "section",
    title: "Grandparents",
    keywords:
      "grandparent grandma grandpa relative setup invite login username password nana papa mamaw papaw older adult family",
  },
  {
    id: "parent-treehouse",
    kind: "section",
    title: "TreeHouse",
    keywords:
      "rooms treehouse tree house playroom play room group voice pad 0 house shared call multi party approve members room presence listen talk pair kids",
  },
  {
    id: "parent-adult-familyroom",
    kind: "section",
    title: "FamilyRoom",
    keywords:
      "rooms familyroom family room pad hash # approve kids children adults family admin room presence talk",
  },
  {
    id: "parent-hours",
    kind: "section",
    title: "Quiet Time & limits",
    keywords:
      "quiet time quiet hours quiet schedule limits schedule bedtime school open daily talk cap minutes timezone custom dnd do not disturb parent evenings kid child",
  },
  {
    id: "parent-pin",
    kind: "section",
    title: "Parent PIN",
    keywords: "pin parent lock layout speed dial unlock password digits kid child mode",
  },
  {
    id: "parent-line",
    kind: "section",
    title: "This phone",
    keywords:
      "active line this phone device profile picture avatar photo child mode lock device kid label child login password sounds ringer ring volume greeting answering machine speaker screening callkit lock screen answer voip add kid",
  },
  {
    id: "parent-sounds",
    kind: "section",
    title: "Ringer & greeting",
    keywords:
      "sounds ringer ring volume ring sound greeting answering machine speaker screening beep classic chirp callkit lock screen answer voip",
  },
  {
    id: "parent-themes",
    kind: "section",
    title: "Themes",
    keywords:
      "themes theme appearance app style look modern retro 90s tech atomic purple clear plastic wood walnut dos crt bit aero windbreaker millennial tunes xenon pocketgame dad tomspace craig emo flat backrooms yellow rooms carpet cartoon pop chunky toon candy playground flash bubble coaster park isometric lawn baja tropical neon teal turquoise lime wave ui skin",
  },
  {
    id: "parent-ata",
    kind: "section",
    title: "Analog Phone",
    keywords:
      "analog phone adapter ata ht801 grandstream fanvil g100s house phone landline corded cordless setup download ethernet green jack amazon ebay shop buy",
  },
  {
    id: "parent-help",
    kind: "section",
    title: "Help",
    keywords:
      "help tutorial guide how to privacy encryption app mic finish setup checklist onboarding invite qr text scan analog house phone themes",
  },
  {
    id: "parent-account",
    kind: "section",
    title: "Account",
    keywords:
      "account username password sign out logout credentials delete account erase wipe leave face id touch id keychain saved sign-in",
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

  document.querySelectorAll(".parent-group-label").forEach((label) => {
    const group = label.getAttribute("data-parent-group");
    const secs = [...document.querySelectorAll(`section.parent-section[data-parent-group="${group}"]`)];
    const any = secs.some((s) => !s.classList.contains("parent-search-hidden"));
    label.classList.toggle("parent-search-hidden", Boolean(q) && !any);
  });

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
    title: "House phone (Analog)",
    body: `<p>Want a regular phone on the wall or nightstand for a kid? Plug it into a small <strong>Grandstream HT801 v2</strong> box. PhoneHome talks to that box.</p>
<figure class="ata-photos ata-photos-help">
  <img src="/assets/analog/kid-landline.jpg" width="1400" height="933" alt="A young kid talking on a house landline phone" />
  <ul class="ata-photos-thumbs">
    <li><img src="/assets/analog/ht801-v2-1.png" width="500" height="500" alt="Grandstream HT801 v2, angled top view" /></li>
    <li><img src="/assets/analog/ht801-v2-2.png" width="500" height="500" alt="Grandstream HT801 v2 top lights" /></li>
    <li><img src="/assets/analog/ht801-v2-3.png" width="500" height="500" alt="Grandstream HT801 v2 back ports" /></li>
  </ul>
</figure>
<ol>
  <li>Add the kid first under <strong>Parent → Kids</strong>.</li>
  <li>Open <strong>Parent → Analog Phone</strong> and pick that kid.</li>
  <li>Choose Grandstream HT801 v2, then tap <strong>Save connection</strong> (this creates the phone-system extension automatically).</li>
  <li>If this PhoneHome and the box are in the same house, tap <strong>Set up adapter</strong>.</li>
  <li>At another house (or if one-tap fails): tap <strong>Download config</strong>, then open the box’s admin page and upload the file:
    <ul>
      <li>Find the IP: house phone in the green jack → dial <span class="mono">***</span> → <span class="mono">02</span>.</li>
      <li>On the same Wi‑Fi, open <span class="mono">https://</span> that IP. Username <span class="mono">admin</span>, sticker password on the bottom.</li>
      <li>Left menu: <strong>Maintenance → Upgrade → Upload Configuration</strong>. Pick the downloaded <span class="mono">config.xml</span>, then reboot.</li>
    </ul>
  </li>
  <li>Plug the house phone into the <strong>green phone jack</strong> on the back. Dial <strong>0</strong> for home / parent, or <strong>1–9</strong> for speed dials.</li>
  <li>Dial <strong>*98</strong> to hear Messages on the handset (same inbox as the app). Press <strong>2</strong> to record or change the greeting.</li>
</ol>
<p>When you change contacts in the app, the house phone updates — you don’t need to set it up again. After a successful one-tap setup, the password printed on the sticker stops working; use the password you chose. Too many wrong logins lock the box’s web page for a couple of minutes.</p>
<p class="tiny">Calls stay encrypted. Keep the box on your home network and use the buttons in the app — don’t type secrets by hand.</p>`,
  },
  {
    id: "invite",
    title: "Invite family with a QR or text",
    body: `<p>To add family or a co-parent, show them a <strong>QR code</strong> across the table, or send the link in a text. They open PhoneHome, sign in (or create an account), and join. Then <strong>both of you</strong> tap Approve before kids can call.</p>
<figure class="ata-photos ata-photos-help">
  <img src="/assets/analog/invite-qr-table.jpg" width="1536" height="1024" alt="Two parents at the table sharing a PhoneHome invite QR code" />
</figure>
<ol>
  <li><strong>Family</strong> — Parent → Contacts → invite. Scan the QR, or Share / Copy the link.</li>
  <li><strong>Co-parent</strong> — Parent → Kids (add your kid) → Co-parents → Invite co-parent. Same idea: QR or text.</li>
  <li><strong>Grandparent</strong> — Parent → Grandparents → create their username and password. They sign in; no invite code.</li>
  <li>After they join, you approve them, and they approve you.</li>
</ol>
<p class="tiny">The QR is just a shortcut to the same link. Sitting together is easiest. A text works when they’re not in the room.</p>`,
  },
  {
    id: "quiet-pin",
    title: "Quiet Time, PIN &amp; kid lock",
    body: `<p>At the top of Parent, <strong>Timeout</strong> stops all household calls right now. <strong>Quiet Time</strong> starts quiet right now for everyone. Under <strong>Quiet Time &amp; limits</strong> you set each kid’s Bedtime, School, or custom hours and an optional daily talk limit — plus <strong>Do Not Disturb</strong> for your own phone, which does not change the kids’ hours.</p>
<p>Set a <strong>Parent PIN</strong> (4–6 digits) before you lock a kid’s phone. The PIN is asked on a kid device or kid account — not on your unlocked parent phone.</p>
<p>Add a kid under <strong>Kids</strong> (their first name). That creates their phone without changing yours. Then <strong>Lock this device</strong> (This phone) only if you want <em>this</em> phone in Child mode: speed dial, Activity, and Messages only. Leaving needs the PIN. Optional <strong>Lock speed dial layout</strong> stops kids from moving the buttons.</p>
<p class="tiny">A kid has their own PhoneHome line in your family — not a second family. You can invite a co-parent to help manage that same kid.</p>`,
  },
  {
    id: "privacy",
    title: "Privacy",
    body: `<p>PhoneHome is built so family calls stay private.</p>
<ul>
  <li><strong>The app</strong> encrypts the call between phones. We help set up the call; we don’t listen in.</li>
  <li><strong>House phones</strong> (the adapter) also use encrypted calling on your home network.</li>
  <li>We don’t keep your conversations. Missed-call greetings are answering-machine messages you control.</li>
  <li>Kids can only reach people you invite, and both families must approve.</li>
</ul>
<p class="tiny">You choose who kids can call — that’s safety, not selling data. Use the PhoneHome app (or its home-screen icon) when you’re away from home.</p>`,
  },
  {
    id: "softphone",
    title: "App microphone &amp; Add to Home Screen",
    body: `<p>The phone asks for the microphone when you place or answer a call. Tap Allow.</p>
<p>On iPhone/iPad in Safari: Share → <strong>Add to Home Screen</strong>, then open PhoneHome from that icon.</p>
<p class="tiny">If the mic is blocked: tap aA in Safari → Website Settings → Microphone → Allow. Always open the same PhoneHome address.</p>`,
  },
  {
    id: "contacts",
    title: "Contacts &amp; speed dials",
    body: `<p>Someone joins with an invite. Then <strong>both families tap Approve</strong> before a call will go through.</p>
<ul>
  <li><strong>Contacts &amp; speed dials</strong> — nicknames, invites, and buttons 1–9.</li>
  <li>Button <strong>0</strong> is Home / this house’s parent.</li>
  <li>On your unlocked parent phone you can drag to rearrange. On a kid phone, moving buttons needs the Parent PIN if layout lock is on.</li>
  <li><strong>Kids</strong> — type their first name. That creates their phone. Your parent phone stays yours.</li>
  <li>A kid’s photo opens their picture and greeting — you don’t have to switch into their account.</li>
</ul>
<p class="tiny">Calling regular cell phones, 911, or outside landlines is a later add-on. Family-to-family calling here is free.</p>`,
  },
];

function parentHelpArticles() {
  if (!isInstalledPhoneHome()) return PARENT_HELP_ARTICLES;
  return PARENT_HELP_ARTICLES.map((article) => {
    if (article.id !== "softphone") return article;
    return {
      ...article,
      title: "App microphone",
      body: `<p>PhoneHome asks for the microphone when you place or answer a call. Tap Allow.</p>
<p>On iPhone, Parent → This phone can turn on <strong>Lock-screen Answer</strong>. Off means you tap a notification and answer in the app.</p>
<p class="tiny">If the mic is blocked: iPhone Settings → PhoneHome → Microphone → Allow.</p>`,
    };
  });
}

function parentHelpArticleHtml(article) {
  const open = state.parentHelpFocus === article.id ? " open" : "";
  return `<details class="help-article" data-help-id="${article.id}"${open}>
    <summary>${article.title}</summary>
    <div class="help-article-body">${article.body}</div>
  </details>`;
}
const PARENT_ACC_KEY = "ph_parent_acc";

/** Exclusive Parent accordion: which section stays open (default: Kids if none, else Contacts). */
function resolveParentAccordionId(preferred) {
  const want = canonicalParentAccId(preferred);
  if (want && PARENT_ACC_IDS.includes(want)) return want;
  try {
    const stored = sessionStorage.getItem(PARENT_ACC_KEY);
    if (stored && PARENT_ACC_IDS.includes(stored)) return stored;
  } catch {
    /* private mode */
  }
  const hh = state.households[0];
  if (!householdKidLines(hh).length) return "parent-kids";
  return "parent-people";
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
      // Same rotary mark as app icon / Phone dock glyph.
      return rotaryPhoneSvg();
    case "sounds":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 9.2v5.6h3.6l4.6 3.6V5.6L6.8 9.2H3.2zm12.2 2.8c0-1.5-.8-2.8-2-3.5v7c1.2-.7 2-2 2-3.5zm2.6 0c0 2.4-1.3 4.5-3.3 5.6l1.1 1.7c2.7-1.5 4.5-4.2 4.5-7.3s-1.8-5.8-4.5-7.3l-1.1 1.7c2 1.1 3.3 3.2 3.3 5.6z"/></svg>`;
    case "appearance":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.4l2.2 4.6 5 .7-3.6 3.5.9 5.2L12 14.2l-4.5 2.2.9-5.2-3.6-3.5 5-.7L12 2.4z"/><circle cx="5.2" cy="5.8" r="1.6" opacity="0.85"/><circle cx="18.8" cy="6.4" r="1.4" opacity="0.85"/><circle cx="19.2" cy="17.6" r="1.5" opacity="0.85"/><circle cx="5.6" cy="17.2" r="1.3" opacity="0.85"/></svg>`;
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
    case "familyroom":
    case "playroom":
    case "treehouse":
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 3.8 10.2h2.2v9.2h4.4v-5.2h3.2v5.2h4.4v-9.2h2.2L12 3.2z"/></svg>`;
    case "line":
    default:
      return phoneSvg();
  }
}

function betaBadgeHtml() {
  return `<span class="badge beta">Beta</span>`;
}

function withBetaBadge(title) {
  return `${title} ${betaBadgeHtml()}`;
}

function parentSecToggle(id, title, hint, open, icon = "line", statusChipHtml = "", { beta = false } = {}) {
  return `<button type="button" class="parent-sec-toggle" id="${id}-toggle" aria-expanded="${
    open ? "true" : "false"
  }" aria-controls="${id}-body">
    <span class="parent-sec-toggle-main">
      <span class="parent-sec-title-row">
        <span class="parent-sec-heading">
          <span class="parent-sec-icon" aria-hidden="true">${parentSecIcon(icon)}</span>
          <span class="parent-sec-title">${title}</span>
          ${beta ? betaBadgeHtml() : ""}
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
  const sectionId = canonicalParentAccId(openId);
  document.querySelectorAll("section.parent-section[data-acc]").forEach((sec) => {
    const isOpen = Boolean(sectionId) && sec.id === sectionId;
    sec.classList.toggle("is-open", isOpen);
    const btn = sec.querySelector(":scope > .parent-sec-toggle");
    const body = sec.querySelector(":scope > .parent-sec-body");
    if (btn) btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (body) body.hidden = !isOpen;
  });
  persistParentAccordionId(sectionId || "");
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

/**
 * Parent → Co-parents: invite/manage guardians on a kid line.
 * Kid = child line (from Kids); co-parents = guardians. Parent phone stays parent.
 */
function resolveCoparentKidLine(hh) {
  const kids = householdKidLines(hh);
  if (!kids.length) return null;
  const preferred = kids.find((l) => l.id === state.coparentKidLineId);
  return preferred || kids[0];
}

/**
 * Parent-provisioned grandparent accounts: set their login, manage options,
 * preview their simple phone, reset password.
 */
function renderGrandparentsPanel(hh) {
  const kids = householdKidLines(hh);
  const relatives = Array.isArray(hh?.provisioned_relatives) ? hh.provisioned_relatives : [];
  const managingId = state.managingGrandparentId || "";
  const managing = relatives.find((r) => r.id === managingId) || null;
  const last = state.lastGrandparentSetup || null;
  const lastCard =
    last && last.householdId === hh?.id
      ? `<div class="coparent-invite-card" id="gp-login-card">
        <p class="invite-eyebrow">Login for ${String(last.displayName || "Grandparent").replace(/</g, "")}</p>
        <p class="tiny">Write this down or text it to them. They open PhoneHome and sign in — no invite code needed.</p>
        <div class="code-box glow" style="font-size:1.05rem;letter-spacing:0.02em">
          <div><span class="tiny">Username</span><br /><span class="mono">${String(last.username || "").replace(/</g, "")}</span></div>
          <div style="margin-top:10px"><span class="tiny">Password</span><br /><span class="mono">${String(last.password || "").replace(/</g, "")}</span></div>
        </div>
        <div class="btn-row two" style="margin-top:12px">
          <button type="button" class="primary" id="copy-gp-login">Copy login</button>
          <button type="button" class="ghost" id="dismiss-gp-login">Done</button>
        </div>
      </div>`
      : "";

  const kidChecks = kids.length
    ? kids
        .map((k) => {
          const id = String(k.id || "").replace(/"/g, "&quot;");
          const name = String(k.child_label || k.name || "Kid").replace(/</g, "");
          return `<label class="gp-kid-check"><input type="checkbox" name="gp-kid" value="${id}" checked /> ${name}</label>`;
        })
        .join("")
    : `<p class="tiny ata-lan-warn">Add a kid under Kids first — then choose who Grandma can call.</p>`;

  const manageKidChecks = managing
    ? kids.length
      ? kids
          .map((k) => {
            const id = String(k.id || "").replace(/"/g, "&quot;");
            const name = String(k.child_label || k.name || "Kid").replace(/</g, "");
            const on = (managing.kid_line_ids || []).includes(k.id);
            return `<label class="gp-kid-check"><input type="checkbox" name="gp-manage-kid" value="${id}" ${
              on ? "checked" : ""
            } /> ${name}</label>`;
          })
          .join("")
      : `<p class="tiny ata-lan-warn">Add a kid under Kids first.</p>`
    : "";

  const manageCard = managing
    ? (() => {
        const rid = String(managing.id || "").replace(/"/g, "&quot;");
        const name = String(managing.display_name || "").replace(/"/g, "&quot;");
        const label = String(managing.display_label || "").replace(/"/g, "&quot;");
        const user = String(managing.username || "").replace(/"/g, "&quot;");
        const showName = String(managing.display_label || managing.display_name || "Grandparent").replace(
          /</g,
          ""
        );
        return `<div class="coparent-invite-card gp-manage-card" id="gp-manage-card" data-gp-manage-id="${rid}">
        <p class="invite-eyebrow">Manage · ${showName}</p>
        <p class="tiny">Change their login, who they can call, or open a preview of their simple phone (like viewing a kid’s options).</p>
        <label>Their name</label>
        <input id="gp-manage-display-name" autocomplete="name" maxlength="64" value="${name}" />
        <label style="margin-top:10px">Nickname on your phone</label>
        <input id="gp-manage-label" maxlength="64" value="${label}" />
        <label style="margin-top:10px">Username</label>
        <input id="gp-manage-username" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="32" value="${user}" />
        <label style="margin-top:10px">New password <span class="tiny">(optional)</span></label>
        <input id="gp-manage-password" type="password" autocomplete="new-password" placeholder="leave blank to keep" />
        <label style="margin-top:10px">Who can they call?</label>
        <div class="gp-kid-checks">${manageKidChecks}</div>
        <div class="btn-row two" style="margin-top:14px">
          <button type="button" class="primary" id="save-gp-manage">Save changes</button>
          <button type="button" class="ghost" id="preview-gp-phone" data-gp-preview="${rid}">See their phone</button>
        </div>
        <div class="btn-row two" style="margin-top:8px">
          <button type="button" class="ghost tiny-btn" data-gp-view="${rid}">Show login card</button>
          <button type="button" class="ghost tiny-btn" data-gp-reset="${rid}">New password only</button>
        </div>
        <button type="button" class="linkish" id="close-gp-manage" style="margin-top:10px">Close</button>
      </div>`;
      })()
    : "";

  const listRows = relatives.length
    ? relatives
        .map((r) => {
          const name = String(r.display_label || r.display_name || "Grandparent").replace(/</g, "");
          const user = r.username
            ? `<span class="mono">${String(r.username).replace(/</g, "")}</span>`
            : "no username";
          const kidsOn = (r.kid_line_ids || [])
            .map((id) => {
              const k = kids.find((x) => x.id === id);
              return k ? String(k.child_label || k.name || "").replace(/</g, "") : "";
            })
            .filter(Boolean)
            .join(", ");
          const rid = String(r.id || "").replace(/"/g, "&quot;");
          const open = r.id === managingId;
          return `<li class="gp-relative-row${open ? " is-managing" : ""}" data-gp-id="${rid}">
            <div>
              <strong>${name}</strong>
              <span class="tiny"> · ${user}${kidsOn ? ` · calls ${kidsOn}` : ""}</span>
            </div>
            <div class="btn-row two" style="margin-top:8px">
              <button type="button" class="primary tiny-btn" data-gp-manage="${rid}">${
                open ? "Managing…" : "Manage"
              }</button>
              <button type="button" class="ghost tiny-btn" data-gp-preview="${rid}">See their phone</button>
            </div>
          </li>`;
        })
        .join("")
    : `<li class="tiny">None yet — set one up below.</li>`;

  return `
    <div class="parent-field" style="margin-top:0;padding-top:0;border-top:0">
      <h3 class="parent-subhead">Set up Grandma or Grandpa</h3>
      <p class="tiny">You choose their name and login. They get a simpler phone (Settings, not Parent). Open <strong>Manage</strong> anytime to change options or preview what they see.</p>
      ${lastCard}
      ${manageCard}
    </div>

    <div class="parent-field">
      <h3 class="parent-subhead">Already set up</h3>
      <ul class="guardian-list gp-relative-list">${listRows}</ul>
    </div>

    <div class="parent-field" id="gp-setup-form">
      <h3 class="parent-subhead">New grandparent</h3>
      <label>Their name</label>
      <input id="gp-display-name" autocomplete="name" placeholder="Grandma Larsen" maxlength="64" />
      <label style="margin-top:10px">Nickname on your phone</label>
      <input id="gp-label" placeholder="Grandma" maxlength="64" />
      <label style="margin-top:10px">Username</label>
      <input id="gp-username" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="grandma" maxlength="32" />
      <label style="margin-top:10px">Password</label>
      <input id="gp-password" type="password" autocomplete="new-password" placeholder="at least 8 characters" />
      <label style="margin-top:10px">Who can they call?</label>
      <div class="gp-kid-checks">${kidChecks}</div>
      <button type="button" class="primary" id="create-grandparent" style="margin-top:14px" ${
        kids.length ? "" : "disabled"
      }>Create login</button>
    </div>
  `;
}

function renderCoParentsPanel(hh) {
  const kids = householdKidLines(hh);
  const line = resolveCoparentKidLine(hh);
  if (line) state.coparentKidLineId = line.id;
  const lineId = line?.id || "";
  const lineLabel = (line?.child_label || line?.name || "this kid").replace(/</g, "");
  const guardians = line?.guardians || [];
  const guardianIds = new Set(guardians.map((g) => g.user_id));
  const members = (hh?.members || []).filter((m) => m.user_id !== state.user?.id);
  const addableMembers = members.filter((m) => !guardianIds.has(m.user_id) && m.username);
  const invite =
    state.lastGuardianInvite && state.lastGuardianInvite.lineId === lineId
      ? state.lastGuardianInvite
      : null;
  const codeSafe = invite ? String(invite.code || "").replace(/</g, "") : "";
  const urlSafe = invite ? String(invite.shareUrl || "").replace(/</g, "&lt;") : "";

  const kidPicker =
    kids.length > 1
      ? `<label for="coparent-kid">Which kid?</label>
      <select id="coparent-kid" style="margin-bottom:12px">
        ${kids
          .map((k) => {
            const id = String(k.id || "").replace(/"/g, "&quot;");
            const name = String(k.child_label || k.name || "Kid").replace(/</g, "");
            const sel = k.id === lineId ? " selected" : "";
            return `<option value="${id}"${sel}>${name}</option>`;
          })
          .join("")}
      </select>`
      : "";

  const guardianRows = !line
    ? `<li class="tiny">Add a kid first — then invite the other parent.</li>`
    : guardians
        .map((g) => {
          const name = String(g.display_name || "Parent").replace(/</g, "");
          const user = g.username ? ` · <span class="mono">${String(g.username).replace(/</g, "")}</span>` : "";
          const you = g.user_id === state.user?.id ? " · you" : "";
          const remove =
            g.user_id !== state.user?.id
              ? `<button type="button" class="ghost tiny-btn" data-remove-guardian="${g.user_id}">Remove</button>`
              : "";
          return `<li><span>${name}${user}${you}</span>${remove}</li>`;
        })
        .join("") || `<li class="tiny">Only you so far — invite the other parent.</li>`;

  const memberOptions = addableMembers
    .map((m) => {
      const label = `${String(m.display_name || "Parent").replace(/</g, "")}${
        m.username ? ` · ${String(m.username).replace(/</g, "")}` : ""
      }`;
      const uname = String(m.username || "").replace(/"/g, "&quot;");
      return `<option value="${uname}">${label}</option>`;
    })
    .join("");

  const guardianQr = invite?.shareUrl ? inviteQrSvg(invite.shareUrl) : "";
  let inviteCard;
  if (!line) {
    inviteCard = `<div class="coparent-invite-card is-empty" id="guardian-invite-box">
        <p class="tiny">Add a kid under <strong>Kids</strong> first. Then invite another parent to help manage that kid’s contacts, Quiet Time, and settings with you — your phone stays a parent phone.</p>
        <button type="button" class="primary" id="coparents-go-kids">Add a kid</button>
      </div>`;
  } else if (invite) {
    inviteCard = `<div class="coparent-invite-card" id="guardian-invite-box">
        <p class="invite-eyebrow">Co-parent invite · ${lineLabel}</p>
        ${
          guardianQr
            ? `<div class="invite-qr" id="guardian-invite-qr" role="img" aria-label="QR code for co-parent invite">${guardianQr}</div>
        <p class="tiny center invite-qr-hint">Scan with another phone · across the table</p>`
            : ""
        }
        <div class="code-box glow coparent-code" id="guardian-invite-code">${codeSafe}</div>
        <p class="tiny center coparent-invite-url">${urlSafe}</p>
        <p class="tiny">Scan the QR together, or send the link in a text. They sign in (or create an account). Opening the link while signed in finishes it for them.</p>
        <div class="btn-row two">
          <button type="button" class="primary" id="share-guardian-invite">Share</button>
          <button type="button" class="ghost" id="copy-guardian-invite">Copy</button>
        </div>
        <button type="button" class="linkish" id="invite-guardian" data-line-id="${String(lineId).replace(/"/g, "&quot;")}" style="margin-top:10px">Make a new code</button>
      </div>`;
  } else {
    inviteCard = `<div class="coparent-invite-card is-empty" id="guardian-invite-box">
        <p class="tiny">Create a code for a scannable QR (or share in a text). The other parent becomes a co-parent for <strong>${lineLabel}</strong> and can manage contacts, Quiet Time, and Child mode with you.</p>
        <button type="button" class="primary" id="invite-guardian" data-line-id="${String(lineId).replace(/"/g, "&quot;")}">Invite co-parent</button>
      </div>`;
  }

  return `
    <div class="parent-field" style="margin-top:0;padding-top:0;border-top:0">
      <h3 class="parent-subhead">Invite a co-parent</h3>
      <p class="tiny">A co-parent helps manage the same kid — contacts, Quiet Time, and Child mode — without making a second family. You don’t lock your own phone.</p>
      ${kidPicker}
      ${inviteCard}
    </div>

    <div class="parent-field">
      <h3 class="parent-subhead">${line ? `Parents for ${lineLabel}` : "Parents on this kid"}</h3>
      <ul class="guardian-list">${guardianRows}</ul>
    </div>

    ${
      line && addableMembers.length
        ? `<div class="parent-field">
      <h3 class="parent-subhead">Add from household</h3>
      <p class="tiny">Someone already in this household? Add them without a new invite.</p>
      <label>Household member</label>
      <select id="guardian-member">
        <option value="">Choose…</option>
        ${memberOptions}
      </select>
      <button type="button" class="ghost" id="add-guardian-member" data-line-id="${String(lineId).replace(/"/g, "&quot;")}" style="margin-top:10px">Add as co-parent</button>
    </div>`
        : ""
    }

    ${
      line
        ? `<div class="parent-field">
      <h3 class="parent-subhead">Add by username</h3>
      <p class="tiny">If they already have a PhoneHome parent account on the network.</p>
      <label>Username</label>
      <input id="guardian-username" autocomplete="username" placeholder="existing parent username" />
      <button type="button" class="ghost" id="add-guardian" data-line-id="${String(lineId).replace(/"/g, "&quot;")}" style="margin-top:10px">Add parent</button>
    </div>`
        : ""
    }

    <div class="parent-field">
      <h3 class="parent-subhead">Accept a co-parent invite</h3>
      <p class="tiny">Were you invited? Type the 6-digit code here, or open the invite link while you’re signed in.</p>
      <label>Invite code</label>
      <input id="guardian-code" class="mono" inputmode="numeric" maxlength="6" placeholder="······" value="${String(
        state.pendingGuardianCode || ""
      ).replace(/"/g, "&quot;")}" />
      <button type="button" class="ghost" id="redeem-guardian" style="margin-top:8px">Join as co-parent</button>
    </div>
  `;
}

/**
 * Age-friendly Settings for grandparents / invite-only relatives.
 * Large actions, few choices: Quiet Time, family approve, house phone, account.
 */
function renderGrandparentSettings() {
  const hh = state.households[0];
  const preview = isGpPreviewMode();
  const previewRel = gpPreviewRelative(hh);
  const timeoutOn = Boolean(hh?.kill_switch);
  const quietOn = Boolean(hh?.dnd);
  const pending = preview ? [] : pendingApprovals(hh);
  const contacts = preview
    ? dialableAllowlist(hh)
    : contactsInMyCircle(hh);
  const gc = preview
    ? dialableAllowlist(hh)[0] || null
    : pickPrimaryGrandchildContact(hh);
  const gcName = gc ? contactDisplayName(gc) : "";
  const setup = parentSetupSummary(hh);
  const focus = state.gpSettingsFocus;
  state.gpSettingsFocus = null;
  const titleName = preview
    ? String(previewRel?.display_label || previewRel?.display_name || "Grandparent").replace(/</g, "")
    : "";
  setAppPage(`
    <div class="gp-settings${preview ? " gp-settings-preview" : ""}">
      ${gpPreviewBannerHtml()}
      <h1 class="gp-settings-title">${preview ? `Settings · ${titleName}` : "Settings"}</h1>
      <p class="lede tight">${
        preview
          ? "This is the simple Settings screen they see. Use Exit preview, then Manage, to change their login or who they can call."
          : "Everything here is optional. To call someone, use the Phone button at the bottom."
      }</p>
      ${preview ? "" : liveCallBannerHtml(hh)}

      ${
        !preview && !setup.allRequiredDone
          ? `<section class="sheet control-card is-open gp-settings-card gp-setup-nudge${
              focus === "family" ? " gp-focus" : ""
            }">
        <h2 class="gp-card-title">A few steps to get started</h2>
        <p class="tiny">${
          setup.openRequired[0]
            ? String(setup.openRequired[0].detail || setup.openRequired[0].label).replace(/</g, "")
            : "A few things left."
        }</p>
        <button type="button" class="primary btn-block" id="gp-open-setup">Show me what to do</button>
      </section>`
          : ""
      }

      <div class="parent-now-bar${focus === "quiet" ? " gp-focus" : ""}" id="parent-now">
        <div class="parent-pill-row" aria-live="polite">
          <span class="parent-pill ${timeoutOn && !preview ? "is-off" : "is-on"}">
            <span class="dot" aria-hidden="true"></span>${
              preview ? "Calls work" : timeoutOn ? "Calls are paused" : "Calls work"
            }
          </span>
          <span class="parent-pill ${quietOn && !preview ? "is-quiet" : "is-on"}">
            <span class="dot" aria-hidden="true"></span>${
              preview ? "Phone can ring" : quietOn ? "Phone is silent" : "Phone can ring"
            }
          </span>
        </div>
        <div class="parent-now-actions" role="group" aria-label="Phone quiet controls">
          <button type="button" class="parent-action ${timeoutOn && !preview ? "is-active danger-tone" : ""}" id="toggle-kill" ${
            preview ? "disabled" : ""
          }>
            <strong>${timeoutOn && !preview ? "Allow calls again" : "Pause all calls"}</strong>
            <span>${
              preview
                ? "Preview only — not your household controls."
                : timeoutOn
                  ? "Your phone can call and be called again."
                  : "Stops every call until you turn this off."
            }</span>
          </button>
          <button type="button" class="parent-action ${quietOn && !preview ? "is-active danger-tone" : ""}" id="toggle-dnd" ${
            preview ? "disabled" : ""
          }>
            <strong>${quietOn && !preview ? "Let the phone ring again" : "Silence the phone"}</strong>
            <span>${
              preview
                ? "Preview only — exit to change their options."
                : quietOn
                  ? "People can ring you again."
                  : "Your phone will not ring until you turn this off."
            }</span>
          </button>
        </div>
      </div>

      <section class="sheet control-card is-open gp-settings-card${
        focus === "family" || focus === "account" ? " gp-focus" : ""
      }">
        <h2 class="gp-card-title">Your family</h2>
        <p class="tiny">${
          gcName
            ? `<strong>${gcName.replace(/</g, "")}</strong> is on button <strong>1</strong>. Open Phone at the bottom, then tap button 1 once to call.`
            : pending.length
              ? "Someone wants to be on your phone. Tap the button below."
              : "When your family shows up here, tap Yes, add them. They will appear on button 1."
        }</p>
        ${
          preview
            ? `<p class="tiny">${contacts.length === 1 ? "1 person on their phone" : `${contacts.length} people on their phone`} (from Manage → who they can call).</p>
        <button type="button" class="ghost btn-block" id="exit-gp-preview-settings">Exit preview &amp; manage</button>`
            : `<button type="button" class="primary btn-block" id="gp-open-family">${
                pending.length ? `Add family (${pending.length})` : "See who’s on my phone"
              }</button>
        <p class="tiny" style="margin-top:10px">${contacts.length === 1 ? "1 person on your phone" : `${contacts.length} people on your phone`}</p>`
        }
      </section>

      <section class="sheet control-card is-open gp-settings-card">
        <h2 class="gp-card-title">How do I make a call?</h2>
        <ol class="gp-howto-list">
          <li>At the bottom of the screen, tap <strong>Phone</strong>.</li>
          <li>Find the big round button marked <strong>1</strong>${
            gcName ? ` — that is <strong>${gcName.replace(/</g, "")}</strong>` : ""
          }.</li>
          <li>Tap that button <strong>once</strong>. You will hear ringing.</li>
          <li>When you are done, tap the red <strong>End</strong> button.</li>
        </ol>
        <p class="tiny">Other relatives may be on buttons <strong>2</strong> through <strong>9</strong>. Under each name it says <em>Tap once to call</em>.</p>
        <button type="button" class="primary btn-block" id="gp-goto-phone">${
          preview ? "Show their Phone screen" : "Take me to Phone"
        }</button>
      </section>

      ${preview ? "" : uiThemeSelectorHtml({ grandparent: true })}

      ${
        preview
          ? ""
          : `<section class="sheet control-card is-open gp-settings-card">
        <h2 class="gp-card-title">Regular house phone</h2>
        <p class="tiny">Only if someone hooked up a wall phone for you. Most people can skip this.</p>
        <button type="button" class="ghost btn-block" id="gp-open-analog">House phone setup</button>
      </section>

      <section class="sheet control-card is-open gp-settings-card${focus === "account" ? " gp-focus" : ""}">
        <h2 class="gp-card-title">This phone</h2>
        <p class="tiny">Your picture, ringtone, and how you sign in${
          state.user?.username
            ? ` · signed in as <span class="mono">${String(state.user.username).replace(/</g, "")}</span>`
            : ""
        }.</p>
        <button type="button" class="ghost btn-block" id="gp-open-profile">Picture &amp; ringtone</button>
        <button type="button" class="ghost btn-block" id="gp-open-account" style="margin-top:8px">Change how I sign in</button>
      </section>

      <section class="sheet control-card is-open gp-settings-card">
        <h2 class="gp-card-title">Show me</h2>
        <div class="ringer-grid" style="margin-bottom:10px">
          <button type="button" class="ringer-opt ${String(state.user?.profile_role || "") === "grandparent" || (!state.user?.profile_role && isGrandparentExperience()) ? "on" : ""}" data-profile-role="grandparent">Simple version (recommended)</button>
          <button type="button" class="ringer-opt ${state.user?.profile_role === "parent" ? "on" : ""}" data-profile-role="parent">Full parent version</button>
        </div>
        <button type="button" class="primary" id="gp-save-role">Save</button>
      </section>`
      }
    </div>
  `);

  bindGpPreviewChrome();
  document.getElementById("exit-gp-preview-settings")?.addEventListener("click", () => exitGpPreview());

  if (!preview) {
    document.getElementById("toggle-kill").onclick = async () => {
      try {
        await api(`/api/households/${hh.id}/rules`, {
          method: "PATCH",
          body: JSON.stringify({ kill_switch: !hh.kill_switch }),
        });
        await refresh();
      } catch (e) {
        setFlash(e.message || "Could not update", "error");
      }
    };
    document.getElementById("toggle-dnd").onclick = async () => {
      try {
        await api(`/api/households/${hh.id}/rules`, {
          method: "PATCH",
          body: JSON.stringify({ dnd: !hh.dnd }),
        });
        await refresh();
      } catch (e) {
        setFlash(e.message || "Could not update", "error");
      }
    };
    document.getElementById("gp-open-family").onclick = () => {
      state.screen = "manage-contacts";
      render();
    };
    document.getElementById("gp-open-setup")?.addEventListener("click", () => {
      reopenSetupChecklist();
    });
    document.getElementById("gp-open-analog").onclick = () => {
      state._forceFullParentSettings = true;
      state.parentScrollTo = "parent-ata";
      render();
    };
    document.getElementById("gp-open-profile").onclick = () => {
      void openProfilePanel();
    };
    document.getElementById("gp-open-account").onclick = () => {
      state._forceFullParentSettings = true;
      state.parentScrollTo = "parent-account";
      render();
    };
    document.querySelectorAll("[data-profile-role]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-profile-role]").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
      });
    });
    document.getElementById("gp-save-role").onclick = async () => {
      const picked =
        document.querySelector("[data-profile-role].on")?.getAttribute("data-profile-role") ||
        "grandparent";
      try {
        const data = await api("/api/user/profile", {
          method: "PATCH",
          body: JSON.stringify({ profile_role: picked }),
        });
        state.user = data.user || state.user;
        setFlash(picked === "parent" ? "Now showing the full parent screens" : "Back to the simple screens", "ok");
        render();
      } catch (e) {
        setFlash(e.message || "Could not save", "error");
      }
    };
    bindUiThemeSelector(document.querySelector(".gp-settings") || document);
  }

  document.getElementById("gp-goto-phone")?.addEventListener("click", () => {
    state.screen = "home";
    state.nav = "phone";
    localStorage.setItem("kl_nav", "phone");
    render();
  });
  const focusEl = document.querySelector(".gp-settings .gp-focus");
  if (focusEl) {
    requestAnimationFrame(() => {
      focusEl.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}

function mothershipCapacityBanner() {
  const m = state.mothership;
  if (!m || state.childMode) return "";
  if (m.atPodLimit) {
    return `<p class="flash warn" role="status">This Mothership is full (${m.podCount}/${m.maxPods} Pods). New families need another Mothership.</p>`;
  }
  if (m.warnPodsReached || m.warnLinesReached) {
    const bits = [];
    if (m.warnPodsReached) bits.push(`${m.podCount} Pods`);
    if (m.warnLinesReached) bits.push(`${m.lineCount} lines`);
    return `<p class="flash warn tiny" role="status">Large Mothership (${bits.join(", ")}). For distant branches, consider starting a second Mothership.</p>`;
  }
  return "";
}

function renderControls() {
  if (isGrandparentExperience() && !state._forceFullParentSettings) {
    renderGrandparentSettings();
    return;
  }
  state._forceFullParentSettings = false;
  const keepScroll = state.parentScrollTo ? 0 : pageScrollTop();
  captureAtaFormDraftFromDom();
  const hh = state.households[0];
  const lines = hh?.lines || [];
  const line = activeLine();
  const ataLine = resolveAtaTargetLine(hh);
  const ataLineLabel = ataLine?.child_label || ataLine?.name || "this kid";
  const ataKids = manageKidLines(hh);
  const lineLabel = line?.child_label || line?.name || "this line";
  const needsCreds = !state.user?.username || !state.user?.has_password;
  const ringVol = hh.ring_volume ?? 70;
  const contacts = externalAllowlist(hh);
  const kidLines = householdKidLines(hh);
  const timeoutOn = Boolean(hh.kill_switch);
  const quietOn = Boolean(hh.dnd);
  const accOpen = resolveParentAccordionId(state.parentScrollTo || undefined);
  const uiThemeLabelText = uiThemeLabel();
  const searchVal = String(state.parentSearch || "").replace(/"/g, "&quot;");
  const kidsChip = kidLines.length
    ? `<span class="parent-summary-chip"><strong>${kidLines.length}</strong><span>kid${kidLines.length === 1 ? "" : "s"}</span></span>`
    : `<span class="parent-summary-chip parent-summary-chip-warn"><strong>0</strong><span>kids yet</span></span>`;
  setAppPage(`
      <p class="lede tight">Timeout and Quiet Time stay up top. Then kids, people, rooms, Pod rules, and this phone.</p>
      ${mothershipCapacityBanner()}
      ${liveCallBannerHtml(hh)}

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
        <a href="#parent-kids">Kids</a>
        <a href="#parent-people">Contacts</a>
        <a href="#parent-coparents">Co-parents</a>
        <a href="#parent-grandparents">Grandparents</a>
        <a href="#parent-ata">Analog</a>
        <a href="#parent-themes">Themes ${betaBadgeHtml()}</a>
        <a href="#parent-treehouse">Rooms</a>
        <a href="#parent-hours">Schedule</a>
        <a href="#parent-pin">PIN</a>
        <a href="#parent-line">This phone</a>
        <a href="#parent-help">Help</a>
        <a href="#parent-account">Account</a>
      </nav>

      ${parentGroupLabel("people", "People")}
      <section class="sheet control-card parent-section${accOpen === "parent-kids" ? " is-open" : ""}" id="parent-kids" data-acc data-parent-group="people">
        ${parentSecToggle(
          "parent-kids",
          "Kids",
          kidLines.length
            ? "Their phones, photos, and greetings."
            : "Add your kid here — first step for house phone and Quiet Time.",
          accOpen === "parent-kids",
          "people",
          kidsChip
        )}
        <div class="parent-sec-body" id="parent-kids-body" role="region" aria-labelledby="parent-kids-toggle"${accOpen === "parent-kids" ? "" : " hidden"}>
        ${
          kidLines.length
            ? `<ul class="guardian-list">
            ${kidLines
              .map(
                (l) =>
                  `<li><span>${String(l.child_label || l.name || "Kid").replace(/</g, "")}</span><span class="guardian-actions"><button type="button" class="ghost tiny-btn" data-edit-child-profile="${l.id}">Photo &amp; greeting</button><button type="button" class="ghost tiny-btn danger" data-delete-child-line="${l.id}">Delete</button></span></li>`
              )
              .join("")}
          </ul>
          ${
            state.kidJustAdded
              ? `<div class="add-kid-next" id="add-kid-next">
            <p class="add-kid-next-lead"><strong>${String(state.kidJustAdded).replace(/</g, "")}</strong> is on your dial <strong>1</strong>. Next:</p>
            <div class="btn-row three">
              <button type="button" class="primary" id="kid-next-pin">Set PIN</button>
              <button type="button" class="ghost" id="kid-next-analog">House phone</button>
              <button type="button" class="ghost" id="kid-next-invite">Invite</button>
            </div>
          </div>`
              : ""
          }
          ${addKidCardHtml()}`
            : addKidCardHtml({ prominent: true })
        }
        <p class="tiny" style="margin-top:12px">After you add a kid, they show on your speed dial <strong>1</strong>. Optional house phone: <button type="button" class="linkish" id="kids-go-analog">Analog Phone</button>.</p>
        </div>
      </section>

      <section class="sheet control-card parent-section${accOpen === "parent-people" ? " is-open" : ""}" id="parent-people" data-acc data-parent-group="people">
        ${parentSecToggle("parent-people", "Contacts &amp; speed dials", "Your people, invites, and which lists kids can call.", accOpen === "parent-people", "people")}
        <div class="parent-sec-body" id="parent-people-body" role="region" aria-labelledby="parent-people-toggle"${accOpen === "parent-people" ? "" : " hidden"}>
        <div class="parent-summary-row">
          <div class="parent-summary-chip">
            <strong>${contacts.length}</strong>
            <span>contact${contacts.length === 1 ? "" : "s"}</span>
          </div>
          <div class="parent-summary-chip">
            <strong>${kidLines.length}</strong>
            <span>kid${kidLines.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        ${canInviteFamily() ? renderParentCirclesBlock(hh, kidLines) : ""}
        <p class="tiny">Edit nicknames, dial slots, and VIP (VIP still rings during Quiet Time). On Home, hold a contact to rearrange when unlocked. Add people by <strong>invite</strong> — there is no global search of other kids’ friends.</p>
        <div class="btn-row ${canInviteFamily() ? "two" : ""}">
          <button type="button" class="primary" id="go-manage-contacts">Edit contacts</button>
          ${
            canInviteFamily()
              ? `<button type="button" class="ghost" id="go-invite">Invite into my circle</button>`
              : ""
          }
        </div>
        ${
          kidLines.length
            ? ""
            : `<p class="tiny ata-lan-warn" style="margin-top:12px">No kids yet — add one under <button type="button" class="linkish" id="people-go-kids">Kids</button> first.</p>`
        }
        </div>
      </section>

<section class="sheet control-card parent-section${accOpen === "parent-coparents" ? " is-open" : ""}" id="parent-coparents" data-acc data-parent-group="people">
        ${parentSecToggle(
          "parent-coparents",
          "Co-parents",
          "Invite a second parent to manage a kid with you.",
          accOpen === "parent-coparents",
          "people"
        )}
        <div class="parent-sec-body" id="parent-coparents-body" role="region" aria-labelledby="parent-coparents-toggle"${
          accOpen === "parent-coparents" ? "" : " hidden"
        }>
        ${renderCoParentsPanel(hh)}
        </div>
      </section>

<section class="sheet control-card parent-section${accOpen === "parent-grandparents" ? " is-open" : ""}" id="parent-grandparents" data-acc data-parent-group="people">
        ${parentSecToggle(
          "parent-grandparents",
          "Grandparents",
          "Set a login for Grandma or Grandpa and choose which kids they can call.",
          accOpen === "parent-grandparents",
          "people"
        )}
        <div class="parent-sec-body" id="parent-grandparents-body" role="region" aria-labelledby="parent-grandparents-toggle"${
          accOpen === "parent-grandparents" ? "" : " hidden"
        }>
        ${renderGrandparentsPanel(hh)}
        </div>
      </section>

      ${parentGroupLabel("rooms", "Rooms")}
<section class="sheet control-card parent-section${accOpen === "parent-treehouse" ? " is-open" : ""}" id="parent-treehouse" data-acc data-parent-group="rooms">
        ${parentSecToggle(
          "parent-treehouse",
          "TreeHouse",
          "Kids hang out on the house button (0). You choose who they hear. Parents listen only.",
          accOpen === "parent-treehouse",
          "familyroom"
        )}
        <div class="parent-sec-body" id="parent-treehouse-body" role="region" aria-labelledby="parent-treehouse-toggle"${
          accOpen === "parent-treehouse" ? "" : " hidden"
        }>
        ${renderTreeHouseParentBlock(hh)}
        </div>
      </section>

<section class="sheet control-card parent-section${accOpen === "parent-adult-familyroom" ? " is-open" : ""}" id="parent-adult-familyroom" data-acc data-parent-group="rooms">
        ${parentSecToggle(
          "parent-adult-familyroom",
          "FamilyRoom",
          "Family talk on the # button. Press #, then 1 for this house or 2 for the other parent.",
          accOpen === "parent-adult-familyroom",
          "familyroom",
          "",
          { beta: true }
        )}
        <div class="parent-sec-body" id="parent-adult-familyroom-body" role="region" aria-labelledby="parent-adult-familyroom-toggle"${
          accOpen === "parent-adult-familyroom" ? "" : " hidden"
        }>
        ${renderAdultFamilyRoomParentBlock(hh)}
        </div>
      </section>

      ${parentGroupLabel("rules", "Household rules")}
<section class="sheet control-card parent-section${accOpen === "parent-hours" ? " is-open" : ""}" id="parent-hours" data-acc data-parent-group="rules">
        ${parentSecToggle(
          "parent-hours",
          "Quiet Time &amp; limits",
          "See each kid’s hours and talk time. Set Do Not Disturb for your phone separately.",
          accOpen === "parent-hours",
          "hours",
          parentHoursChipHtml(hh, kidLines)
        )}
        <div class="parent-sec-body" id="parent-hours-body" role="region" aria-labelledby="parent-hours-toggle"${accOpen === "parent-hours" ? "" : " hidden"}>
        ${renderParentHoursBody(hh, kidLines)}
        </div>
      </section>

<section class="sheet control-card parent-section${accOpen === "parent-pin" ? " is-open" : ""}" id="parent-pin" data-acc data-parent-group="rules">
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

      ${parentGroupLabel("device", "This phone")}
<section class="sheet control-card parent-section${accOpen === "parent-line" ? " is-open" : ""}" id="parent-line" data-acc data-parent-group="device">
        ${parentSecToggle(
          "parent-line",
          "This phone",
          "Line, how it rings, and lock-screen Answer — on this device only.",
          accOpen === "parent-line",
          "line"
        )}
        <div class="parent-sec-body" id="parent-line-body" role="region" aria-labelledby="parent-line-toggle"${accOpen === "parent-line" ? "" : " hidden"}>
        <label>Active line</label>
        <select id="line">${lines
          .map(
            (l) =>
              `<option value="${l.id}" ${l.id === state.activeLineId ? "selected" : ""}>${l.child_label || l.name}${l.mode === "child" ? " · child" : ""}</option>`
          )
          .join("")}</select>
        <p class="tiny">Outgoing calls and the profile picture follow this line. Analog Phone has its own line picker for the adapter. Set a <strong>Parent PIN</strong> before locking Child mode.</p>

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
          <h3 class="parent-subhead">This phone is for a kid</h3>
          <p class="tiny">Only if <strong>this</strong> handset should be a kid phone (Child mode). To create a kid while keeping your parent phone, use <button type="button" class="linkish" id="line-go-add-kid">Kids → Add a kid</button>.</p>
          ${
            line?.mode === "child"
              ? `<p class="parent-mode-chip"><span class="dot" aria-hidden="true"></span>Child mode is on for this line</p>
          <label style="margin-top:10px">Kid label (optional)</label>
          <input id="child-label" placeholder="e.g. Maya’s phone" value="${(line?.child_label || "").replace(/"/g, "&quot;")}" />
          <button class="ghost" id="save-child-label" style="margin-top:10px">Save label</button>`
              : `<details class="parent-advanced">
            <summary>Lock this device (advanced)</summary>
            <p class="tiny" style="margin-top:10px">Requires a Parent PIN. Exit Child mode needs that PIN.</p>
            <label>Kid label (optional)</label>
            <input id="child-label" placeholder="e.g. Maya’s phone" value="${(line?.child_label || "").replace(/"/g, "&quot;")}" />
            <div class="btn-row two" style="margin-top:10px">
              <button class="ghost" id="enable-child">Lock as kid phone</button>
              <button class="ghost" id="save-child-label">Save label</button>
            </div>
          </details>`
          }
        </div>

        ${
          line?.mode === "child"
            ? `<details class="parent-advanced">
          <summary>Child login (optional)</summary>
          <div class="parent-field" style="margin-top:12px;padding-top:0;border-top:0">
            <h3 class="parent-subhead">Child login</h3>
            <p class="tiny">${
              line.child_user
                ? `Optional login <strong>${line.child_user.username}</strong> — co-parents can reset the password.`
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
        <p class="tiny" style="margin-top:12px">To permanently remove this kid line, use <strong>Contacts → Kid profiles → Delete</strong>.</p>`
            : ""
        }

        <div class="parent-field" id="parent-sounds">
          <h3 class="parent-subhead">Ringer</h3>
          <p class="tiny">Volume and ring sound when <strong>this phone</strong> rings — not what the caller hears.</p>
          <label id="ring-volume-label">Volume (${ringVol})</label>
          <input id="ring-volume" type="range" min="0" max="100" step="5" value="${ringVol}" />
          <label style="margin-top:10px">Ring sound</label>
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
        ${iosCallKitToggleHtml("ios-callkit")}
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
          <h3 class="parent-subhead parent-subhead-with-badge">${withBetaBadge("Speaker (call screening)")}</h3>
          <p class="tiny">Optional — off by default. Hear the message while it’s left, like a 90s answering machine.</p>
          <label class="check-row">
            <input type="checkbox" id="answering-machine" ${line?.answering_machine ? "checked" : ""} />
            Play messages out loud as they’re left
          </label>
        </div>
        </div>
      </section>

      ${parentGroupLabel("house", "House phone")}
<section class="sheet control-card parent-section${accOpen === "parent-ata" ? " is-open" : ""}" id="parent-ata" data-acc data-parent-group="house">
        ${parentSecToggle(
          "parent-ata",
          "Analog Phone",
          "A regular house phone through the small adapter box.",
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
                : `<p class="tiny ata-lan-warn">Add a kid first — then you can hook up their house phone.</p>
            <button type="button" class="primary" id="ata-go-add-kid">Add a kid</button>`
            }
          </div>

          ${analogPhoneStatusBannerHtml(ataLine)}

          ${analogPhotosHtml()}

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
            <label class="check-row"><input type="radio" name="ata-model" value="ht801" ${isFanvil ? "" : "checked"} /> Grandstream HT801 v2</label>
            <label class="check-row"><input type="radio" name="ata-model" value="g100s" ${isFanvil ? "checked" : ""} /> Fanvil G100S</label>
          </div>`;

            const remoteCard = `
          <div class="ata-mode-card ata-mode-remote ${lanPushKnownOff ? "ata-mode-preferred" : ""}" id="ata-remote-box">
            <div class="ata-mode-badge">${lanPushKnownOff ? "Use this" : "Hub elsewhere"}</div>
            <h3 class="parent-subhead">Download config</h3>
            <p class="tiny">${
              lanPushKnownOff
                ? "The Mothership isn’t on the adapter’s Wi‑Fi. Download the file, then upload it in the box’s admin page."
                : "When the Mothership can’t reach the adapter, download the file and upload it in the box’s admin page."
            }</p>
            <button type="button" class="${lanPushKnownOff ? "primary" : "ghost"}" id="ata-download" ${canPush ? "" : "disabled"}>Download config</button>
            ${
              canPush
                ? isFanvil
                  ? `<div class="ata-admin-guide">
              <h4 class="ata-adv-sub">Where to upload on the Fanvil</h4>
              ${analogFanvilAdminStepsHtml()}
            </div>`
                  : `<div class="ata-admin-guide">
              <h4 class="ata-adv-sub">Where to upload on the Grandstream</h4>
              <p class="tiny">Open the HT801 v2 admin page, then: <strong>Maintenance → Upgrade → Upload Configuration</strong>.</p>
              ${analogHt801AdminStepsHtml({ purpose: "upload" })}
            </div>`
                : `<p class="tiny ata-actions-hint">Save connection first.</p>`
            }
          </div>`;

            const lanCard = isHt801
              ? `
          <div class="ata-mode-card ata-mode-lan ${lanPushKnownOff ? "ata-mode-unavailable" : "ata-mode-preferred"}" id="ata-push-box">
            <div class="ata-mode-badge">${lanPushKnownOff ? "Needs Mothership nearby" : "Mothership on Wi‑Fi"}</div>
            <h3 class="parent-subhead">Set up adapter</h3>
            ${
              lanPushKnownOff
                ? `<p class="tiny ata-lan-warn">One-tap needs the Mothership on the same Wi‑Fi as the HT801. Use <strong>Download config</strong> instead.</p>`
                : `<p class="tiny">Mothership on the same Wi‑Fi as the HT801 uploads config for you. Your phone app can be anywhere.</p>
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
          <details class="ata-help"${hasAta ? "" : " open"}>
            <summary>${isFanvil ? "How to finish on the Fanvil" : "How to finish on the Grandstream"}</summary>
            <p class="tiny">${
              hasAta
                ? "Use Set up adapter or Download config above. Full admin clicks are under Download config."
                : "After you Save connection, this screen shows <strong>Set up adapter</strong> and <strong>Download config</strong>. For Download: find the box IP with <span class=\"mono\">***</span> then <span class=\"mono\">02</span> on the handset → open <span class=\"mono\">https://</span> that IP → <strong>Maintenance → Upgrade → Upload Configuration</strong>."
            }</p>
            ${
              hasAta
                ? ""
                : `<p class="tiny">Power + Ethernet on the box first (NET jack). House phone goes in the <strong>green</strong> jack after config.</p>`
            }
          </details>`;

            if (!ataKids.length || status.kind === "no-line") {
              return "";
            }

            if (!hasAta) {
              return `
          <div class="ata-primary">
            <h3 class="parent-subhead">Set up this line</h3>
            <p class="tiny"><strong>Step 1:</strong> choose the adapter and tap <strong>Save connection</strong>. <strong>Step 2:</strong> you’ll get <strong>Set up adapter</strong> (same-house Wi‑Fi) or <strong>Download config</strong> to upload on the box.</p>
            ${modelRadios}
            <div class="ata-save-cta">
              <button type="button" class="primary" id="ata-save" ${ataLine ? "" : "disabled"}>Save connection</button>
              <p class="tiny ata-actions-hint">Assigns a unique extension. Password stays hidden. Download / one-tap appear after Save.</p>
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
              status.kind === "offline"
                ? lanPushKnownOff || isFanvil
                  ? "Download config again and upload it on the adapter, then reboot the box. Status turns live when it registers."
                  : "Prefer Set up adapter if the Mothership shares Wi‑Fi with the box. Otherwise Download config → upload → reboot."
                : status.kind === "online" && keepFormOpen
                  ? "Push or download config again so the adapter re-registers."
                  : isFanvil
                    ? "Download config and import it on the adapter."
                    : "Set up via Mothership, or download and upload on the adapter.";

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
            <p class="tiny">Server, MAC, caller ID, config path, disconnect. SIP passwords stay hidden. Adapter model is chosen above.</p>
            ${ataLine?.ata ? analogNeedAdapterLinkHtml() : ""}
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
                  ? "On the Fanvil: <strong>System → Auto Provision</strong> → paste the HTTPS URL → Apply → reboot."
                  : "On the HT801 v2: left menu <strong>Maintenance → Upgrade</strong> → <strong>Config Upgrade via: HTTPS</strong> → paste into <strong>Config Server Path</strong> → leave Firmware Server Path empty → Save / Apply → reboot."
              }</p>
              ${
                (state.ataModelDraft || ataLine?.ata?.model) === "g100s"
                  ? ""
                  : analogHt801AdminStepsHtml({ purpose: "config-path" })
              }
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

      </section>

      ${parentGroupLabel("look", "Look")}
      <section class="sheet control-card parent-section${accOpen === "parent-themes" ? " is-open" : ""}" id="parent-themes" data-acc data-parent-group="look">
        ${parentSecToggle(
          "parent-themes",
          "Themes",
          "How PhoneHome looks on this device.",
          accOpen === "parent-themes",
          "appearance",
          `<span class="parent-summary-chip" id="parent-themes-chip"><strong>${uiThemeLabelText}</strong></span>`,
          { beta: true }
        )}
        <div class="parent-sec-body" id="parent-themes-body" role="region" aria-labelledby="parent-themes-toggle"${accOpen === "parent-themes" ? "" : " hidden"}>
          <p class="tiny" style="margin-top:0">Saved on this device only — swap looks anytime.</p>
          ${uiThemeSelectorHtml({ bare: true })}
        </div>
      </section>

      ${parentGroupLabel("more", "Help &amp; account")}
<section class="sheet control-card parent-section${accOpen === "parent-help" ? " is-open" : ""}" id="parent-help" data-acc data-parent-group="more">
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
          <p class="tiny">A short walkthrough of how PhoneHome works — calling, invites, themes, Quiet Time, and parent tools.</p>
          <button class="ghost" id="tutorial">Show tutorial</button>
        </div>
        <div class="parent-field">
          <h3 class="parent-subhead">Guides</h3>
          <p class="tiny">Quick answers for common parent tasks. Expand a topic to read more.</p>
          <div class="help-articles">
            ${parentHelpArticles().map(parentHelpArticleHtml).join("")}
          </div>
        </div>
        </div>
      </section>

<section class="sheet control-card parent-section${accOpen === "parent-account" ? " is-open" : ""}" id="parent-account" data-acc data-parent-group="more">
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
        ${
          isNativeIosShell() || nativePlugin()
            ? `<div class="parent-field" id="parent-faceid">
          <h3 class="parent-subhead">Face ID sign-in</h3>
          <p class="tiny" id="faceid-account-status">Checking this iPhone…</p>
          <div id="faceid-enable-wrap" hidden>
            <p class="tiny">Type your PhoneHome password once. It’s stored in the iPhone Keychain (this device only) so Face ID can sign you in later.</p>
            <label for="faceid-enable-pass">Password</label>
            <input id="faceid-enable-pass" type="password" autocomplete="current-password" placeholder="••••••••" />
            <button type="button" class="primary" id="faceid-enable" style="margin-top:10px">Save for Face ID</button>
          </div>
          <button type="button" class="ghost" id="faceid-forget" hidden style="margin-top:10px">Forget Face ID on this iPhone</button>
        </div>`
            : ""
        }
        <div class="parent-field">
          <h3 class="parent-subhead">Mom or Dad</h3>
          <p class="tiny">How kids’ phones should name you — on speed dial and in the house. Optional; otherwise they see your name.</p>
          ${parentTitlePickerHtml()}
        </div>
        <div class="parent-field parent-danger-zone">
          <h3 class="parent-subhead">Delete account</h3>
          <p class="tiny">Permanently erases your parent account. If you’re the only parent on this household, the whole household is wiped (all kid lines, contacts, voicemails, greetings). If another household member remains, ownership transfers to them and your account leaves. Other families who had your kids on speed dial lose those contacts. This cannot be undone.</p>
          <label class="tiny" for="delete-account-confirm">Type <strong>delete</strong> to confirm</label>
          <input id="delete-account-confirm" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="delete" />
          <button type="button" class="danger" id="delete-parent-account" disabled>Delete my account</button>
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
        <p class="tiny">Source and license: github.com/trevlars/PhoneHome · Inspired by Digits (AGPL-3.0).</p>
      </footer>
  `);

  bindParentAccordion();
  bindParentSearch();
  bindParentTitlePicker();
  void bindFaceIdAccountSettings();
  bindUiThemeSelector(document.getElementById("parent-themes") || document);
  bindAtaFormDraftPersistence();
  document.getElementById("ata-intro-dismiss")?.addEventListener("click", () => {
    dismissAtaIntro();
    render();
  });
  document.getElementById("ata-intro-help")?.addEventListener("click", () => {
    state.parentHelpFocus = "analog";
    state.parentScrollTo = "parent-help";
    render();
  });
  void ensureKidPhoneStatuses(hh).then((changed) => {
    if (changed && state.nav === "controls") patchAnalogPhoneStatus(hh);
  });
  if (state.parentScrollTo) {
    const jumpId = state.parentScrollTo;
    state.parentScrollTo = "";
    const accId = canonicalParentAccId(jumpId);
    setParentAccordionOpen(accId);
    requestAnimationFrame(() => {
      let targetId = accId || jumpId;
      if (jumpId === "add-kid" || jumpId === "parent-kids") targetId = "add-kid";
      else if (jumpId === "parent-sounds") targetId = "parent-sounds";
      const el = document.getElementById(targetId) || document.getElementById(accId || jumpId);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (jumpId === "add-kid" || jumpId === "parent-kids") {
        document.getElementById("add-kid-name")?.focus();
      }
    });
  } else {
    persistParentAccordionId(accOpen);
    if (keepScroll > 2) {
      const y = keepScroll;
      const restore = () => {
        window.scrollTo(0, y);
        if (document.documentElement) document.documentElement.scrollTop = y;
        if (document.body) document.body.scrollTop = y;
      };
      restore();
      requestAnimationFrame(restore);
    }
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
  const goAddKid = () => {
    state.parentScrollTo = "parent-kids";
    render();
  };
  document.getElementById("ata-go-add-kid")?.addEventListener("click", goAddKid);
  document.getElementById("line-go-add-kid")?.addEventListener("click", goAddKid);
  document.getElementById("people-go-kids")?.addEventListener("click", goAddKid);
  document.getElementById("coparents-go-kids")?.addEventListener("click", goAddKid);
  document.getElementById("kids-go-analog")?.addEventListener("click", () => {
    state.kidJustAdded = "";
    state.parentScrollTo = "parent-ata";
    render();
  });
  document.getElementById("kid-next-pin")?.addEventListener("click", () => {
    state.kidJustAdded = "";
    state.parentScrollTo = "parent-pin";
    render();
  });
  document.getElementById("kid-next-analog")?.addEventListener("click", () => {
    state.kidJustAdded = "";
    state.parentScrollTo = "parent-ata";
    render();
  });
  document.getElementById("kid-next-invite")?.addEventListener("click", () => {
    state.kidJustAdded = "";
    state.screen = "invite";
    render();
  });
  document.getElementById("add-kid-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!hh) return;
    const input = document.getElementById("add-kid-name");
    const raw = input?.value.trim();
    if (!raw) {
      setFlash("Type your kid’s first name", "warn");
      input?.focus();
      return;
    }
    try {
      await api(`/api/households/${hh.id}/lines`, {
        method: "POST",
        body: JSON.stringify({
          name: raw,
          type: "softphone",
          mode: "child",
          child_label: raw,
        }),
      });
      state.kidJustAdded = raw;
      setFlash(`${raw} added — on dial 1. Set a PIN, or hook up a house phone.`, "ok");
      state.parentScrollTo = "parent-kids";
      await refresh();
    } catch (err) {
      setFlash(err.message || "Could not add kid", "error");
      render();
    }
  });
  document.querySelectorAll("[data-familyroom-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const lineId = btn.getAttribute("data-familyroom-toggle");
      const on = btn.getAttribute("data-approved") === "1";
      if (!lineId || !hh) return;
      try {
        if (on) {
          await api(`/api/households/${hh.id}/tree-house/members/${encodeURIComponent(lineId)}`, {
            method: "DELETE",
          });
          setFlash("Removed from TreeHouse", "ok");
        } else {
          await api(`/api/households/${hh.id}/tree-house/members`, {
            method: "POST",
            body: JSON.stringify({ lineId }),
          });
          setFlash("Approved for TreeHouse", "ok");
        }
        await refresh();
        state.parentScrollTo = "parent-treehouse";
        render();
      } catch (e) {
        setFlash(e.message || "Could not update TreeHouse", "error");
      }
    });
  });
  document.querySelectorAll("[data-adult-familyroom-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const lineId = btn.getAttribute("data-adult-familyroom-toggle");
      const on = btn.getAttribute("data-approved") === "1";
      if (!lineId || !hh) return;
      try {
        if (on) {
          await api(`/api/households/${hh.id}/adult-family-room/members/${encodeURIComponent(lineId)}`, {
            method: "DELETE",
          });
          setFlash("Removed from FamilyRoom", "ok");
        } else {
          await api(`/api/households/${hh.id}/adult-family-room/members`, {
            method: "POST",
            body: JSON.stringify({ lineId }),
          });
          setFlash("Approved for FamilyRoom", "ok");
        }
        await refresh();
        state.parentScrollTo = "parent-adult-familyroom";
        render();
      } catch (e) {
        setFlash(e.message || "Could not update FamilyRoom", "error");
      }
    });
  });
  document.querySelectorAll("[data-playroom-talk]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const lineA = btn.getAttribute("data-playroom-talk");
      const lineB = btn.getAttribute("data-playroom-talk-b");
      const on = btn.getAttribute("data-on") === "1";
      if (!lineA || !lineB || !hh) return;
      try {
        if (on) {
          await api(
            `/api/households/${hh.id}/tree-house/talk-pairs/${encodeURIComponent(lineA)}/${encodeURIComponent(lineB)}`,
            { method: "DELETE" }
          );
          setFlash("Talk unlinked", "ok");
        } else {
          await api(`/api/households/${hh.id}/tree-house/talk-pairs`, {
            method: "POST",
            body: JSON.stringify({ lineA, lineB }),
          });
          setFlash("They can hear each other now", "ok");
        }
        await refresh();
        state.parentScrollTo = "parent-treehouse";
        render();
      } catch (e) {
        setFlash(e.message || "Could not update talk pair", "error");
      }
    });
  });
  document.querySelectorAll("[data-playroom-listen]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const childId = btn.getAttribute("data-playroom-listen");
      const on = btn.getAttribute("data-on") === "1";
      if (!childId) return;
      if (on) stopTreeHouseListen(false);
      else startTreeHouseListen(childId);
      state.parentScrollTo = "parent-treehouse";
    });
  });
  document.getElementById("go-invite")?.addEventListener("click", () => {
    state.screen = "invite";
    render();
  });
  document.getElementById("save-sphere-name")?.addEventListener("click", async () => {
    const name = document.getElementById("sphere-name")?.value?.trim();
    if (!name) {
      setFlash("Circle name required", "error");
      return;
    }
    try {
      await api(`/api/households/${hh.id}/spheres/mine`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setFlash("Circle name saved", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save circle name", "error");
      render();
    }
  });
  document.querySelectorAll("[data-save-kid-spheres]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const lineId = btn.getAttribute("data-save-kid-spheres");
      if (!lineId) return;
      const sphereIds = [
        ...document.querySelectorAll(`input[data-kid-sphere="${lineId}"]:checked`),
      ].map((el) => el.getAttribute("data-sphere-id")).filter(Boolean);
      try {
        await api(`/api/households/${hh.id}/lines/${lineId}/sphere-access`, {
          method: "PUT",
          body: JSON.stringify({ sphereIds }),
        });
        setFlash("Kid speed-dial circles updated", "ok");
        await refresh();
      } catch (e) {
        setFlash(e.message || "Could not save circles", "error");
        render();
      }
    });
  });
  document.querySelectorAll("[data-edit-child-profile]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-edit-child-profile");
      if (!id) return;
      // Open Profile for this kid without stealing their softphone registration.
      state.editLineId = id;
      const ok = await openProfilePanel();
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
  bindDeleteAccountConfirm();
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
  document.getElementById("hours-go-line")?.addEventListener("click", () => {
    state.parentScrollTo = "parent-kids";
    render();
  });
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.onclick = async () => {
      state.parentHoursKidsCustom = false;
      const body = {
        schedule_preset: btn.getAttribute("data-preset"),
        quiet_tz: hh.quiet_tz || browserTimeZone(),
      };
      await api(`/api/households/${hh.id}/rules`, { method: "PATCH", body: JSON.stringify(body) });
      setFlash("Kids’ hours updated", "ok");
      await refresh();
    };
  });
  document.querySelectorAll("[data-parent-preset]").forEach((btn) => {
    btn.onclick = async () => {
      const p = btn.getAttribute("data-parent-preset");
      if (p === "custom") {
        state.parentHoursYouCustom = true;
        render();
        return;
      }
      state.parentHoursYouCustom = false;
      try {
        await api(`/api/households/${hh.id}/rules`, {
          method: "PATCH",
          body: JSON.stringify({
            parent_schedule_preset: p,
            parent_quiet_tz: hh.parent_quiet_tz || hh.quiet_tz || browserTimeZone(),
          }),
        });
        setFlash(p === "open" ? "Your phone rings anytime" : "Evening Do Not Disturb saved", "ok");
        await refresh();
      } catch (err) {
        setFlash(err.message || "Could not update your hours", "error");
        render();
      }
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
  document.getElementById("custom-quiet")?.addEventListener("click", () => {
    state.parentHoursKidsCustom = true;
    render();
  });
  document.getElementById("save-kids-custom")?.addEventListener("click", async () => {
    try {
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({
          quiet_start: document.getElementById("kids-q-start").value,
          quiet_end: document.getElementById("kids-q-end").value,
          quiet_tz: document.getElementById("kids-q-tz").value,
          schedule_preset: "custom",
        }),
      });
      state.parentHoursKidsCustom = false;
      setFlash("Custom hours saved", "ok");
      await refresh();
    } catch (err) {
      setFlash(err.message || "Could not save hours", "error");
    }
  });
  document.getElementById("save-you-custom")?.addEventListener("click", async () => {
    try {
      await api(`/api/households/${hh.id}/rules`, {
        method: "PATCH",
        body: JSON.stringify({
          parent_quiet_start: document.getElementById("you-q-start").value,
          parent_quiet_end: document.getElementById("you-q-end").value,
          parent_quiet_tz: document.getElementById("you-q-tz").value,
          parent_schedule_preset: "custom",
        }),
      });
      state.parentHoursYouCustom = false;
      setFlash("Your Do Not Disturb saved", "ok");
      await refresh();
    } catch (err) {
      setFlash(err.message || "Could not save your hours", "error");
    }
  });
  document.getElementById("save-cap")?.addEventListener("click", async () => {
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
  });
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
  bindIosCallKitToggle("ios-callkit");
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
      if (data?.freepbx_ready === false) {
        setFlash(
          ext
            ? `Saved ext ${ext}, but the phone system isn’t ready yet — wait a minute, then try Download config again.`
            : "Saved, but the phone system isn’t ready yet — wait a minute and try again.",
          "warn"
        );
      } else {
        const remoteFirst = state.ataLanPush === false;
        const created = data?.freepbx_created === true;
        setFlash(
          ext
            ? remoteFirst
              ? `Connection saved — extension ${ext}${created ? " is ready" : ""}. Tap Download config, upload on the Grandstream, then reboot.`
              : `Connection saved — extension ${ext}${created ? " is ready" : ""}. Tap Set up adapter (same house) or Download config.`
            : "Connection saved — continue setup below",
          "ok"
        );
      }
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
      if (/can.?t reach|same (home network|Wi)|Download config instead|Mothership|home hub|LAN/i.test(msg)) {
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
  document.getElementById("save-child-label")?.addEventListener("click", async () => {
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
  });
  document.getElementById("enable-child")?.addEventListener("click", () => enableChildModeOnDevice());
  document.getElementById("coparent-kid")?.addEventListener("change", (e) => {
    state.coparentKidLineId = e.target.value || "";
    state.lastGuardianInvite = null;
    state.parentScrollTo = "parent-coparents";
    render();
  });
  document.getElementById("add-guardian")?.addEventListener("click", async () => {
    try {
      const lineId =
        document.getElementById("add-guardian")?.getAttribute("data-line-id") ||
        state.coparentKidLineId ||
        resolveCoparentKidLine(hh)?.id;
      const username = document.getElementById("guardian-username").value.trim();
      if (!lineId) {
        setFlash("Add a kid under Kids first", "warn");
        render();
        return;
      }
      if (!username) {
        setFlash("Enter a parent username", "warn");
        render();
        return;
      }
      await api(`/api/lines/${lineId}/guardians`, {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setFlash(`Added ${username} as co-parent`, "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not add co-parent", "error");
      render();
    }
  });
  document.getElementById("add-guardian-member")?.addEventListener("click", async () => {
    try {
      const lineId =
        document.getElementById("add-guardian-member")?.getAttribute("data-line-id") ||
        state.coparentKidLineId ||
        resolveCoparentKidLine(hh)?.id;
      const username = document.getElementById("guardian-member")?.value?.trim();
      if (!lineId) {
        setFlash("Add a kid under Kids first", "warn");
        render();
        return;
      }
      if (!username) {
        setFlash("Choose a household member", "warn");
        render();
        return;
      }
      await api(`/api/lines/${lineId}/guardians`, {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      setFlash("Added as co-parent", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not add co-parent", "error");
      render();
    }
  });
  async function createGuardianInviteAndShow({ preferShare = false, lineId } = {}) {
    const targetLineId =
      lineId || state.coparentKidLineId || resolveCoparentKidLine(hh)?.id || "";
    if (!targetLineId) throw new Error("Add a kid under Kids first");
    const data = await api(`/api/lines/${targetLineId}/guardian-invites`, {
      method: "POST",
      body: "{}",
    });
    state.coparentKidLineId = targetLineId;
    state.lastGuardianInvite = {
      lineId: targetLineId,
      code: data.invite.code,
      shareUrl: data.shareUrl,
      shareText: data.shareText,
      expiresAt: data.invite.expires_at,
    };
    setFlash(`Co-parent code ${data.invite.code} — share it with the other parent`, "ok");
    if (preferShare && navigator.share && data.shareText) {
      try {
        await navigator.share({
          title: "PhoneHome co-parent",
          text: data.shareText,
          url: data.shareUrl,
        });
      } catch {
        /* cancelled */
      }
    }
    state.parentScrollTo = "parent-coparents";
    render();
  }
  document.getElementById("invite-guardian")?.addEventListener("click", async () => {
    try {
      const lineId = document.getElementById("invite-guardian")?.getAttribute("data-line-id") || "";
      await createGuardianInviteAndShow({
        preferShare: !state.lastGuardianInvite,
        lineId,
      });
    } catch (e) {
      setFlash(e.message || "Could not create invite", "error");
      render();
    }
  });
  document.getElementById("copy-guardian-invite")?.addEventListener("click", async () => {
    const inv = state.lastGuardianInvite;
    if (!inv?.shareText) return;
    const text = `${inv.shareText}\n${inv.shareUrl || ""}`.trim();
    try {
      await navigator.clipboard.writeText(text);
      setFlash("Co-parent invite copied", "ok");
      render();
    } catch (e) {
      setFlash(e.message || "Could not copy", "error");
      render();
    }
  });
  document.getElementById("share-guardian-invite")?.addEventListener("click", async () => {
    const inv = state.lastGuardianInvite;
    if (!inv?.shareText) return;
    const text = `${inv.shareText}\n${inv.shareUrl || ""}`.trim();
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: "PhoneHome co-parent",
            text: inv.shareText,
            url: inv.shareUrl,
          });
          setFlash("Invite shared", "ok");
          render();
          return;
        } catch {
          /* cancelled or unavailable — fall through to copy */
        }
      }
      await navigator.clipboard.writeText(text);
      setFlash("Co-parent invite copied — paste it in a text", "ok");
      render();
    } catch (e) {
      setFlash(e.message || "Could not share", "error");
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
      state.pendingGuardianCode = "";
      setFlash("You’re now a co-parent on that kid line", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not accept invite", "error");
      render();
    }
  });
  document.getElementById("create-grandparent")?.addEventListener("click", async () => {
    const hh = state.households[0];
    if (!hh) return;
    try {
      const displayName = document.getElementById("gp-display-name")?.value?.trim() || "";
      const label = document.getElementById("gp-label")?.value?.trim() || "";
      const username = document.getElementById("gp-username")?.value?.trim() || "";
      const password = document.getElementById("gp-password")?.value || "";
      const kidLineIds = [...document.querySelectorAll('input[name="gp-kid"]:checked')].map(
        (el) => el.value
      );
      if (!displayName || !username || !password) {
        setFlash("Enter their name, username, and password", "warn");
        render();
        return;
      }
      if (!kidLineIds.length) {
        setFlash("Pick at least one kid they can call", "warn");
        render();
        return;
      }
      const data = await api(`/api/households/${hh.id}/grandparents`, {
        method: "POST",
        body: JSON.stringify({
          displayName,
          username,
          password,
          label: label || undefined,
          kidLineIds,
        }),
      });
      state.lastGrandparentSetup = {
        householdId: hh.id,
        relativeId: data.relative?.id,
        displayName: data.relative?.display_name || displayName,
        username: data.username,
        password: data.password,
      };
      state.parentAccOpen = "parent-grandparents";
      setFlash(data.flash || "Grandparent login ready", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not create login", "error");
      render();
    }
  });
  document.getElementById("copy-gp-login")?.addEventListener("click", async () => {
    const last = state.lastGrandparentSetup;
    if (!last?.username) return;
    const text = `PhoneHome login\nUsername: ${last.username}\nPassword: ${last.password || ""}`;
    try {
      await navigator.clipboard.writeText(text);
      setFlash("Login copied", "ok");
      render();
    } catch (e) {
      setFlash(e.message || "Could not copy", "error");
      render();
    }
  });
  document.getElementById("dismiss-gp-login")?.addEventListener("click", () => {
    state.lastGrandparentSetup = null;
    render();
  });
  document.getElementById("close-gp-manage")?.addEventListener("click", () => {
    state.managingGrandparentId = "";
    render();
  });
  document.querySelectorAll("[data-gp-manage]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-gp-manage");
      state.managingGrandparentId = state.managingGrandparentId === id ? "" : id || "";
      state.parentAccOpen = "parent-grandparents";
      state.parentScrollTo = "parent-grandparents";
      render();
    });
  });
  document.querySelectorAll("[data-gp-preview]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-gp-preview");
      if (id) startGpPreview(id);
    });
  });
  document.getElementById("save-gp-manage")?.addEventListener("click", async () => {
    const hh = state.households[0];
    const id = state.managingGrandparentId;
    if (!hh || !id) return;
    try {
      const displayName = document.getElementById("gp-manage-display-name")?.value?.trim() || "";
      const label = document.getElementById("gp-manage-label")?.value?.trim() || "";
      const username = document.getElementById("gp-manage-username")?.value?.trim() || "";
      const password = document.getElementById("gp-manage-password")?.value || "";
      const kidLineIds = [...document.querySelectorAll('input[name="gp-manage-kid"]:checked')].map(
        (el) => el.value
      );
      if (!displayName || !username) {
        setFlash("Enter their name and username", "warn");
        render();
        return;
      }
      if (!kidLineIds.length) {
        setFlash("Pick at least one kid they can call", "warn");
        render();
        return;
      }
      const body = {
        displayName,
        username,
        label,
        kidLineIds,
      };
      if (password) body.password = password;
      const data = await api(`/api/households/${hh.id}/grandparents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (data.password) {
        state.lastGrandparentSetup = {
          householdId: hh.id,
          relativeId: id,
          displayName: data.relative?.display_label || data.relative?.display_name || displayName,
          username: data.relative?.username || username,
          password: data.password,
        };
      }
      state.parentAccOpen = "parent-grandparents";
      state.parentScrollTo = "parent-grandparents";
      setFlash("Grandparent options saved", "ok");
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not save", "error");
      render();
    }
  });
  document.querySelectorAll("[data-gp-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const hh = state.households[0];
      const id = btn.getAttribute("data-gp-view");
      const rel = (hh?.provisioned_relatives || []).find((r) => r.id === id);
      if (!rel) return;
      state.lastGrandparentSetup = {
        householdId: hh.id,
        relativeId: rel.id,
        displayName: rel.display_label || rel.display_name,
        username: rel.username,
        password: "(use New password to set one)",
      };
      state.parentAccOpen = "parent-grandparents";
      setFlash("Password isn’t stored here — tap New password to set one they can use.", "warn");
      render();
    });
  });
  document.querySelectorAll("[data-gp-reset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const hh = state.households[0];
      const id = btn.getAttribute("data-gp-reset");
      const rel = (hh?.provisioned_relatives || []).find((r) => r.id === id);
      if (!hh || !id || !rel) return;
      const password = window.prompt(
        `New password for ${rel.username || rel.display_name} (at least 8 characters):`,
        ""
      );
      if (password == null) return;
      try {
        const data = await api(`/api/households/${hh.id}/grandparents/${id}/reset-password`, {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        state.lastGrandparentSetup = {
          householdId: hh.id,
          relativeId: id,
          displayName: rel.display_label || rel.display_name,
          username: rel.username,
          password: data.password || password,
        };
        state.parentAccOpen = "parent-grandparents";
        setFlash(data.flash || "Password updated", "ok");
        await refresh();
      } catch (e) {
        setFlash(e.message || "Could not reset password", "error");
        render();
      }
    });
  });
  document.querySelectorAll("[data-remove-guardian]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const userId = btn.getAttribute("data-remove-guardian");
        const lineId = state.coparentKidLineId || resolveCoparentKidLine(hh)?.id || "";
        if (!lineId) {
          setFlash("Add a kid under Kids first", "warn");
          render();
          return;
        }
        await api(`/api/lines/${lineId}/guardians/${userId}`, { method: "DELETE" });
        setFlash("Co-parent removed", "ok");
        await refresh();
      } catch (e) {
        setFlash(e.message || "Could not remove co-parent", "error");
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
    await clearPersistedAuth({ keepLogin: true });
    localStorage.removeItem("kl_line");
    localStorage.removeItem("kl_child_mode");
    localStorage.removeItem("kl_child_line");
    faceIdAutoTried = false;
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
  if (!hh?.quiet_start || !hh?.quiet_end) return "Open — they can call anytime";
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

function parentWindowName(hh) {
  const preset = String(hh?.parent_schedule_preset || "");
  if (preset === "evenings") return "Evenings";
  if (hh?.parent_quiet_start && hh?.parent_quiet_end) return "Do Not Disturb";
  return "Ring anytime";
}

function parentQuietSummary(hh) {
  if (!hh?.parent_quiet_start || !hh?.parent_quiet_end) return "Rings anytime";
  const tz = (hh.parent_quiet_tz || hh.quiet_tz || "").split("/").pop()?.replace(/_/g, " ") || "local";
  return `${parentWindowName(hh)} · ${formatQuietClock(hh.parent_quiet_start)}–${formatQuietClock(hh.parent_quiet_end)} · ${tz}`;
}

function isParentDndActiveClient(hh, date = new Date()) {
  return isQuietHoursActiveClient(
    {
      quiet_start: hh?.parent_quiet_start,
      quiet_end: hh?.parent_quiet_end,
      quiet_tz: hh?.parent_quiet_tz || hh?.quiet_tz,
      quiet_days: hh?.parent_quiet_days,
      skip_holidays: 0,
      schedule_preset: hh?.parent_schedule_preset || "open",
    },
    date
  );
}

function kidHoursStatusLine(hh) {
  if (hh?.dnd) return "Quiet Time is on now — VIP still rings";
  if (isQuietHoursActiveClient(hh)) return `${quietWindowName(hh)} is on now`;
  return quietSummary(hh);
}

function parentHoursChipHtml(hh, kidLines) {
  const kid = kidLines[0];
  const kidBit = kid
    ? `${(kid.child_label || kid.name || "Kids").replace(/</g, "&lt;")} · ${
        hh?.schedule_preset === "bedtime"
          ? "Bedtime"
          : hh?.schedule_preset === "school"
            ? "School"
            : hh?.quiet_start
              ? "Custom"
              : "Open"
      }`
    : "No kid yet";
  const youBit = !hh?.parent_quiet_start ? "You · rings" : `You · ${parentWindowName(hh)}`;
  return `<span class="parent-summary-chip" id="parent-hours-chip"><strong>${kidBit}</strong><span>${youBit}</span></span>`;
}

function schedUsageHtml(used, cap) {
  if (cap == null) {
    return `<p class="tiny sched-talk">Talk today <strong>${used} min</strong> · no daily limit</p>`;
  }
  const pct = Math.min(100, Math.round((used / Math.max(cap, 1)) * 100));
  return `<div class="usage-bar ${pct >= 90 ? "hot" : ""}">
    <div class="usage-meta"><span>Talk today</span><strong>${used} / ${cap} min</strong></div>
    <div class="usage-track"><i style="width:${pct}%"></i></div>
  </div>`;
}

function renderParentHoursBody(hh, kidLines) {
  const preset = hh?.schedule_preset || "open";
  const cap = hh?.daily_cap_minutes;
  const parentPreset = hh?.parent_schedule_preset || "open";
  const showKidsCustom = Boolean(state.parentHoursKidsCustom) || preset === "custom";
  const showYouCustom = Boolean(state.parentHoursYouCustom) || parentPreset === "custom";
  const kidNames = kidLines.map((l) => l.child_label || l.name || "this kid");
  const kidList =
    kidNames.length === 0
      ? ""
      : kidNames.length === 1
        ? kidNames[0]
        : kidNames.length === 2
          ? `${kidNames[0]} and ${kidNames[1]}`
          : `${kidNames.slice(0, -1).join(", ")}, and ${kidNames[kidNames.length - 1]}`;
  const kidCards = kidLines.length
    ? kidLines
        .map((l) => {
          const name = (l.child_label || l.name || "Kid").replace(/</g, "&lt;");
          const used = l.usage_today_minutes || 0;
          return `<article class="sched-person">
            <div class="sched-person-head">
              ${avatarHtml(l.child_label || l.name, l.id, "md")}
              <div class="sched-person-copy">
                <strong>${name}</strong>
                <p class="tiny">${kidHoursStatusLine(hh).replace(/</g, "&lt;")}</p>
              </div>
            </div>
            ${schedUsageHtml(used, cap)}
          </article>`;
        })
        .join("")
    : `<p class="tiny sched-empty">Add a kid in <button type="button" class="linkish" id="hours-go-line">Kids</button>, then set their hours here.</p>`;

  const tz = hh?.quiet_tz || browserTimeZone();
  const parentTz = hh?.parent_quiet_tz || tz;
  return `
        <div class="sched-block">
          <h3 class="parent-subhead">Kids</h3>
          <p class="tiny">${
            kidLines.length
              ? `Hours and a daily talk limit for <strong>${kidList.replace(/</g, "&lt;")}</strong>. VIP contacts still ring.`
              : "These limits apply to each kid line you manage."
          }</p>
          ${kidCards}
          ${
            kidLines.length
              ? `<div class="parent-field sched-editor">
          <h3 class="parent-subhead">Their hours</h3>
          <div class="preset-grid">
            ${["open", "bedtime", "school"]
              .map(
                (p) =>
                  `<button type="button" class="preset ${preset === p ? "on" : ""}" data-preset="${p}">${
                    p === "open" ? "Open" : p === "bedtime" ? "Bedtime" : "School"
                  }</button>`
              )
              .join("")}
          </div>
          <button class="ghost" id="custom-quiet" type="button">Custom hours…</button>
          <p class="tiny parent-inline-meta">${quietSummary(hh)}${hh?.quiet_tz ? ` · ${hh.quiet_tz}` : ""}</p>
          ${
            showKidsCustom
              ? `<div class="sched-custom" id="kids-custom-fields">
            <label>Starts</label>
            <input type="time" id="kids-q-start" value="${hh?.quiet_start || "20:00"}" />
            <label>Ends</label>
            <input type="time" id="kids-q-end" value="${hh?.quiet_end || "07:00"}" />
            <label>Timezone</label>
            <select id="kids-q-tz">${timezoneOptions(tz)}</select>
            <button class="primary" type="button" id="save-kids-custom">Save custom hours</button>
          </div>`
              : ""
          }
          ${
            preset === "school"
              ? `<div class="school-schedule-note">
            <p class="tiny"><strong>School</strong> is Mon–Fri ${formatQuietClock(hh.quiet_start || "08:00")}–${formatQuietClock(hh.quiet_end || "15:30")}.</p>
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
          <p class="tiny">Each kid gets this many minutes. Blank = unlimited.</p>
          <label>Minutes per day</label>
          <input id="cap" type="number" min="0" step="5" placeholder="e.g. 60" value="${cap ?? ""}" />
          <button class="primary" id="save-cap" type="button">Save limit</button>
        </div>`
              : ""
          }
        </div>
        <div class="sched-block sched-block-you">
          <h3 class="parent-subhead">Your phone</h3>
          <p class="tiny">${
            isParentDndActiveClient(hh)
              ? "Do Not Disturb is on now — VIP still rings."
              : "Your own Do Not Disturb. Does not change the kids’ hours."
          }</p>
          <p class="sched-you-status">${parentQuietSummary(hh).replace(/</g, "&lt;")}</p>
          <div class="preset-grid sched-you-presets">
            ${["open", "evenings", "custom"]
              .map((p) => {
                const label = p === "open" ? "Ring anytime" : p === "evenings" ? "Evenings" : "Custom";
                const on = parentPreset === p || (p === "custom" && showYouCustom && parentPreset === "custom");
                return `<button type="button" class="preset ${on ? "on" : ""}" data-parent-preset="${p}">${label}</button>`;
              })
              .join("")}
          </div>
          ${
            showYouCustom
              ? `<div class="sched-custom" id="you-custom-fields">
            <label>Starts</label>
            <input type="time" id="you-q-start" value="${hh?.parent_quiet_start || "21:00"}" />
            <label>Ends</label>
            <input type="time" id="you-q-end" value="${hh?.parent_quiet_end || "07:00"}" />
            <label>Timezone</label>
            <select id="you-q-tz">${timezoneOptions(parentTz)}</select>
            <button class="primary" type="button" id="save-you-custom">Save my hours</button>
          </div>`
              : `<p class="tiny parent-inline-meta">Evenings are 9pm–7am. VIP contacts still ring your phone.</p>`
          }
        </div>`;
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
      <p>Calls are blocked during this window in <strong>your</strong> timezone — not the Mothership’s clock.</p>
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
      <p>They join with this code or by scanning the QR. After that, <strong>both of you</strong> still need to approve each other before kids can call.</p>
      <div class="invite-qr" id="invite-qr" role="img" aria-label="QR code for invite link" hidden></div>
      <p class="tiny center invite-qr-hint" id="invite-qr-hint" hidden>Scan with the other phone, across the table</p>
      <div class="code-box glow" id="code">······</div>
      <p class="tiny center" id="url"></p>
      <p class="flash-banner warn hidden" id="share-warn">This link only works on your home Wi‑Fi. Share from the PhoneHome app when you’re on the internet instead.</p>
      <div class="btn-row">
        <button class="primary" id="share">Share invite</button>
        <button class="ghost" id="copy">Copy link</button>
      </div>
      <button class="linkish" id="refresh-inv">Make a new code</button>
    </div>
    <div class="sheet tip-sheet">
      <h2>What happens next</h2>
      <ol class="how-list">
        <li>They scan the QR or open the link and join with this code</li>
        <li>You approve them in Contacts</li>
        <li>They approve you — then kids can call</li>
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
      shareText: `Join our PhoneHome family phone. Open the link (or scan the QR), then enter code ${code}. After that we each approve the other so the kids can call.`,
    };
    document.getElementById("code").textContent = code;
    document.getElementById("url").textContent = sharePayload.shareUrl;
    paintInviteQr("invite-qr", sharePayload.shareUrl);
    const hint = document.getElementById("invite-qr-hint");
    if (hint) hint.toggleAttribute("hidden", !document.getElementById("invite-qr")?.innerHTML);
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
  if (isKidExperience()) {
    setFlash("Only parents can approve contacts", "error");
    state.screen = "home";
    state.nav = "phone";
    render();
    return;
  }
  const already = new Set((hh?.allowlist || []).map((a) => a.target_line_id));
  // Directory is server-scoped to the viewer’s own circle — never co-members of a host circle.
  const mySphere = (hh?.spheres || []).find((s) => s.is_mine || s.id === hh?.my_sphere_id);
  const inMyCircle = new Set(mySphere?.member_line_ids || []);
  const others = state.directory.filter((d) => {
    if (d.household_id === hh.id || already.has(d.id)) return false;
    // Defense in depth: if sphere membership is available, require it.
    if (inMyCircle.size && !inMyCircle.has(d.id)) return false;
    return true;
  });
  const gp = isGrandparentExperience();
  setAppPage(`
    <div class="sheet gp-contacts-page">
      <div class="gp-contacts-head">
        <h2>${gp ? "Add someone" : "Approve into circle"}</h2>
        <button type="button" class="primary gp-done-btn" id="back">Done</button>
      </div>
      <p>${
        gp
          ? "These are people your family already connected. Tap a name, then tap Add to my phone."
          : "Only people already linked by <strong>invite</strong> show here."
      }</p>
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
        <label>Name on your phone</label>
        <input id="label" placeholder="e.g. Gemma" value="${others[0] ? friendlyPersonName(others[0].name).replace(/"/g, "&quot;") : ""}" />
        ${
          gp
            ? ""
            : `<label class="check-row"><input type="checkbox" id="vip" /> VIP — can still ring during Quiet Time</label>`
        }
        <button class="primary" id="save" style="margin-top:12px;width:100%">${gp ? "Add to my phone" : "Add to my phone"}</button>`
          : `<div class="empty hero-empty">
              <strong>${gp ? "No one else to add" : "Nobody left to approve"}</strong>
              <p>${
                already.size
                  ? gp
                    ? "Everyone from your family is already on your phone."
                    : "Everyone who’s joined is already on your list."
                  : canInviteFamily()
                    ? "Send an invite first. When they join, they’ll show up here."
                    : gp
                      ? "Ask your son or daughter to add you first."
                      : "Ask a parent to invite family first."
              }</p>
              ${
                already.size
                  ? `<button class="primary" id="to-invite">${gp ? "Back to my family" : "Back to contacts"}</button>`
                  : canInviteFamily()
                    ? `<button class="primary" id="to-invite">Invite someone</button>`
                    : `<button class="primary" id="to-invite">${gp ? "Back to Phone" : "Back home"}</button>`
              }
            </div>`
      }
    </div>
  `);
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
    setFlash(
      gp
        ? `Added ${document.getElementById("label").value.trim() || "them"}. If you cannot call yet, ask them to add you too.`
        : `Approved ${document.getElementById("label").value.trim() || "them"} — ask them to approve you too`,
      "ok"
    );
    state.screen = "manage-contacts";
    await refresh();
  });
}

function renderManageContacts() {
  const hh = state.households[0];
  if (isKidExperience()) {
    setFlash("Only parents can manage contacts", "error");
    state.screen = "home";
    state.nav = "phone";
    render();
    return;
  }
  // Prefer this parent’s circle; fail-open to full list if membership isn’t tagged yet.
  const contacts = contactsInMyCircle(hh);
  const pending = pendingApprovals(hh);
  const editing = contacts.find((c) => c.id === state.editContactId);
  const sph = mySphere(hh);
  const circleLabel = (sph?.name || "your circle").replace(/</g, "");
  const gp = isGrandparentExperience();
  setAppPage(`
    <div class="sheet gp-contacts-page">
      <div class="gp-contacts-head">
        <h2>${gp ? "Your family" : "Your circle"}</h2>
        <button type="button" class="primary gp-done-btn" id="back">Done</button>
      </div>
      ${
        gp
          ? `<p>Add people so you can call them. When you are finished, tap <strong>Done</strong> to go back to your phone.</p>`
          : `<p>People join <strong>${circleLabel}</strong> by invite. You approve them → they can appear on kid pads. They approve you → <em>Ready to call</em>.</p>`
      }
    </div>
    ${
      pending.length
        ? `<div class="sheet">
        <h2>${gp ? "Waiting for your answer" : "Needs your approval"}</h2>
        <p>${gp ? "Tap <strong>Yes, add them</strong> so they show up on button 1." : "These people are already linked by invite — tap Approve to put them on the phone."}</p>
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
              <button type="button" class="primary" data-approve="${d.id}" data-name="${friendlyPersonName(d.name).replace(/"/g, "&quot;")}">${gp ? "Yes, add them" : "Approve"}</button>
              <button type="button" class="ghost" data-decline="${d.id}" data-name="${friendlyPersonName(d.name).replace(/"/g, "&quot;")}">${gp ? "No" : "No thanks"}</button>
            </div>
          </div>`
          )
          .join("")}</div>
      </div>`
        : ""
    }
    <div class="sheet" style="margin-top:12px">
      <h2>${gp ? "On your phone" : `In ${circleLabel}`}</h2>
      ${gp ? `<p class="tiny">Tap a name to change how it appears, or remove someone.</p>` : `<p>Rename, speed dial 2–9, VIP, or remove from your circle.</p>`}
      <button class="ghost" id="add-new" style="margin-bottom:14px;width:100%">${gp ? "Add someone else from my family…" : "Approve someone already invited…"}</button>
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
                <small>${
                  gp
                    ? `${c.speed_dial ? `Button ${c.speed_dial} · ` : ""}${st.label}`
                    : `${c.speed_dial ? `Dial ${c.speed_dial} · ` : ""}${st.label}${c.always_allow ? " · VIP" : ""}`
                }</small>
              </div>
              <button type="button" class="ghost" data-edit="${c.id}">${gp ? "Change" : "Edit"}</button>
            </div>`;
              })
              .join("")}</div>`
          : `<div class="empty">${
              pending.length
                ? gp
                  ? "Tap Yes, add them above to put them on your phone."
                  : "Approve someone above to put them on your phone."
                : canInviteFamily()
                  ? "Invite someone first. When they join, approve them here."
                  : gp
                    ? "Ask your son or daughter to connect you, then come back here."
                    : "Ask a parent to invite you, then approve them here."
            }</div>`
      }
    </div>
    ${
      editing
        ? `<div class="sheet-modal" id="edit-contact-modal">
        <div class="sheet-modal-card" role="dialog" aria-labelledby="edit-contact-title">
          <h2 id="edit-contact-title">${gp ? "Change" : "Edit"} ${contactDisplayName(editing)}</h2>
          <label>${gp ? "Name on your phone" : "Name on the phone"}</label>
          <input id="edit-label" value="${contactDisplayName(editing).replace(/"/g, "&quot;")}" />
          ${
            gp
              ? ""
              : `<label>Speed dial (2–9, blank = none)</label>
          <input id="edit-dial" type="number" min="2" max="9" inputmode="numeric" value="${editing.speed_dial ?? ""}" />
          <label class="check-row"><input type="checkbox" id="edit-vip" ${editing.always_allow ? "checked" : ""} /> VIP — rings through Quiet Time</label>`
          }
          <div class="btn-row two">
            <button class="primary btn-block" id="save-edit">Save</button>
            <button class="ghost btn-block" id="cancel-edit">Cancel</button>
          </div>
          <button class="ghost btn-block" id="remove-from-circle" style="margin-top:10px">${gp ? "Remove from my list" : "Remove from my list"}</button>
          <button class="danger btn-block" id="remove-contact" style="margin-top:8px">${gp ? "Remove from this phone" : "Remove from this phone"}</button>
        </div>
      </div>`
        : ""
    }
  `);
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
      setFlash(
        gp
          ? `Added ${label}. If you cannot call yet, ask them to add you too.`
          : `Approved ${label} — ask them to approve you too`,
        "ok"
      );
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
        setFlash(
          gp ? `${label} was not added` : `Declined ${label} — they won’t show under Needs approval`,
          "ok"
        );
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
    const dialEl = document.getElementById("edit-dial");
    const vipEl = document.getElementById("edit-vip");
    const body = {
      label: document.getElementById("edit-label").value.trim(),
    };
    if (dialEl) {
      const dialRaw = dialEl.value.trim();
      body.speed_dial = dialRaw === "" ? null : Number(dialRaw);
    }
    if (vipEl) body.always_allow = Boolean(vipEl.checked);
    await api(`/api/households/${hh.id}/allowlist/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setFlash(gp ? "Saved" : "Contact updated", "ok");
    state.editContactId = null;
    await refresh();
  });
  document.getElementById("remove-from-circle")?.addEventListener("click", async () => {
    if (!editing?.target_line_id) return;
    if (
      !confirm(
        gp
          ? `Remove ${contactDisplayName(editing)} from your list?`
          : `Remove ${contactDisplayName(editing)} from ${circleLabel}? They stay in other parents’ circles.`
      )
    )
      return;
    try {
      await api(`/api/households/${hh.id}/spheres/mine/members/${editing.target_line_id}`, {
        method: "DELETE",
      });
      setFlash(gp ? "Removed" : "Removed from your circle", "ok");
      state.editContactId = null;
      await refresh();
    } catch (e) {
      setFlash(e.message || "Could not remove from circle", "error");
      render();
    }
  });
  document.getElementById("remove-contact")?.addEventListener("click", async () => {
    if (!confirm(`Remove ${contactDisplayName(editing)} from this household’s contacts? Kids won’t dial them from this phone.`)) return;
    await api(`/api/households/${hh.id}/allowlist/${editing.id}`, { method: "DELETE" });
    if (editing.target_line_id) {
      try {
        await api(`/api/households/${hh.id}/spheres/mine/members/${editing.target_line_id}`, {
          method: "DELETE",
        });
      } catch {
        /* circle unlink best-effort */
      }
    }
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
    state.leaveVmMountedKey = null;
    state.nav = "phone";
    localStorage.setItem("kl_nav", "phone");
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
  document.querySelector(".leave-vm-screen .home-brand-lockup")?.addEventListener("click", () => {
    void finish({ save: true });
  });

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


/** Splash / tutorial / auth — no dock; drop the 96px dock pad so compositions aren't stretched. */
const GATE_SCREENS = new Set([
  "splash",
  "tutorial",
  "welcome",
  "returning",
  "register",
  "set-password",
  "host",
  "join",
]);

function syncGateChrome() {
  const gate = GATE_SCREENS.has(state.screen) || !state.user;
  app.classList.toggle("gate-screen", gate);
}

function render() {
  // Freeze home chrome while the softphone ring sheet is up — remounting #app
  // behind a translucent overlay read as the incoming sheet flickering.
  if (
    !callKitOwnsUi() &&
    (state.call?.status === "incoming" || state.group?.status === "incoming") &&
    document.getElementById("call-layer")
  ) {
    syncPhoneRoleChrome();
    syncGateChrome();
    syncPhoneHomeLock();
    paintToast();
    paintCallLayer();
    return;
  }
  syncPhoneRoleChrome();
  if (state.nav === "controls") captureAtaFormDraftFromDom();
  if (!(state.screen === "home" && (!state.nav || state.nav === "phone"))) {
    state.speedDialEditing = false;
    closeFamilyRoomPickerSheet();
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
  else if (state.screen === "leave-message") {
    const key = String(state.leaveFor?.toLineId || "");
    // Idempotent: presence/refresh remounts used to restart “Please leave a message…”.
    if (!(state.leaveVmMountedKey === key && document.querySelector(".leave-vm-screen"))) {
      state.leaveVmMountedKey = key;
      renderLeaveMessage();
    }
  }
  else if (state.screen === "quiet") renderQuietHours();
  else if (state.screen === "profile") renderProfile();
  else if (state.screen === "settings") renderSettings();
  else renderHome();
  syncGateChrome();
  syncPhoneHomeLock();
  paintToast();
  paintCallLayer();
}

/** Capacitor + CallKit (iOS). No-op in Safari/PWA. */
function nativeCallKit() {
  return nativePlugin();
}

function isNativeIosShell() {
  try {
    if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.getPlatform?.() === "ios") {
      return true;
    }
  } catch {
    /* ignore */
  }
  try {
    return (
      document.documentElement.classList.contains("capacitor-native") &&
      document.documentElement.dataset.nativePlatform === "ios"
    );
  } catch {
    return false;
  }
}

/** Show Lock-screen Answer when the iOS app (not Safari) is driving the UI. */
function showIosCallKitSettings() {
  if (isNativeIosShell()) return true;
  try {
    const plugins = window.Capacitor?.Plugins;
    return Boolean(plugins?.PhoneHomeCallKit);
  } catch {
    return false;
  }
}

function iosCallKitToggleHtml(inputId) {
  if (!showIosCallKitSettings()) return "";
  return `<div class="parent-field" id="ios-callkit-field">
          <h3 class="parent-subhead parent-subhead-with-badge">${withBetaBadge("Lock-screen Answer")}</h3>
          <p class="tiny">Use the iPhone Answer button (CallKit). Off = tap a notification and answer in the app.</p>
          <label class="check-row">
            <input type="checkbox" id="${inputId}" ${callKitEnabled() ? "checked" : ""} />
            Answer from the lock screen
          </label>
        </div>`;
}

function bindIosCallKitToggle(inputId) {
  document.getElementById(inputId)?.addEventListener("change", async (e) => {
    const on = Boolean(e.target.checked);
    try {
      await applyCallKitPreference(on);
      setFlash(
        on
          ? "Lock-screen Answer on. Incoming calls use the iPhone Answer button."
          : "Lock-screen Answer off. Calls ring as a notification.",
        "ok"
      );
    } catch (err) {
      e.target.checked = !on;
      setFlash(err.message || "Could not update Lock-screen Answer", "error");
    }
  });
}

/** Push unread VM + unseen missed onto the iOS home-screen icon badge. */
async function syncIosAppBadge() {
  if (!isNativeIosShell()) return;
  const kit = nativeCallKit();
  if (!kit?.setBadge) return;
  const count = iosAppBadgeCount();
  try {
    await kit.setBadge({ count });
  } catch (e) {
    console.warn("[ios] setBadge failed", e);
  }
}

let iosBadgeLifecycleArmed = false;
function armIosAppBadgeLifecycle() {
  if (iosBadgeLifecycleArmed || !isNativeIosShell()) return;
  iosBadgeLifecycleArmed = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void syncIosAppBadge();
  });
  try {
    const CapApp = window.Capacitor?.Plugins?.App;
    CapApp?.addListener?.("appStateChange", (ev) => {
      if (ev?.isActive) void syncIosAppBadge();
    });
  } catch {
    /* App plugin optional */
  }
}

/**
 * Cap iOS only: release WKWebView mic when idle / background so CallKit+TCC
 * does not leave a zombie capture that requires Settings toggle.
 * Safari PWA keeps page-lifetime park between calls.
 */
let iosMicLifecycleArmed = false;
/** True while a live Cap call owns media — never hard-release mid-handoff. */
function callKitHoldsMic() {
  if (callKitGate.answered || callKitGate.accepting || acceptCallInFlight) return true;
  if (state.group) {
    const gs = state.group.status;
    if (gs === "calling" || gs === "incoming" || gs === "connecting" || gs === "active") return true;
  }
  if (!state.call) return false;
  const st = state.call.status;
  return (
    st === "calling" ||
    st === "ringing" ||
    st === "connecting" ||
    st === "active" ||
    st === "incoming"
  );
}

function releaseIdleMicIfSafe(reason) {
  if (!isNativeIosShell()) return;
  if (callKitHoldsMic()) return;
  if (!state.localStream) return;
  console.warn("[ios] hard-release mic —", reason);
  hardReleaseMicStream();
}

function armIosMicLifecycle() {
  if (iosMicLifecycleArmed || !isNativeIosShell()) return;
  iosMicLifecycleArmed = true;

  const onBackground = () => releaseIdleMicIfSafe("background");
  const onForeground = () => {
    if (state.localStream && !micStreamUsable(state.localStream)) {
      console.warn("[ios] clearing zombie mic on foreground");
      hardReleaseMicStream();
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) onBackground();
    else onForeground();
  });
  window.addEventListener("pagehide", onBackground);
  try {
    const CapApp = window.Capacitor?.Plugins?.App;
    CapApp?.addListener?.("appStateChange", (ev) => {
      if (ev?.isActive === false) onBackground();
      else if (ev?.isActive) onForeground();
    });
  } catch {
    /* App plugin optional */
  }
}

let iosCallKitReady = false;
/**
 * CallKit ↔ softphone UI gate.
 * - ringing (incoming, not answered): system CallKit Answer/Decline owns chrome
 * - answered + app foreground: in-app overlay (mute/hold/end) — iOS drops full system UI
 * - locked / background: system green bar / Dynamic Island still applies
 * answered/audioActive also defer WebRTC until AVAudioSession is active.
 */
let callKitGate = {
  answered: false,
  audioActive: false,
  /** True when JS forced audioActive before native didActivate (risk of silent gum). */
  forcedAudio: false,
  accepting: false,
  /** System CallKit incoming UI already shown (PushKit and/or reportIncoming). */
  systemRinging: false,
  /** SDP answer was sent for the current CallKit call. */
  answerSent: false,
  /** call.accepted signaled — stops ATA ringback before SDP. */
  acceptedSignaled: false,
  acceptRetryTimer: null,
  pollTimer: null,
};

/** Deduped late force — never force gum before ~2.5s (early setActive silence). */
let callKitForceAudioTimer = null;

/**
 * Feature flag: system CallKit Answer / PushKit VoIP UI ownership.
 * Default OFF — in-app softphone + alert APNs.
 * Parent → This phone “Lock-screen Answer” writes localStorage + native UserDefaults.
 * Apple requires CallKit report on every VoIP push; without CallKit we must not use PushKit.
 */
function callKitEnabled() {
  try {
    const v = String(localStorage.getItem("kl_callkit") || "").trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes") return true;
    if (v === "0" || v === "false" || v === "no") return false;
  } catch {
    /* ignore */
  }
  return false;
}

function persistCallKitFlag(enabled) {
  try {
    localStorage.setItem("kl_callkit", enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** If WKWebView wiped localStorage, keep CallKit on when native UserDefaults says so. */
async function syncCallKitFlagFromNative() {
  const kit = nativeCallKit();
  if (!kit?.isCallKitEnabled) return;
  try {
    const nativeOn = Boolean((await kit.isCallKitEnabled())?.enabled);
    let stored = "";
    try {
      stored = String(localStorage.getItem("kl_callkit") || "");
    } catch {
      stored = "";
    }
    if (!stored && nativeOn) persistCallKitFlag(true);
  } catch {
    /* older plugin */
  }
}

async function clearRegisteredVoipTokens() {
  if (!state.activeLineId || !state.sessionId) return;
  try {
    await api("/api/devices/voip-token", {
      method: "DELETE",
      body: JSON.stringify({ lineId: state.activeLineId }),
    });
  } catch (e) {
    console.warn("[ios] voip token clear failed", e);
  }
}

/** Turn CallKit on/off without a reload. Listeners stay registered; only PushKit changes. */
async function applyCallKitPreference(enabled) {
  persistCallKitFlag(enabled);
  const kit = nativeCallKit();
  try {
    await kit?.setCallKitEnabled?.({ enabled });
  } catch (e) {
    console.warn("[ios] setCallKitEnabled", e);
  }
  if (enabled) {
    try {
      await kit?.registerVoIP?.();
    } catch (e) {
      console.warn("[ios] registerVoIP", e);
    }
    void syncCallKitStateFromNative("enable");
    armCallKitStatePoll();
  } else {
    await clearRegisteredVoipTokens();
    try {
      await kit?.registerAlertPush?.();
    } catch (e) {
      console.warn("[ios] registerAlertPush", e);
    }
  }
}

/** True when native iOS CallKit plugin may own chrome (flag on + plugin present). */
function callKitOwnsUi() {
  return callKitEnabled() && isNativeIosShell() && Boolean(nativeCallKit());
}

function resetCallKitGate() {
  callKitGate.answered = false;
  callKitGate.audioActive = false;
  callKitGate.forcedAudio = false;
  callKitGate.accepting = false;
  callKitGate.systemRinging = false;
  callKitGate.answerSent = false;
  callKitGate.acceptedSignaled = false;
  acceptCallInFlight = false;
  if (callKitForceAudioTimer) {
    clearTimeout(callKitForceAudioTimer);
    callKitForceAudioTimer = null;
  }
  if (callKitGate.acceptRetryTimer) {
    clearInterval(callKitGate.acceptRetryTimer);
    callKitGate.acceptRetryTimer = null;
  }
  if (callKitGate.pollTimer) {
    clearInterval(callKitGate.pollTimer);
    callKitGate.pollTimer = null;
  }
  state.pendingNativeCallId = "";
  state.pendingNativeFromLineId = "";
  state.pendingNativeToLineId = "";
}

/** While CallKit shows an incoming/active call, poll native state (cold WebView / missed events). */
function armCallKitStatePoll() {
  if (callKitGate.pollTimer || !isNativeIosShell()) return;
  let n = 0;
  callKitGate.pollTimer = setInterval(() => {
    n += 1;
    if (callKitGate.answerSent || n >= 40) {
      clearInterval(callKitGate.pollTimer);
      callKitGate.pollTimer = null;
      return;
    }
    if (!callKitGate.systemRinging && !callKitGate.answered) {
      clearInterval(callKitGate.pollTimer);
      callKitGate.pollTimer = null;
      return;
    }
    void syncCallKitStateFromNative("poll");
  }, 500);
}

function armCallKitAcceptRetries() {
  if (callKitGate.acceptRetryTimer) return;
  let n = 0;
  callKitGate.acceptRetryTimer = setInterval(() => {
    n += 1;
    // Native answered but didActivate lagged — only force after ~4.8s so we don't
    // start getUserMedia before CallKit owns AVAudioSession (silent audio).
    if (callKitGate.answered && !callKitGate.audioActive && n >= 12) {
      console.warn("[ios] CallKit accept retry forcing audioActive", n);
      callKitGate.audioActive = true;
      callKitGate.forcedAudio = true;
    }
    if (!callKitGate.answered || callKitGate.answerSent) {
      if (callKitGate.answerSent || !callKitGate.answered || n >= 40) {
        clearInterval(callKitGate.acceptRetryTimer);
        callKitGate.acceptRetryTimer = null;
      }
      return;
    }
    // Answered but no SDP yet — keep polling pending (do NOT bail on !state.call).
    // Skip inbound accept retries while we are the outbound caller.
    if (
      state.call?.fromLineId === state.activeLineId &&
      state.call?.status !== "incoming"
    ) {
      if (n >= 5) {
        clearInterval(callKitGate.acceptRetryTimer);
        callKitGate.acceptRetryTimer = null;
      }
      return;
    }
    console.info("[ios] CallKit accept retry", n, {
      hasCall: Boolean(state.call),
      hasSdp: Boolean(state.call?.sdp),
    });
    signalCallKitAccepted(`retry-${n}`);
    void acceptCallFromCallKit();
    if (n >= 40) {
      clearInterval(callKitGate.acceptRetryTimer);
      callKitGate.acceptRetryTimer = null;
    }
  }, 400);
}

/** Deduped late force — never force gum before ~4s (early setActive silence). */
function scheduleForceCallKitAudio(reason = "timeout", delayMs = 4000) {
  if (!callKitGate.answered || callKitGate.answerSent || callKitGate.audioActive) return;
  if (callKitForceAudioTimer) return;
  callKitForceAudioTimer = setTimeout(() => {
    callKitForceAudioTimer = null;
    forceCallKitAudioAndAccept(reason);
  }, delayMs);
}

function forceCallKitAudioAndAccept(reason = "timeout") {
  if (!callKitGate.answered || callKitGate.answerSent) return;
  if (!callKitGate.audioActive) {
    console.warn("[ios] forcing audioActive —", reason);
    callKitGate.audioActive = true;
    callKitGate.forcedAudio = true;
  }
  armCallKitAcceptRetries();
  void acceptCallFromCallKit();
}

async function syncCallKitStateFromNative(reason = "poll") {
  const kit = nativeCallKit();
  if (!kit?.getCallState || !isNativeIosShell()) return false;
  try {
    const st = await kit.getCallState();
    console.info("[ios] CallKit state sync", reason, {
      answered: !!st?.answered,
      audioActive: !!st?.audioActive,
      ringing: !!st?.ringing,
      systemHasCall: !!st?.systemHasCall,
      callId: st?.callId || null,
    });
    if (st?.callId) state.pendingNativeCallId = String(st.callId);
    if (st?.systemHasCall || st?.ringing || st?.answered) {
      callKitGate.systemRinging = true;
      armCallKitStatePoll();
    }
    if (st?.answered) {
      callKitGate.answered = true;
      callKitGate.systemRinging = true;
    }
    if (st?.audioActive) {
      callKitGate.audioActive = true;
      callKitGate.forcedAudio = false;
    }
    // Do NOT force audioActive after 400ms — that races didActivate and silences WKWebView.
    // Arm a ~4s safety valve; prefer real audioActivated.
    if (st?.answered && !callKitGate.audioActive) {
      scheduleForceCallKitAudio(`sync:${reason}`, 4000);
      armCallKitAcceptRetries();
    }
    if (callKitGate.answered) {
      armCallKitAcceptRetries();
      if (callKitGate.audioActive) void acceptCallFromCallKit();
    }
    return Boolean(st?.answered);
  } catch (e) {
    console.warn("[ios] getCallState failed", e);
    return false;
  }
}

function kickRemoteAudio() {
  const audio = typeof remoteAudio === "function" ? remoteAudio() : document.getElementById("remote-audio");
  if (!audio) return;
  try {
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "true");
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = 1;
    const p = audio.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {}
}

/** After CallKit didActivate: remount remote tracks onto <audio> and play (lock-screen). */
function remountRemoteAudioFromPc(reason = "remount") {
  const pc = state.pc;
  const audio = typeof remoteAudio === "function" ? remoteAudio() : document.getElementById("remote-audio");
  if (!pc || !audio) return false;
  try {
    const tracks = (pc.getReceivers?.() || [])
      .map((r) => r.track)
      .filter((t) => t && t.kind === "audio" && t.readyState === "live");
    if (!tracks.length) {
      kickRemoteAudio();
      return false;
    }
    for (const t of tracks) {
      try {
        t.enabled = true;
      } catch {}
    }
    audio.srcObject = new MediaStream(tracks);
    audio.muted = false;
    audio.volume = 1;
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "true");
    kickRemoteAudio();
    reportMediaStat(pc, reason);
    return true;
  } catch (e) {
    console.warn("[ios] remountRemoteAudio failed", e);
    kickRemoteAudio();
    return false;
  }
}

/** Safe media path breadcrumbs → hub journal (no SDP / candidates / keys). */
function reportMediaStat(pc, reason) {
  if (!pc || !state.ws || state.ws.readyState !== 1) return;
  try {
    const senders = pc.getSenders?.() || [];
    const receivers = pc.getReceivers?.() || [];
    const liveSend = senders.filter((s) => s.track && s.track.readyState === "live" && s.track.enabled).length;
    const mutedSend = senders.filter((s) => s.track?.kind === "audio" && s.track.muted).length;
    const liveRecv = receivers.filter((r) => r.track && r.track.readyState === "live").length;
    const remoteEl = remoteAudio();
    const remoteTracks = remoteEl?.srcObject?.getAudioTracks?.()?.length || 0;
    const dirs = (pc.getTransceivers?.() || [])
      .map((t) => `${t.mid || "?"}:${t.direction || "?"}`)
      .join(",");
    const why = `${String(reason || "").slice(0, 28)}${mutedSend ? `|mut=${mutedSend}` : ""}`.slice(0, 40);
    state.ws.send(
      JSON.stringify({
        type: "call.media",
        callId: state.call?.callId || state.pendingNativeCallId || null,
        ice: pc.iceConnectionState || "",
        conn: pc.connectionState || "",
        senders: liveSend,
        receivers: liveRecv,
        remoteTracks,
        dirs,
        reason: why,
      })
    );
  } catch {}
}

/** Serialize pending-offer fetch so concurrent CallKit retries don't race. */
let pendingOfferFetch = null;

/**
 * Tell the bridge CallKit answered — stops FXS ringback before WebRTC SDP is ready.
 * Safe to call repeatedly; only one WS send per call.
 */
function signalCallKitAccepted(reason = "accept") {
  if (!callKitGate.answered || callKitGate.acceptedSignaled) return false;
  const callId = state.call?.callId || state.pendingNativeCallId;
  const fromLineId =
    state.call?.fromLineId || state.pendingNativeFromLineId || "";
  const toLineId =
    state.call?.toLineId || state.pendingNativeToLineId || state.activeLineId;
  if (!callId || !fromLineId || !toLineId) return false;
  if (!state.ws || state.ws.readyState !== 1 || state.wsReplaced) {
    // Reclaim socket so accepted / answer can leave.
    if (state.wsReplaced) reconnectWs();
    else ensureWs();
    return false;
  }
  callKitGate.acceptedSignaled = true;
  try {
    state.ws.send(
      JSON.stringify({
        type: "call.accepted",
        callId: String(callId),
        fromLineId: String(fromLineId),
        toLineId: String(toLineId),
      })
    );
    console.info("[ios] call.accepted → stop ATA ringback", callId, reason);
    return true;
  } catch (e) {
    callKitGate.acceptedSignaled = false;
    console.warn("[ios] call.accepted send failed", e);
    return false;
  }
}

async function ensureIncomingOfferForCallKit() {
  if (state.call?.sdp) return true;
  if (!state.activeLineId) return false;
  if (pendingOfferFetch) return pendingOfferFetch;
  pendingOfferFetch = (async () => {
    try {
      if (state.call?.sdp) return true;
      const body = await api(`/api/calls/pending?lineId=${encodeURIComponent(state.activeLineId)}`);
      if (body?.offer?.sdp) {
        console.info("[ios] pending offer fetched", body.offer.callId);
        await onIncomingOffer({
          type: "call.offer",
          callId: body.offer.callId,
          fromLineId: body.offer.fromLineId,
          toLineId: body.offer.toLineId,
          sdp: body.offer.sdp,
        });
        return Boolean(state.call?.sdp);
      }
    } catch (e) {
      console.warn("[ios] pending offer fetch failed", e);
    }
    return false;
  })();
  try {
    return await pendingOfferFetch;
  } finally {
    pendingOfferFetch = null;
  }
}

async function acceptCallFromCallKit() {
  if (callKitGate.accepting || acceptCallInFlight) return;
  if (!callKitGate.answered) {
    console.info("[ios] accept gated", {
      answered: callKitGate.answered,
      audioActive: callKitGate.audioActive,
      answerSent: callKitGate.answerSent,
    });
    return;
  }
  // Outbound CallKit (we placed the call) — never run the inbound accept path.
  if (
    state.call?.fromLineId === state.activeLineId &&
    state.call?.status !== "incoming"
  ) {
    kickRemoteAudio();
    return;
  }
  // Prefer CallKit audio session, but do not block forever if didActivate never arrives.
  if (!callKitGate.audioActive) {
    console.info("[ios] accept waiting for audio session", {
      answerSent: callKitGate.answerSent,
    });
    armCallKitAcceptRetries();
    // Still stop ATA ringback as soon as we have SDP ids — don't wait for didActivate.
    signalCallKitAccepted("pre-audio");
    return;
  }
  if (callKitGate.answerSent && isPcAlive()) {
    try {
      armMicForCall();
    } catch {}
    try {
      if (!pcHasSendingMic(state.pc) || !micStreamSendingOk(state.localStream) || callKitGate.forcedAudio) {
        await refreshCallKitUplinkMic("accept-already-sent");
      } else {
        await attachLocalMicToPc(state.pc, { force: true });
      }
    } catch {}
    remountRemoteAudioFromPc("accept-already-sent");
    return;
  }
  callKitGate.accepting = true;
  const watchdog = setTimeout(() => {
    if (callKitGate.accepting || acceptCallInFlight) {
      console.warn("[ios] accept watchdog — clearing stuck accept flags");
      callKitGate.accepting = false;
      acceptCallInFlight = false;
      try {
        closeCurrentPc();
      } catch {}
      armCallKitAcceptRetries();
    }
  }, 12000);
  try {
    if (state.wsReplaced) reconnectWs();
    else ensureWs();
    if (!(await ensureIncomingOfferForCallKit())) {
      console.warn("[ios] CallKit answer but no SDP yet — will retry");
      armCallKitAcceptRetries();
      return;
    }
    signalCallKitAccepted("have-offer");
    // PC exists but answer never left — finish the answer path (do not early-return).
    if (isPcAlive() && callKitGate.answerSent) {
      try {
        armMicForCall();
      } catch {}
      try {
        if (!pcHasSendingMic(state.pc) || !micStreamSendingOk(state.localStream)) {
          await refreshCallKitUplinkMic("accept-pc-reuse");
        } else {
          await attachLocalMicToPc(state.pc, { force: true });
        }
      } catch {}
      remountRemoteAudioFromPc("accept-pc-reuse");
      return;
    }
    if (state.call?.status !== "incoming" && state.call?.status !== "connecting") {
      state.call = { ...state.call, status: "incoming" };
    }
    console.info("[ios] CallKit → acceptCall", state.call?.callId);
    await acceptCall();
    remountRemoteAudioFromPc("accept-done");
    kickRemoteAudio();
  } catch (e) {
    if (!isInvalidStateError(e)) console.warn("[ios] CallKit accept failed", e);
    // Keep CallKit up and retry — do not tear down on a single getUserMedia blip.
    armCallKitAcceptRetries();
  } finally {
    clearTimeout(watchdog);
    callKitGate.accepting = false;
  }
}

let lastIosApnsToken = "";
let lastIosVoipToken = "";

/** Lines this install should wake: active line plus any the signed-in user owns. */
function iosAlertPushLineIds() {
  const ids = new Set();
  if (state.activeLineId) ids.add(state.activeLineId);
  const uid = state.user?.id;
  const hh = state.households?.[0];
  for (const l of hh?.lines || []) {
    if (!uid) break;
    if (l.owner_user_id === uid || l.child_user_id === uid) ids.add(l.id);
  }
  return [...ids];
}

async function registerIosApnsToken(token) {
  const t = String(token || lastIosApnsToken || "").trim();
  if (!t || !state.sessionId) return;
  lastIosApnsToken = t;
  const lineIds = iosAlertPushLineIds();
  if (!lineIds.length) return;
  await Promise.all(
    lineIds.map(async (lineId) => {
      try {
        await api("/api/devices/apns-token", {
          method: "POST",
          body: JSON.stringify({ lineId, apnsToken: t, platform: "ios" }),
        });
      } catch (e) {
        console.warn("[ios] APNs token register failed", lineId, e);
      }
    })
  );
  console.info("[ios] APNs alert token registered", lineIds.length);
}

async function registerIosVoipToken(token) {
  const t = String(token || lastIosVoipToken || "").trim();
  if (!t || !state.activeLineId || !state.sessionId) return;
  lastIosVoipToken = t;
  try {
    await api("/api/devices/voip-token", {
      method: "POST",
      body: JSON.stringify({ lineId: state.activeLineId, voipToken: t, platform: "ios" }),
    });
    console.info("[ios] VoIP token registered");
  } catch (e) {
    console.warn("[ios] VoIP token register failed", e);
  }
}

/** Sticky ids from alert/VoIP push so pending offer fetch + softphone UI can bind. */
function applyNativeIncomingHint(ev) {
  const pushId = ev?.callId ? String(ev.callId) : "";
  if (ev?.callId) state.pendingNativeCallId = pushId;
  if (ev?.fromLineId) state.pendingNativeFromLineId = String(ev.fromLineId);
  if (ev?.toLineId) state.pendingNativeToLineId = String(ev.toLineId);
  else if (state.activeLineId) state.pendingNativeToLineId = String(state.activeLineId);
}

/**
 * Alert APNs / notification tap: open softphone ring card (no CallKit).
 * Pull pending SDP if WS offer has not arrived yet.
 */
async function handleIncomingAlertPush(ev) {
  applyNativeIncomingHint(ev);
  state.wsReplaced = false;
  ensureWs();
  console.info("[ios] incomingAlert", ev?.source || "", ev?.callId || "");
  try {
    await ensureIncomingOfferForCallKit();
  } catch (e) {
    console.warn("[ios] pending offer on alert failed", e);
  }
  paintCallLayer();
}

async function bootIosCallKit() {
  const kit = nativeCallKit();
  if (!kit || !isNativeIosShell() || iosCallKitReady) return;
  iosCallKitReady = true;
  try {
    await syncCallKitFlagFromNative();
    const useCallKit = callKitEnabled();
    // Persist JS flag → native UserDefaults so the *next* killed-app launch
    // starts PushKit in attach() before any VoIP push arrives.
    try {
      await kit.setCallKitEnabled?.({ enabled: useCallKit });
    } catch (e) {
      console.warn("[ios] setCallKitEnabled", e);
    }

    // Always register both listener families. Toggling CallKit later only
    // starts/stops PushKit — adding listeners twice would duplicate events.
    await kit.addListener("apnsToken", async (ev) => {
      await registerIosApnsToken(String(ev?.token || ""));
    });
    await kit.addListener("incomingAlert", async (ev) => {
      if (callKitEnabled()) return;
      await handleIncomingAlertPush(ev);
    });
    // Register answer/audio BEFORE incomingPush so retained CallKit answer is not
    // wiped by a later incomingPush handler (retain queue is per-event, FIFO per addListener).
    await kit.addListener("callAnswered", async (ev) => {
      if (!callKitEnabled()) return;
      callKitGate.answered = true;
      callKitGate.systemRinging = true;
      if (ev?.callId) state.pendingNativeCallId = String(ev.callId);
      // Lock-screen Answer must reclaim signaling even if a prior tab marked replaced.
      if (state.wsReplaced) reconnectWs();
      else ensureWs();
      paintCallLayer();
      console.info("[ios] callAnswered", ev?.replay ? "(replay)" : "", ev?.callId || "");
      // Await SDP before accept — fire-and-forget raced accept with empty state.call.
      try {
        await ensureIncomingOfferForCallKit();
      } catch (e) {
        console.warn("[ios] pending offer on answer failed", e);
      }
      signalCallKitAccepted("callAnswered");
      armCallKitAcceptRetries();
      armCallKitStatePoll();
      void acceptCallFromCallKit();
      // Prefer real didActivate — force only after ~4s (silent if we gum too early).
      scheduleForceCallKitAudio("callAnswered-timeout", 4000);
    });
    await kit.addListener("audioActivated", async () => {
      if (!callKitEnabled()) return;
      const wasForced = callKitGate.forcedAudio;
      callKitGate.audioActive = true;
      callKitGate.forcedAudio = false;
      if (callKitForceAudioTimer) {
        clearTimeout(callKitForceAudioTimer);
        callKitForceAudioTimer = null;
      }
      console.info("[ios] CallKit audio session active", wasForced ? "(after forced)" : "");
      // Real didActivate: Cap uplink is often silent if we gum'd early or used track.clone().
      // Always refresh master→mid-0 sender after a real session activate when a PC exists.
      try {
        armMicForCall();
      } catch {}
      if (isPcAlive()) {
        const needRefresh =
          wasForced ||
          callKitGate.answerSent ||
          !micStreamSendingOk(state.localStream) ||
          !pcHasSendingMic(state.pc);
        try {
          if (needRefresh) {
            await refreshCallKitUplinkMic(wasForced ? "didActivate-after-forced" : "didActivate");
          } else {
            await attachLocalMicToPc(state.pc, { force: true });
            reportMediaStat(state.pc, "audioActivated-mic");
          }
        } catch (e) {
          console.warn("[ios] audioActivated mic refresh", e);
        }
      }
      try {
        for (const r of state.pc?.getReceivers?.() || []) {
          if (r.track) r.track.enabled = true;
        }
      } catch {}
      // Do NOT call setSpeaker here — fighting the session mid-handoff silences WebRTC.
      remountRemoteAudioFromPc("audioActivated");
      [150, 400, 900, 1800].forEach((ms) =>
        setTimeout(() => remountRemoteAudioFromPc("audioActivated-kick"), ms)
      );
      setTimeout(() => applyPreferredCallAudio(), 900);
      armCallKitAcceptRetries();
      await acceptCallFromCallKit();
    });
    await kit.addListener("audioDeactivated", () => {
      // Ignore brief deactivations while a CallKit call is still answered —
      // clearing audioActive mid-call blocked remount / play kicks.
      if (callKitGate.answered || callKitHoldsMic()) return;
      callKitGate.audioActive = false;
      // Cap iOS: release capture when CallKit drops the session (prefer hard release over park).
      hardReleaseMicStream();
    });
    await kit.addListener("callStarted", (ev) => {
      if (!callKitEnabled()) return;
      // Outbound CXStartCallAction — system owns the call; keep mic.
      callKitGate.answered = true;
      callKitGate.systemRinging = true;
      if (ev?.callId) state.pendingNativeCallId = String(ev.callId);
      console.info("[ios] callStarted (outbound CallKit)", ev?.callId || "");
    });
    await kit.addListener("voipToken", async (ev) => {
      if (!callKitEnabled()) return;
      await registerIosVoipToken(String(ev?.token || ""));
    });
    await kit.addListener("voipTokenInvalid", async () => {
      lastIosVoipToken = "";
      await clearRegisteredVoipTokens();
    });
    await kit.addListener("incomingPush", async (ev) => {
      if (!callKitEnabled()) return;
      // Do NOT resetCallKitGate here — retained incomingPush can arrive after
      // callAnswered and would wipe answered/audioActive (lock-screen race).
      callKitGate.systemRinging = true;
      applyNativeIncomingHint(ev);
      const pushId = ev?.callId ? String(ev.callId) : "";
      // Only clear answerSent for a brand-new call id.
      if (pushId && state.call?.callId && pushId !== String(state.call.callId)) {
        callKitGate.answered = false;
        callKitGate.audioActive = false;
        callKitGate.forcedAudio = false;
        callKitGate.answerSent = false;
        callKitGate.acceptedSignaled = false;
      }
      state.wsReplaced = false;
      ensureWs();
      console.info("[ios] incomingPush", pushId || "");
      armCallKitStatePoll();
      void syncCallKitStateFromNative("incomingPush");
      // Start pulling SDP immediately — don't wait for answer gesture.
      void ensureIncomingOfferForCallKit();
      // If we already answered (replay race), stop ATA ringback with push line ids.
      if (callKitGate.answered) signalCallKitAccepted("incomingPush");
    });
    await kit.addListener("callEnded", () => {
      if (!callKitEnabled() && !callKitGate.systemRinging && !callKitGate.answered) return;
      const wasMissed = callKitGate.systemRinging && !callKitGate.answered;
      resetCallKitGate();
      if (state.call) hangup();
      if (wasMissed) {
        state.pendingNativeMissed = Math.max(1, Number(state.pendingNativeMissed) || 0);
        void syncIosAppBadge();
        void refresh().then(() => syncIosAppBadge()).catch(() => {});
      } else {
        void syncIosAppBadge();
      }
    });

    try {
      const res = await kit.registerAlertPush?.();
      console.info("[ios] alert push permission", res?.granted);
    } catch (e) {
      console.warn("[ios] registerAlertPush failed", e);
    }
    if (useCallKit) {
      try {
        await kit.registerVoIP();
      } catch (e) {
        console.warn("[ios] registerVoIP failed", e);
      }
    }
    try {
      await kit.requestBadgePermission?.();
    } catch (e) {
      console.warn("[ios] badge permission", e);
    }
    armIosAppBadgeLifecycle();
    armIosMicLifecycle();
    void syncIosAppBadge();
    if (useCallKit) {
      void syncCallKitStateFromNative("boot");
      armCallKitStatePoll();
      console.info("[ios] CallKit / PushKit armed");
    } else {
      // Cold start after tap: reclaim any pending offer for the softphone card.
      void ensureIncomingOfferForCallKit().then((ok) => {
        if (ok) paintCallLayer();
      });
      console.info("[ios] CallKit tabled — alert APNs + in-app softphone armed");
    }
  } catch (e) {
    console.warn("[ios] CallKit boot failed", e);
    iosCallKitReady = false;
  }
}

async function boot() {
  await ensurePublicHttps();
  // Native shell: mark early so CSS can avoid double safe-area / dvh WebView quirks.
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      document.documentElement.classList.add("capacitor-native");
      document.documentElement.classList.add("ph-standalone");
      document.documentElement.dataset.nativePlatform = window.Capacitor.getPlatform?.() || "native";
    }
  } catch {}
  initSpecularTilt();
  await restoreNativeSession();
  await syncCallKitFlagFromNative();
  if (state.sessionId) {
    try {
      if (mustCompleteHowItWorks()) startForcedHowItWorks();
      await refresh();
      void persistSession(state.sessionId);
      if (mustCompleteHowItWorks()) {
        startForcedHowItWorks();
        render();
        void bootIosCallKit();
        return;
      }
      void bootIosCallKit();
      return;
    } catch (e) {
      if (isUnauthorizedError(e)) {
        await persistSession("");
        localStorage.removeItem("kl_line");
      }
    }
  }
  const invite = new URLSearchParams(location.search).get("invite");
  const guardianCode = new URLSearchParams(location.search).get("guardian");
  // Invite deep-links skip splash but still offer tutorial if never seen
  if (invite) {
    state.mode = "join";
    if (mustCompleteHowItWorks()) {
      startForcedHowItWorks();
    } else if (localStorage.getItem(TUTORIAL_KEY) === "1") {
      state.screen = "join";
    } else {
      state.tutorialIndex = 0;
      state.tutorialFarthest = 0;
      state.screen = "tutorial";
    }
  } else if (guardianCode && state.sessionId) {
    state.pendingGuardianCode = guardianCode;
    if (mustCompleteHowItWorks()) {
      startForcedHowItWorks();
    } else {
      state.screen = "home";
      state.nav = "controls";
      localStorage.setItem("kl_nav", "controls");
    }
  } else if (guardianCode) {
    state.pendingGuardianCode = guardianCode;
    if (mustCompleteHowItWorks()) startForcedHowItWorks();
    else state.screen = "login";
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
      setFlash("You’re now a co-parent for that kid", "ok");
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
