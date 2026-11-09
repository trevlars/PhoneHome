# Social & community asset specs

Export sizes and usage notes for PhoneHome marketing channels.

## Profile pictures

Use [`web/public/icon-1024.png`](../../web/public/icon-1024.png) for all platforms. Crop to square; platforms resize automatically.

| Platform | Display size | Upload |
| -------- | ------------ | ------ |
| Instagram | 320×320 | 1024×1024 recommended |
| Facebook Page | 170×170 | 1024×1024 |
| TikTok | 200×200 | 1024×1024 |
| YouTube | 800×800 | 1024×1024 |
| Reddit subreddit | 256×256 | 1024×1024 |
| Discord server | 512×512 | 1024×1024 |

## Banners / cover images

Design on `#07110d` background with gold (`#f0c14d`) accent. Include wordmark "PhoneHome" in Fraunces + tagline "The home phone, reborn."

| Platform | Size | Notes |
| -------- | ---- | ----- |
| YouTube channel art | 2560×1440 | Safe area center 1546×423 — keep logo/tagline inside |
| Facebook cover | 820×312 | Mobile crops sides |
| Twitter/X header | 1500×500 | If added later |
| Reddit banner | 1920×384 or 1920×256 | Subreddit settings |
| Discord invite splash | 1920×1080 | Server Settings → Invite Background |
| TikTok | N/A | Profile has no banner |

## Link preview (Open Graph)

Already configured on storefront pages. Default image: `https://phonehome.pages.dev/assets/landing/kid-landline.jpg` on homepage; `icon-512.png` on inner pages.

## Landing photography inventory

Path: [`web/storefront-pages/assets/landing/`](../../web/storefront-pages/assets/landing/)

| File | Subject | Social use |
| ---- | ------- | ---------- |
| `kid-landline.jpg` | Child on house phone | **Hero / OG** — confirm model/release before paid ads |
| `shot-speed-dial.webp` | App UI speed dial | Safe — product UI |
| `shot-parent.webp` | Parent controls UI | Safe — product UI |
| `shot-activity.webp` | Activity log UI | Safe — product UI |
| `shot-messages.webp` | Messages UI | Safe — product UI |
| `ht801.png` | ATA hardware | Safe — product photo |
| `analog-phone.png` | Rotary phone | Safe — product photo |
| `phone-football.webp`, `phone-banana.webp`, etc. | Themed kid phones | Safe — product/styled props |
| `amara.jpg`, `carlos.jpg`, `eleanor.jpg`, etc. | Named avatar portraits | **UI mock only** — do not imply real people in ads |
| `kenji.jpg`, `layla.jpg`, `maya.jpg`, `owen.jpg`, `priya.jpg` | Avatar portraits | Same as above |

**Action required (Cameron):** Confirm you have rights to use `kid-landline.jpg` in organic social and paid Meta/TikTok ads. Until confirmed, prefer UI screenshots and hardware shots for launch posts.

## App Store screenshots

Regenerate: `npm run app-store:screenshots` from repo root.

Frames live in [`mobile/app-store/screenshots/`](../../mobile/app-store/screenshots/) — suitable for Instagram carousels and TikTok slideshows.

## Central URL config

Community and social profile URLs are maintained in one place for the storefront footer:

[`web/storefront-pages/community-urls.json`](../../web/storefront-pages/community-urls.json)

Update that file when accounts are created; redeploy storefront to Cloudflare Pages.

## Community link targets (expected handles)

Try `@phonehome`, then `@phonehomeapp`, then `@phonehomefamily` on each platform. Reddit: `r/PhoneHome`. Discord: permanent invite from Server Settings.
