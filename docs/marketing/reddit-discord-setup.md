# Reddit & Discord setup

Community infrastructure for PhoneHome hosts, beta families, and early adopters.

## Reddit — r/PhoneHome

### Create the subreddit

1. Log in to Reddit (brand account recommended; enable **2FA**)
2. [reddit.com/subreddits/create](https://www.reddit.com/subreddits/create)
3. Name: `PhoneHome`
4. Type: **Public**
5. Description:

```
PhoneHome — the home phone, reborn. Private family calling on your own Mothership. Kids tap a face to call people you approve. Not a carrier; no PSTN or 911. https://phonehome.pages.dev
```

6. Icon: `web/public/icon-1024.png` (256×256)
7. Banner: 1920×384, dark green + gold (see [`social-assets.md`](social-assets.md))

### Sidebar rules

```
1. Be kind — parents and hosts helping each other.
2. No SIP passwords, APNs keys, SDP, or crypto in posts. Redact logs.
3. No call recording or transcription requests — PhoneHome doesn't support them.
4. Bugs → GitHub Issues with repro steps. Feature ideas welcome here.
5. PhoneHome is not emergency service. No PSTN or 911.
6. No spam, affiliate links, or competitor bashing.
7. Trademark comparisons OK with facts; see phonehome.pages.dev/compare.html
```

### Post flairs

`Announcement` · `Setup Help` · `Feature Request` · `Bug Report` · `Show & Tell` · `Privacy`

### Pinned post 1 — What is PhoneHome?

**Title:** What is PhoneHome? Start here.

**Body:**

```
PhoneHome is the home phone, reborn — a private, encrypted calling network for kids, parents, grandparents, and friends.

**How it works**
• Kids tap a face on a speed dial to call people you approve
• Both families approve before anyone can ring — no strangers
• Parents set Quiet Time, daily limits, and household rules
• Calls are encrypted and never recorded

**Ways to use it**
• Free iPhone app: https://apps.apple.com/app/id6804245868
• Browser softphone on any Mothership HTTPS URL
• Real house phone via Grandstream HT801 adapter

**Hosting**
• One Mothership server per extended-family network
• Host pays $25/year after 30-day trial; families who join pay $0
• Up to 50 phones per license
• Proprietary software. A host license is permission to run one Mothership.

**Honest limits**
• Does not call regular phone numbers
• Not emergency service — keep a real line for 911

Website: https://phonehome.pages.dev
Compare vs kid watches: https://phonehome.pages.dev/compare.html
Privacy: https://phonehome.pages.dev/privacy.html
```

### Pinned post 2 — Getting started

**Title:** Getting started — join a family or host your own Mothership

**Body:**

```
**Already have an invite?**
Open the link your family sent, or install the iPhone app and paste their Mothership HTTPS address. You don't need this subreddit to join.

**Want to host?**
1. Start a free trial: https://phonehome.pages.dev/trial.html
2. Pick a platform: macOS, Linux, Windows, Home Assistant, or Docker
3. Set HTTPS (DuckDNS or your own domain)
4. Create parent + kid lines, send invites

Docs: https://github.com/trevlars/PhoneHome/blob/master/docs/self-host.md

**Questions?**
Ask in a new post with the `Setup Help` flair, or join Discord (link on phonehome.pages.dev).
```

### Pinned post 3 — Rules & privacy

**Title:** Community rules and what not to share

**Body:**

```
**Never post in public:**
• SIP passwords or secrets
• Full Asterisk or bridge logs with SDP/crypto
• APNs keys or provisioning files
• Other families' call content or identifiers

**PhoneHome privacy pillar**
• No call recording or transcription
• No ads or analytics on calls
• Family data lives on your Mothership, not a central ad database

Support: support@example.com
Security issues: https://github.com/trevlars/PhoneHome/blob/master/SECURITY.md (don't post exploits publicly)

Be excellent to each other.
```

### Organic engagement

Participate in r/Parenting, r/raisingkids, r/homelab, r/selfhosted, r/privacy, r/HomeAssistant when threads fit. Answer helpfully; link to phonehome.pages.dev only when relevant. One r/selfhosted announcement when ready — not repeated spam.

---

## Discord — PhoneHome server

### Create the server

**Automated bootstrap:** [`discord-bot-setup.md`](discord-bot-setup.md) — `npm run discord:setup` creates channels, roles, pinned messages, and a permanent invite.

**Manual UI steps** (after bot script, or instead of it):

1. [discord.com](https://discord.com) → **Add a Server** → **For a club or community**
2. Name: **PhoneHome**
3. Enable **Community** (requires 2FA on your Discord account):
   - Server Settings → **Enable Community**
   - Rules screening channel: `#rules`
   - Welcome screen with channel highlights
4. Server icon: `icon-1024.png`
5. Invite splash: 1920×1080, brand colors `#07110d` + `#f0c14d`

### Channel structure

```
📢 INFORMATION
  #announcements      @Admin only
  #rules
  #faq

💬 COMMUNITY
  #general
  #show-and-tell
  #feature-requests

🛠 SUPPORT
  #setup-help         slow-mode 10s at launch
  #app-help
  #bugs

🔒 STAFF (private)
  #mod-chat
```

### Roles

| Role | Permissions |
| ---- | ----------- |
| @Admin | Full |
| @Mod | Manage messages, kick, #mod-chat |
| @Host | Optional color for Mothership operators |
| @Beta | Optional for TestFlight testers |
| @Member | Default @everyone after rules accept |

### #rules pinned message

```
Welcome to PhoneHome.

1. Be respectful — families and hosts helping each other.
2. Never paste SIP passwords, APNs keys, full SDP, or crypto in public channels.
3. No call recording/transcription bots — PhoneHome doesn't record calls.
4. Bugs with repro → GitHub Issues. Sensitive details → DM or support email.
5. PhoneHome is not emergency service. No PSTN or 911.
6. No spam or harassment.

FAQ: https://phonehome.pages.dev
GitHub Discussions: https://github.com/trevlars/PhoneHome/discussions
App Store: https://apps.apple.com/app/id6804245868
TestFlight (beta): https://testflight.apple.com/join/4SWCTNec
```

### #faq pinned links

- Home: https://phonehome.pages.dev
- Trial: https://phonehome.pages.dev/trial.html
- Compare: https://phonehome.pages.dev/compare.html
- Self-host: https://github.com/trevlars/PhoneHome/blob/master/docs/self-host.md
- r/PhoneHome: https://reddit.com/r/PhoneHome

### Permanent invite

Server Settings → Invites → create invite with **no expiry** → update [`community-urls.json`](../../web/storefront-pages/community-urls.json) → redeploy storefront.

**Launch mode:** Public invite on storefront + README (confirmed).

### Mod playbook

- `#setup-help` and `#app-help`: answer from docs; escalate bugs to GitHub Issues
- Delete posts with credentials immediately; remind user to rotate secrets
- Announce releases in `#announcements` only
- Phase 2 optional: Carl-bot/Wick auto-mod; GitHub webhook to `#bugs`

---

## Update storefront

After Reddit + Discord are live, set URLs in [`web/storefront-pages/community-urls.json`](../../web/storefront-pages/community-urls.json) and redeploy.
