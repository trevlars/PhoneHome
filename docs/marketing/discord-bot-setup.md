# Discord bot setup — one-time

Automates channels, roles, pinned messages, and a **permanent invite** via [`scripts/discord-setup.mjs`](../../scripts/discord-setup.mjs).

**Guild:** PhoneHome (`1548793499753648238`)  
**Current invite:** https://discord.gg/QWmCcnJn2Q (permanent)

## 1. Create the bot (5 minutes)

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → name: **PhoneHome**
2. **Bot** → **Reset Token** → copy token (this is `DISCORD_BOT_TOKEN` — never commit it)
3. **Bot** → enable **Message Content Intent** (for future bots; harmless to enable now)
4. **OAuth2** → **URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: **Administrator** (simplest for bootstrap; tighten later)
5. Open the generated URL → add bot to **PhoneHome** server

   PhoneHome app invite (Administrator, one-time bootstrap):

   https://discord.com/api/oauth2/authorize?client_id=1556671141240643696&permissions=8&scope=bot%20applications.commands

   If setup prints `404 Unknown Guild`, the bot was created but **not invited** — open that URL, pick **PhoneHome**, authorize, then re-run `npm run discord:setup`.

## 2. Run the bootstrap script

**Recommended** — save token once, then run anytime:

```bash
mkdir -p ~/.phonehome
printf '%s\n' 'DISCORD_BOT_TOKEN=PASTE_TOKEN_HERE' > ~/.phonehome/discord.env
chmod 600 ~/.phonehome/discord.env
cd /path/to/PhoneHome
npm run discord:setup
```

One-liner (paste your real token between the quotes):

```bash
DISCORD_BOT_TOKEN='PASTE_TOKEN_HERE' npm run discord:setup
```

Or pass on the command line:

```bash
npm run discord:setup -- --token 'PASTE_TOKEN_HERE'
```

The script auto-loads, in order: `~/.phonehome/discord.env`, `./discord.env`, `./.env.discord`.

Dry-run (no API calls):

```bash
npm run discord:setup -- --dry-run
```

The script creates:

| Category | Channels |
| -------- | -------- |
| INFORMATION | `#announcements`, `#rules`, `#faq` |
| COMMUNITY | `#general`, `#show-and-tell`, `#feature-requests` |
| SUPPORT | `#setup-help` (10s slowmode), `#app-help` (10s slowmode), `#bugs` |
| STAFF | `#mod-chat` (hidden from @everyone) |

Roles: **Admin**, **Mod**, **Host**, **Beta**

Posts pinned-style welcome content in `#rules`, `#faq`, and `#announcements`.

Also via API (no Discord UI needed):

- Guild icon from [`web/public/icon-1024.png`](../../web/public/icon-1024.png)
- **Community** enabled (`#rules` + `#announcements` as system channels)
- **Rules screening** on the five server rules
- **Welcome screen** highlighting `#rules`, `#faq`, `#setup-help`

Outputs a **permanent invite** — paste into `web/storefront-pages/community-urls.json` and redeploy.

## 3. Manual steps (optional)

1. Assign yourself the **Admin** role in Discord
2. Delete the old `#general` channel if a duplicate exists under COMMUNITY (or rename/move)
3. Enable **Server Discovery** later if you want public listing (not required for launch)

## 4. Store token safely

Put the bot token in your shell profile or a gitignored file — **not** in the repo:

```bash
# ~/.phonehome/discord.env (gitignored)
DISCORD_BOT_TOKEN=...
```

## Troubleshooting

| Error | Fix |
| ----- | --- |
| 401 Unauthorized | Bad or expired bot token |
| 403 Missing Access | Re-invite bot with Administrator |
| 403 Missing Permissions | Bot role must be above roles it manages |
| Channels duplicated | Script is idempotent by name; delete extras manually once |
