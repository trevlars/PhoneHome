#!/usr/bin/env node
/**
 * PhoneHome Discord server bootstrap via Bot API.
 * Docs: docs/marketing/discord-bot-setup.md
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const API = "https://discord.com/api/v10";
const DEFAULT_GUILD_ID = "1548793499753648238";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");

function parseEnvFile(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function loadEnvFiles() {
  const candidates = [
    process.env.DISCORD_ENV_FILE,
    join(REPO_ROOT, "discord.env"),
    join(REPO_ROOT, ".env.discord"),
    join(homedir(), ".phonehome", "discord.env"),
  ].filter(Boolean);
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    parseEnvFile(readFileSync(path, "utf8"));
    if (process.env.DISCORD_BOT_TOKEN) {
      console.log(`Loaded token from ${path}`);
      return path;
    }
  }
  return null;
}

function readCliToken() {
  const tokenIdx = argv.indexOf("--token");
  if (tokenIdx >= 0 && argv[tokenIdx + 1]) {
    process.env.DISCORD_BOT_TOKEN = argv[tokenIdx + 1];
    return;
  }
  const fileIdx = argv.indexOf("--token-file");
  if (fileIdx >= 0 && argv[fileIdx + 1]) {
    const path = resolve(argv[fileIdx + 1]);
    if (!existsSync(path)) throw new Error(`Token file not found: ${path}`);
    parseEnvFile(readFileSync(path, "utf8"));
    console.log(`Loaded token from ${path}`);
  }
}

loadEnvFiles();
readCliToken();

const GUILD_ID = process.env.DISCORD_GUILD_ID || DEFAULT_GUILD_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;

function printHelp() {
  console.error(`
Discord bot token missing.

Option A — env file (recommended):
  mkdir -p ~/.phonehome
  printf '%s\\n' 'DISCORD_BOT_TOKEN=PASTE_TOKEN_HERE' > ~/.phonehome/discord.env
  chmod 600 ~/.phonehome/discord.env
  npm run discord:setup

Option B — one line (zsh/bash):
  DISCORD_BOT_TOKEN='PASTE_TOKEN_HERE' npm run discord:setup

Option C — pass token directly:
  npm run discord:setup -- --token 'PASTE_TOKEN_HERE'

Also checked: ./discord.env, ./.env.discord

Bot checklist: docs/marketing/discord-bot-setup.md
`);
}

const RULES_TEXT = `Welcome to **PhoneHome** — the home phone, reborn.

1. Be respectful — families and hosts helping each other.
2. **Never** paste SIP passwords, APNs keys, full SDP, or crypto in public channels.
3. No call recording/transcription bots — PhoneHome doesn't record calls.
4. Bugs with repro → GitHub Issues. Sensitive details → DM or support email.
5. PhoneHome is **not** emergency service. No PSTN or 911.
6. No spam or harassment.

**Links:** https://phonehome.pages.dev · TestFlight: https://testflight.apple.com/join/4SWCTNec · Discussions: https://github.com/trevlars/PhoneHome/discussions`;

const FAQ_TEXT = `**PhoneHome FAQ** (pinned links)

• Home: https://phonehome.pages.dev
• Free trial: https://phonehome.pages.dev/trial.html
• Compare: https://phonehome.pages.dev/compare.html
• Self-host: https://github.com/trevlars/PhoneHome/blob/master/docs/self-host.md
• r/PhoneHome: https://reddit.com/r/PhoneHome
• Support: support@example.com`;

const ICON_PATH = join(REPO_ROOT, "web/public/icon-1024.png");

const SCREENING_RULES = [
  "Be respectful — families and hosts helping each other.",
  "Never paste SIP passwords, APNs keys, full SDP, or crypto in public channels.",
  "No call recording/transcription bots.",
  "PhoneHome is not emergency service. No PSTN or 911.",
  "No spam or harassment.",
];

const WELCOME_TEXT = `👋 Welcome to **PhoneHome**!

Private family calling — kids tap a face to call people you approve. Ask in **#setup-help** or **#app-help**. Read **#rules** first.`;

async function api(method, path, body) {
  if (DRY) {
    console.log(`[dry-run] ${method} ${path}`, body ? JSON.stringify(body).slice(0, 120) : "");
    return {};
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listBotGuilds() {
  const res = await fetch(`${API}/users/@me/guilds`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET /users/@me/guilds → ${res.status}: ${text}`);
  return JSON.parse(text);
}

function guildIconDataUri() {
  if (!existsSync(ICON_PATH)) {
    console.warn(`Icon not found at ${ICON_PATH} — skipping guild icon upload`);
    return null;
  }
  const png = readFileSync(ICON_PATH);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function uploadGuildIcon() {
  const icon = guildIconDataUri();
  if (!icon) return;
  await api("PATCH", `/guilds/${GUILD_ID}`, { icon });
  console.log("Guild icon uploaded");
}

async function enableCommunity(rulesChannelId, updatesChannelId) {
  const guild = await api("GET", `/guilds/${GUILD_ID}`);
  if (guild.features?.includes("COMMUNITY")) {
    console.log("Community already enabled");
    return;
  }
  await api("PATCH", `/guilds/${GUILD_ID}`, {
    features: ["COMMUNITY"],
    verification_level: 1,
    default_message_notifications: 1,
    explicit_content_filter: 2,
    rules_channel_id: rulesChannelId,
    public_updates_channel_id: updatesChannelId,
  });
  console.log("Community enabled (#rules + #announcements)");
}

async function enableRulesScreening() {
  await api("PATCH", `/guilds/${GUILD_ID}/member-verification`, {
    enabled: true,
    description: "Read and agree to the PhoneHome server rules.",
    form_fields: [
      {
        field_type: "TERMS",
        label: "Server rules",
        description: "You must agree to participate.",
        required: true,
        values: SCREENING_RULES,
      },
    ],
  });
  console.log("Rules screening enabled");
}

async function configureWelcomeScreen(rulesChannelId, faqChannelId, setupHelpChannelId) {
  await api("PATCH", `/guilds/${GUILD_ID}/welcome-screen`, {
    enabled: true,
    description: "Private family calling on your Mothership.",
    welcome_channels: [
      {
        channel_id: rulesChannelId,
        description: "Read the rules",
        emoji_id: null,
        emoji_name: "📜",
      },
      {
        channel_id: faqChannelId,
        description: "FAQ and links",
        emoji_id: null,
        emoji_name: "❓",
      },
      {
        channel_id: setupHelpChannelId,
        description: "Setup help",
        emoji_id: null,
        emoji_name: "🛠️",
      },
    ],
  });
  console.log("Welcome screen configured");
}

async function botInviteUrl() {
  const res = await fetch(`${API}/oauth2/applications/@me`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  const app = await res.json();
  if (!app?.id) return null;
  const perms = 8; // Administrator — bootstrap only
  return `https://discord.com/api/oauth2/authorize?client_id=${app.id}&permissions=${perms}&scope=bot%20applications.commands`;
}

async function main() {
  if (!TOKEN && !DRY) {
    printHelp();
    process.exit(1);
  }

  console.log(`Guild: ${GUILD_ID}${DRY ? " (dry-run)" : ""}`);

  if (!DRY) {
    const guilds = await listBotGuilds();
    const target = guilds.find((g) => g.id === GUILD_ID);
    if (!target) {
      console.error("\n404 Unknown Guild — the bot is not in that server yet.\n");
      if (!guilds.length) {
        const invite = await botInviteUrl();
        console.error("Invite the bot to PhoneHome, then re-run npm run discord:setup:\n");
        if (invite) console.error(invite);
        else {
          console.error(
            "Developer Portal → OAuth2 → URL Generator → bot + Administrator → open URL → pick PhoneHome"
          );
        }
      } else {
        console.error("Bot is only in:");
        for (const g of guilds) console.error(`  ${g.id}  ${g.name}`);
        console.error(`\nEither invite it to PhoneHome (${GUILD_ID}) or set DISCORD_GUILD_ID to one of the above.`);
      }
      process.exit(1);
    }
    console.log(`Bot is in: ${target.name}`);
  }

  // Server profile
  await api("PATCH", `/guilds/${GUILD_ID}`, {
    name: "PhoneHome",
    description: "The home phone, reborn — private family calling on your Mothership.",
  });

  // Roles (create if missing)
  const rolesRaw = await api("GET", `/guilds/${GUILD_ID}/roles`);
  const roles = Array.isArray(rolesRaw) ? rolesRaw : [];
  const roleDefs = [
    { name: "Admin", color: 0xf0c14d, permissions: "8" },
    { name: "Mod", color: 0x8ed4b0, permissions: "268435456" },
    { name: "Host", color: 0x1f6b4a, permissions: "0" },
    { name: "Beta", color: 0xb7cfc4, permissions: "0" },
  ];
  for (const def of roleDefs) {
    if (!roles.find((r) => r.name === def.name)) {
      await api("POST", `/guilds/${GUILD_ID}/roles`, def);
      await sleep(300);
    }
  }

  const channelsRaw = await api("GET", `/guilds/${GUILD_ID}/channels`);
  const channels = Array.isArray(channelsRaw) ? [...channelsRaw] : [];
  const byName = (n) => channels.find((c) => c.name === n);

  async function ensureCategory(name, position) {
    let ch = byName(name);
    if (!ch) {
      ch = await api("POST", `/guilds/${GUILD_ID}/channels`, {
        name,
        type: 4,
        position,
      });
      channels.push(ch);
      await sleep(300);
    }
    return ch.id;
  }

  async function ensureText(name, parentId, opts = {}) {
    let ch = byName(name);
    if (!ch) {
      ch = await api("POST", `/guilds/${GUILD_ID}/channels`, {
        name,
        type: 0,
        parent_id: parentId,
        topic: opts.topic || undefined,
        rate_limit_per_user: opts.slowmode ?? 0,
      });
      channels.push(ch);
      await sleep(300);
    }
    return ch;
  }

  const infoId = await ensureCategory("information", 0);
  const commId = await ensureCategory("community", 1);
  const supportId = await ensureCategory("support", 2);
  const staffId = await ensureCategory("staff", 3);

  const announcements = await ensureText("announcements", infoId, {
    topic: "Official PhoneHome announcements",
  });
  const rules = await ensureText("rules", infoId, { topic: "Server rules — read before posting" });
  const faq = await ensureText("faq", infoId, { topic: "Quick links and answers" });

  await ensureText("general", commId);
  await ensureText("show-and-tell", commId, { topic: "House phone setups and speed-dial screenshots" });
  await ensureText("feature-requests", commId);

  await ensureText("setup-help", supportId, {
    topic: "Mothership install, DuckDNS, HT801",
    slowmode: 10,
  });
  await ensureText("app-help", supportId, {
    topic: "iOS TestFlight, invite links, softphone",
    slowmode: 10,
  });
  await ensureText("bugs", supportId, { topic: "Confirmed bugs → GitHub Issues" });

  const modChat = await ensureText("mod-chat", staffId);

  // Lock announcements to admins (simplified: deny send for @everyone)
  const refreshedRolesRaw = await api("GET", `/guilds/${GUILD_ID}/roles`);
  const refreshedRoles = Array.isArray(refreshedRolesRaw) ? refreshedRolesRaw : [];
  const everyone = refreshedRoles.find((r) => r.name === "@everyone");
  const adminRole = refreshedRoles.find((r) => r.name === "Admin");

  if (everyone && !DRY) {
    await api("PUT", `/channels/${announcements.id}/permissions/${everyone.id}`, {
      type: 0,
      deny: "2048", // SEND_MESSAGES
    });
    if (adminRole) {
      await api("PUT", `/channels/${announcements.id}/permissions/${adminRole.id}`, {
        type: 0,
        allow: "3072", // VIEW + SEND
      });
    }
    await api("PUT", `/channels/${modChat.id}/permissions/${everyone.id}`, {
      type: 0,
      deny: "1024", // VIEW_CHANNEL
    });
  }

  // Post welcome messages (skip if channel already has messages — manual check omitted)
  for (const [ch, content] of [
    [rules, RULES_TEXT],
    [faq, FAQ_TEXT],
    [announcements, WELCOME_TEXT],
  ]) {
    if (!DRY) {
      await api("POST", `/channels/${ch.id}/messages`, { content });
      await sleep(500);
    }
  }

  // Permanent invite (use faq channel, or first available text channel)
  const inviteChannelId = faq?.id || announcements?.id;
  if (!inviteChannelId && !DRY) {
    throw new Error("No channel available for permanent invite");
  }
  const setupHelp = byName("setup-help");

  if (!DRY) {
    await uploadGuildIcon();
    await enableCommunity(rules.id, announcements.id);
    await enableRulesScreening();
    if (setupHelp) {
      await configureWelcomeScreen(rules.id, faq.id, setupHelp.id);
    }
  }

  const invite = await api("POST", `/channels/${inviteChannelId || "0"}/invites`, {
    max_age: 0,
    max_uses: 0,
    unique: true,
  });

  console.log("\nDone.");
  if (invite.code) {
    console.log(`Permanent invite: https://discord.gg/${invite.code}`);
    console.log("Update web/storefront-pages/community-urls.json with this URL.");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
