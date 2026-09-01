#!/usr/bin/env node
/**
 * App Store / TestFlight listing screenshots (iPhone, iPad, Mac-on-Apple-silicon).
 * Usage: node scripts/generate-app-store-screenshots.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  ROOT,
  IPHONE_VIEWPORT,
  IPHONE_SCALE,
  captureUiSet,
  seedSession,
  startServer,
  waitForFile,
} from "./lib/screenshot-session.mjs";

const OUT = path.join(ROOT, "mobile", "app-store", "screenshots");
const RAW = path.join(OUT, "_raw");
const ASSETS = path.join(ROOT, "web", "public", "assets", "analog");
const ICON = path.join(ROOT, "web", "public", "icon-1024.png");

function imageDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const IPHONE = { w: 1290, h: 2796 };
const IPAD = { w: 2048, h: 2732 };
const MAC = { w: 1280, h: 800 };

const SLIDES = [
  {
    file: "01-hero",
    headline: "The home phone, reborn",
    subline: "Private voice calls for kids and family — no feeds, no strangers.",
    shot: "splash",
    kind: "ui",
  },
  {
    file: "02-speed-dial",
    headline: "Tap a face to call",
    subline: "Big speed-dial buttons kids can use. TreeHouse & FamilyRoom built in.",
    shot: "phone",
    kind: "ui",
  },
  {
    file: "03-your-people",
    headline: "You choose who they call",
    subline: "Allowlist-only calling — both families approve before anyone rings.",
    shot: "tutorial",
    kind: "ui",
  },
  {
    file: "04-parent-controls",
    headline: "Parents stay in control",
    subline: "Quiet Time, daily limits, household Timeout, and a Parent PIN.",
    shot: "parent",
    kind: "ui",
  },
  {
    file: "05-invite-family",
    headline: "Invite cousins in seconds",
    subline: "Share your Mothership link + a code. No VPN, no carrier plan.",
    photo: "invite-qr-table.jpg",
    kind: "photo",
  },
  {
    file: "06-house-phone",
    headline: "Real wall phones too",
    subline: "Grandstream HT801 adapter · encrypted SIP TLS + SRTP.",
    photo: "kid-landline.jpg",
    kind: "photo",
  },
  {
    file: "07-private-by-design",
    headline: "Private by design",
    subline: "WebRTC & SIP TLS + SRTP. No call recording. You host the server.",
    shot: "activity",
    kind: "ui",
  },
];

function slideHtml({ canvas, headline, subline, imagePath, device = "iphone", kind = "ui" }) {
  const imgUrl = imageDataUrl(imagePath);
  const iconUrl = fs.existsSync(ICON) ? imageDataUrl(ICON) : "";
  const pad = canvas.w * 0.06;
  const imgW = canvas.w - pad * 2;
  const imgH =
    device === "ipad"
      ? Math.round(imgW * 1.28)
      : device === "mac"
        ? Math.round(imgW * 0.62)
        : Math.round(imgW * 2.05);
  const radius = device === "mac" ? 28 : 44;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Sora:wght@500;600&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${canvas.w}px;
      height: ${canvas.h}px;
      overflow: hidden;
      background:
        radial-gradient(120% 80% at 50% -10%, rgba(212, 167, 44, 0.22), transparent 55%),
        linear-gradient(180deg, #0f221b 0%, #0a1512 42%, #060d0b 100%);
      color: #f4f7f5;
      font-family: "Sora", system-ui, sans-serif;
    }
    .wrap {
      width: 100%;
      height: 100%;
      padding: ${Math.round(pad * 0.85)}px ${pad}px ${pad}px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: ${Math.round(pad * 0.55)}px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 18px;
      align-self: flex-start;
    }
    .brand img {
      width: 72px;
      height: 72px;
      border-radius: 18px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    }
    .brand span {
      font-family: "Fraunces", Georgia, serif;
      font-size: ${Math.round(canvas.w * 0.045)}px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .brand em {
      font-style: normal;
      color: #e8c45c;
    }
    h1 {
      font-family: "Fraunces", Georgia, serif;
      font-size: ${Math.round(canvas.w * 0.078)}px;
      line-height: 1.08;
      font-weight: 700;
      text-align: center;
      letter-spacing: -0.03em;
      max-width: 92%;
    }
    .shot {
      width: ${imgW}px;
      height: ${imgH}px;
      border-radius: ${radius}px;
      overflow: hidden;
      border: 1px solid rgba(232, 196, 92, 0.28);
      box-shadow:
        0 30px 80px rgba(0, 0, 0, 0.45),
        0 0 0 1px rgba(255,255,255,0.04) inset;
      background: #0e1a15;
      flex-shrink: 0;
    }
    .shot img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
      display: block;
    }
    .shot.ui img { object-fit: contain; background: #0e1a15; }
    p {
      font-size: ${Math.round(canvas.w * 0.034)}px;
      line-height: 1.45;
      text-align: center;
      color: rgba(244, 247, 245, 0.82);
      max-width: 88%;
    }
    .gold {
      width: 120px;
      height: 4px;
      border-radius: 999px;
      background: linear-gradient(90deg, transparent, #e8c45c, transparent);
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      ${iconUrl ? `<img src="${iconUrl}" alt="" />` : ""}
      <span>Phone<em>Home</em></span>
    </div>
    <div class="gold" aria-hidden="true"></div>
    <h1>${headline}</h1>
    <div class="shot ${kind}">
      <img src="${imgUrl}" alt="" />
    </div>
    <p>${subline}</p>
  </div>
</body>
</html>`;
}

async function renderSlide(page, { canvas, device, kind, ...slide }, imagePath, dest) {
  const html = slideHtml({
    canvas,
    headline: slide.headline,
    subline: slide.subline,
    imagePath,
    device,
    kind,
  });
  await page.setViewportSize({ width: canvas.w, height: canvas.h });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: dest, fullPage: false });
  console.log(`wrote ${path.relative(ROOT, dest)}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });

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

    const iphoneRaw = await captureUiSet(browser, {
      base,
      session,
      outDir: path.join(RAW, "iphone"),
      viewport: IPHONE_VIEWPORT,
      scale: IPHONE_SCALE,
    });

    const ipadRaw = await captureUiSet(browser, {
      base,
      session,
      outDir: path.join(RAW, "ipad"),
      viewport: { width: 1024, height: 1366 },
      scale: 2,
    });

    const photos = {
      invite: path.join(ASSETS, "invite-qr-table.jpg"),
      landline: path.join(ASSETS, "kid-landline.jpg"),
    };

    const frame = await browser.newPage();

    for (const device of [
      { id: "iphone-6.7", canvas: IPHONE, raw: iphoneRaw, device: "iphone" },
      { id: "ipad-12.9", canvas: IPAD, raw: ipadRaw, device: "ipad" },
      { id: "mac", canvas: MAC, raw: iphoneRaw, device: "mac" },
    ]) {
      const dir = path.join(OUT, device.id);
      fs.mkdirSync(dir, { recursive: true });

      for (const slide of SLIDES) {
        const imagePath =
          slide.kind === "photo"
            ? photos[slide.photo === "invite-qr-table.jpg" ? "invite" : "landline"]
            : device.raw[slide.shot];
        if (!imagePath || !fs.existsSync(imagePath)) {
          console.warn(`skip ${slide.file} — missing ${imagePath}`);
          continue;
        }
        await renderSlide(
          frame,
          { canvas: device.canvas, device: device.device, kind: slide.kind, ...slide },
          imagePath,
          path.join(dir, `${slide.file}.png`)
        );
      }
    }

    await frame.close();
    await browser.close();
    console.log(`\nDone. Upload from ${path.relative(ROOT, OUT)}/`);
  } finally {
    shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
