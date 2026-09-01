#!/usr/bin/env node
/**
 * Capture PhoneHome UI screenshots for README / docs.
 * Usage: node scripts/capture-readme-screenshots.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  ROOT,
  README_VIEWPORT,
  captureUiSet,
  freshContext,
  seedSession,
  sleep,
  startServer,
  waitForApp,
  waitForFile,
} from "./lib/screenshot-session.mjs";

const OUT = path.join(ROOT, "docs", "screenshots");

async function capture(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`wrote ${path.relative(ROOT, file)}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const { base, shutdown, setupCodePath } = startServer();
  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    process.exit(130);
  });

  try {
    const setupCode = await waitForFile(setupCodePath);
    const session = await seedSession(base, setupCode);
    const browser = await chromium.launch();

    {
      const { context, page } = await freshContext(browser, { viewport: README_VIEWPORT, scale: 2 });
      await waitForApp(page, base);
      await page.waitForSelector("#splash-root", { timeout: 10000 });
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

    const rawDir = path.join(OUT, "_raw");
    const shots = await captureUiSet(browser, {
      base,
      session,
      outDir: rawDir,
      viewport: README_VIEWPORT,
      scale: 2,
    });
    fs.copyFileSync(shots.phone, path.join(OUT, "03-phone-pad.png"));
    fs.copyFileSync(shots.parent, path.join(OUT, "04-parent-settings.png"));
    fs.copyFileSync(shots.activity, path.join(OUT, "05-activity.png"));
    console.log(`wrote ${path.relative(ROOT, path.join(OUT, "03-phone-pad.png"))}`);
    console.log(`wrote ${path.relative(ROOT, path.join(OUT, "04-parent-settings.png"))}`);
    console.log(`wrote ${path.relative(ROOT, path.join(OUT, "05-activity.png"))}`);

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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
