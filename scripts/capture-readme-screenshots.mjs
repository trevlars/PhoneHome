#!/usr/bin/env node
/**
 * Capture PhoneHome UI screenshots for README / docs.
 * Usage: node scripts/capture-readme-screenshots.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "screenshots");
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForFile(file, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function api(cookie, method, pathname, body) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = `kl_session=${cookie}`;
  const res = await fetch(`${BASE}${pathname}`, {
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

async function seedSession(setupCode) {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: setupCode, displayName: "Alex" }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok) throw new Error(`login failed: ${JSON.stringify(loginJson)}`);
  const session = loginRes.headers.get("set-cookie")?.match(/kl_session=([^;]+)/)?.[1];
  if (!session) throw new Error("No session cookie from login");

  await api(session, "POST", "/api/auth/set-password", {
    username: "readme_demo",
    password: "ReadmeDemo9a!",
  });

  const { household } = await api(session, "POST", "/api/households", { name: "Larsen" });
  await api(session, "POST", `/api/households/${household.id}/lines`, {
    name: "Alex",
    type: "softphone",
    mode: "parent",
  });
  await api(session, "POST", `/api/households/${household.id}/lines`, {
    name: "Gemma",
    type: "softphone",
    mode: "child",
    child_label: "kid",
  });
  await api(session, "PATCH", `/api/households/${household.id}/rules`, {
    parent_pin: "1234",
  });

  return session;
}

async function capture(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`wrote ${path.relative(ROOT, file)}`);
}

async function freshContext(browser) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
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

async function waitForApp(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(
    () =>
      document.querySelector("#splash-root") ||
      document.querySelector("#tutorial-root") ||
      document.querySelector(".dock"),
    { timeout: 30000 }
  );
  await sleep(1500);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonehome-screenshots-"));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, PUBLIC_BASE_URL: BASE };

  const server = spawn("npm", ["run", "start", "-w", "server"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => process.stdout.write(d));
  server.stderr?.on("data", (d) => process.stderr.write(d));

  const shutdown = () => server.kill("SIGTERM");
  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    process.exit(130);
  });

  try {
    const setupCode = await waitForFile(path.join(dataDir, "HOST_CODE.txt"));
    const session = await seedSession(setupCode);

    const browser = await chromium.launch();

    // Splash + tutorial (logged out, clean storage)
    {
      const { context, page } = await freshContext(browser);
      await waitForApp(page);
      await page.waitForSelector("#splash-root", { timeout: 5000 });
      await capture(page, "01-splash");

      await page.click("#splash-continue");
      await page.waitForSelector("#tutorial-root", { timeout: 15000 });
      await sleep(500);
      await page.click("#next");
      await sleep(400);
      await page.click("#next");
      await sleep(600);
      await capture(page, "02-tutorial-your-people");
      await context.close();
    }

    // Logged-in app chrome
    {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
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
      await waitForApp(page);
      await page.waitForSelector('.dock [data-nav="phone"]', { timeout: 20000 });
      await sleep(1000);
      await capture(page, "03-phone-pad");

      await page.click('[data-nav="controls"]');
      await page.waitForSelector("#parent-panel", { timeout: 15000 }).catch(() => {});
      await sleep(900);
      await capture(page, "04-parent-settings");

      await page.click('[data-nav="activity"]');
      await sleep(700);
      await capture(page, "05-activity");
      await context.close();
    }

    await browser.close();

    const copies = [
      ["web/public/assets/analog/kid-landline.jpg", "06-kid-landline.jpg"],
      ["web/public/assets/analog/invite-qr-table.jpg", "07-invite-family.jpg"],
      ["web/public/assets/analog/ht801-v2-1.png", "08-ht801-adapter.png"],
    ];
    for (const [src, dest] of copies) {
      const from = path.join(ROOT, src);
      const to = path.join(OUT, dest);
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, to);
        console.log(`copied ${path.relative(ROOT, to)}`);
      }
    }

    console.log("\nDone. Screenshots in docs/screenshots/");
  } finally {
    shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
