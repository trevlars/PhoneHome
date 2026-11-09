import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");

export const DEFAULT_PORT = 8791;
export const DEFAULT_BASE = (port = DEFAULT_PORT) => `http://127.0.0.1:${port}`;

export const IPHONE_VIEWPORT = { width: 430, height: 932 };
export const IPHONE_SCALE = 3;
export const README_VIEWPORT = { width: 390, height: 844 };

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForFile(file, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

export async function api(base, cookie, method, pathname, body) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = `kl_session=${cookie}`;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${pathname}: ${res.status} ${text}`);
  return json;
}

export async function seedSession(base, setupCode) {
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: setupCode, displayName: "Alex" }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok) throw new Error(`login failed: ${JSON.stringify(loginJson)}`);
  const session = loginRes.headers.get("set-cookie")?.match(/kl_session=([^;]+)/)?.[1];
  if (!session) throw new Error("No session cookie from login");

  await api(base, session, "POST", "/api/auth/set-password", {
    username: "readme_demo",
    password: "ReadmeDemo9a!",
  });

  const { household } = await api(base, session, "POST", "/api/households", { name: "East" });
  await api(base, session, "POST", `/api/households/${household.id}/lines`, {
    name: "Alex",
    type: "softphone",
    mode: "parent",
  });
  await api(base, session, "POST", `/api/households/${household.id}/lines`, {
    name: "Alex",
    type: "softphone",
    mode: "child",
    child_label: "kid",
  });
  await api(base, session, "PATCH", `/api/households/${household.id}/rules`, {
    parent_pin: "1234",
  });

  return session;
}

const FACES = path.join(ROOT, "web", "public", "assets", "tutorial");

/** Populated family for App Store shots: faces on the kid pad, call history, Quiet Time on. */
export async function seedDemoFamily(base, setupCode, dataDir) {
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: setupCode, displayName: "Layla" }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok) throw new Error(`login failed: ${JSON.stringify(loginJson)}`);
  const session = loginRes.headers.get("set-cookie")?.match(/kl_session=([^;]+)/)?.[1];
  if (!session) throw new Error("No session cookie from login");

  await api(base, session, "POST", "/api/auth/set-password", {
    username: "store_demo",
    password: "StoreDemo9a!",
  });
  const { household } = await api(base, session, "POST", "/api/households", { name: "East" });
  const hh = household.id;
  const ids = {};
  const lineHousehold = {};
  const faces = {
    mom: "parent-layla.jpg",
    kid: "kid-maya.jpg",
    dad: "parent-kenji.jpg",
    grandma: "grand-eleanor.jpg",
    grandpa: "grand-carlos.jpg",
    cousin: "cousin-priya.jpg",
  };
  for (const [key, name, mode] of [
    ["mom", "Layla", "parent"],
    ["kid", "Alex", "child"],
    ["dad", "Kenji", "parent"],
    ["cousin", "Priya", "child"],
  ]) {
    const body = { name, type: "softphone", mode };
    if (mode === "child") body.child_label = name;
    const res = await api(base, session, "POST", `/api/households/${hh}/lines`, body);
    ids[key] = (res.line || res).id;
  }
  for (const [key, displayName, label] of [
    ["grandma", "Eleanor", "Grandma"],
    ["grandpa", "Carlos", "Grandpa"],
  ]) {
    const res = await api(base, session, "POST", `/api/households/${hh}/grandparents`, {
      displayName,
      username: `demo_${key}`,
      password: "GrandDemo9a!",
      label,
      kidLineIds: [ids.kid],
    });
    ids[key] = res.line.id;
    lineHousehold[key] = res.household?.id || res.line.household_id || hh;
  }
  for (const [key, file] of Object.entries(faces)) {
    const buf = fs.readFileSync(path.join(FACES, file));
    await api(base, session, "PUT", `/api/households/${lineHousehold[key] || hh}/lines/${ids[key]}/avatar`, {
      imageBase64: buf.toString("base64"),
      imageMime: "image/jpeg",
    });
  }
  await api(base, session, "PATCH", `/api/households/${hh}/rules`, {
    parent_pin: "1234",
    dnd: true,
    daily_cap_minutes: 45,
  });

  const calls = [
    ["grandma", "kid", "-26 minutes", 6 * 60, "completed"],
    ["kid", "dad", "-2 hours", 3 * 60, "completed"],
    ["cousin", "kid", "-3 hours", 0, "missed"],
    ["kid", "grandpa", "-1 day", 9 * 60, "completed"],
    ["mom", "kid", "-1 day", 2 * 60, "completed"],
    ["kid", "cousin", "-2 days", 12 * 60, "completed"],
  ];
  const sql = calls
    .map(([from, to, ago, secs, outcome], i) => {
      const at = (...mods) =>
        `strftime('%Y-%m-%dT%H:%M:%fZ','now','${ago}'${mods.map((m) => `,'${m}'`).join("")})`;
      const answered = outcome === "missed" ? "NULL" : at("+8 seconds");
      return `INSERT INTO call_logs (id, from_line_id, to_line_id, started_at, answered_at, ended_at, outcome) VALUES ('call_demo${i}', '${ids[from]}', '${ids[to]}', ${at()}, ${answered}, ${at(`+${secs + 20} seconds`)}, '${outcome}');`;
    })
    .join("\n")
    .concat(`
UPDATE lines SET greeting_confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE users SET parent_title = 'mom' WHERE id = (SELECT owner_user_id FROM lines WHERE id = '${ids.mom}');
INSERT INTO users (id, display_name, created_at, parent_title) VALUES ('user_demo_dad', 'Kenji', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'dad');
UPDATE lines SET owner_user_id = 'user_demo_dad' WHERE id = '${ids.dad}';
INSERT OR IGNORE INTO child_guardians (line_id, user_id, role, created_at) VALUES ('${ids.kid}', 'user_demo_dad', 'guardian', strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
  execFileSync("sqlite3", [path.join(dataDir, "kids-landline.db")], { input: sql });

  await api(base, session, "POST", `/api/lines/${ids.kid}/child-login`, {
    username: "demo_alex",
    password: "KidDemo9a!",
    displayName: "Alex",
  });
  const kidRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "demo_alex", password: "KidDemo9a!" }),
  });
  const kidSession = kidRes.headers.get("set-cookie")?.match(/kl_session=([^;]+)/)?.[1];
  if (!kidRes.ok || !kidSession) throw new Error(`kid login failed: ${await kidRes.text()}`);

  return { session, kidSession, householdId: hh, ids };
}

/** Fake Capacitor shell so captures show the iOS app (native onboarding, no install prompts). */
export async function emulateNativeIos(page, { mothershipUrl = "" } = {}) {
  await page.addInitScript((saved) => {
    const handlers = {
      getMothershipUrl: async () => ({ url: saved || "" }),
      getOnboarding: async () => ({ howItWorksDone: Boolean(saved) }),
      hasSavedLogin: async () => ({ saved: false }),
    };
    const kit = new Proxy(
      {},
      { get: (_t, prop) => (prop === "then" ? undefined : handlers[prop] || (async () => ({}))) }
    );
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "ios",
      Plugins: new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : kit) }),
    };
  }, mothershipUrl);
}

export function startServer({ port = DEFAULT_PORT, publicBaseUrl } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonehome-screenshots-"));
  const base = DEFAULT_BASE(port);
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    PUBLIC_BASE_URL: publicBaseUrl || base,
  };

  const server = spawn("npm", ["run", "start", "-w", "server"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => process.stdout.write(d));
  server.stderr?.on("data", (d) => process.stdout.write(d));

  const shutdown = () => {
    server.kill("SIGTERM");
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return {
    dataDir,
    base,
    shutdown,
    setupCodePath: path.join(dataDir, "HOST_CODE.txt"),
  };
}

export async function freshContext(browser, { viewport, scale = 2 } = {}) {
  const context = await browser.newContext({
    viewport: viewport || README_VIEWPORT,
    deviceScaleFactor: scale,
    colorScheme: "light",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });
  page.on("pageerror", (err) => console.error("pageerror:", err.message));
  return { context, page };
}

export async function waitForApp(page, base) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(
    () =>
      document.querySelector("#splash-root") ||
      document.querySelector("#tutorial-root") ||
      document.querySelector(".dock"),
    { timeout: 30000 }
  );
  await sleep(1500);
}

export async function captureUiSet(browser, { base, session, outDir, viewport, scale }) {
  fs.mkdirSync(outDir, { recursive: true });
  const shots = {};

  {
    const { context, page } = await freshContext(browser, { viewport, scale });
    await waitForApp(page, base);
    await page.waitForSelector("#splash-root", { timeout: 10000 });
    const splash = path.join(outDir, "raw-splash.png");
    await page.screenshot({ path: splash });
    shots.splash = splash;

    await page.click("#splash-continue");
    await page.waitForSelector("#tutorial-root", { timeout: 15000 });
    await sleep(500);
    await page.click("#next");
    await sleep(400);
    await page.click("#next");
    await sleep(600);
    const tutorial = path.join(outDir, "raw-tutorial-your-people.png");
    await page.screenshot({ path: tutorial });
    shots.tutorial = tutorial;
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: viewport || README_VIEWPORT,
      deviceScaleFactor: scale,
      colorScheme: "light",
    });
    await context.addCookies([
      { name: "kl_session", value: session, domain: "127.0.0.1", path: "/" },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("pageerror:", err.message));
    await page.addInitScript(
      (sid) => {
        localStorage.setItem("kl_session", sid);
        localStorage.setItem("kl_tutorial_v9", "1");
        localStorage.setItem("kl_how_it_works_install_v1", "1");
        localStorage.setItem("kl_nav", "phone");
        localStorage.setItem("kl_setup_dismissed_v1", "1");
        localStorage.setItem("kl_ui_theme", "modern");
      },
      session
    );
    await waitForApp(page, base);
    await page.waitForSelector('.dock [data-nav="phone"]', { timeout: 20000 });
    await sleep(1000);
    shots.phone = path.join(outDir, "raw-phone-pad.png");
    await page.screenshot({ path: shots.phone });

    await page.click('[data-nav="controls"]');
    await sleep(900);
    shots.parent = path.join(outDir, "raw-parent-settings.png");
    await page.screenshot({ path: shots.parent });

    await page.click('[data-nav="activity"]');
    await sleep(700);
    shots.activity = path.join(outDir, "raw-activity.png");
    await page.screenshot({ path: shots.activity });
    await context.close();
  }

  return shots;
}
