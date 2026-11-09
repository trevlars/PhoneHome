# PhoneHome brand guide

Engineering reference for marketing, social, and storefront consistency. Not counsel-approved advertising copy.

## Tagline

**The home phone, reborn.**

## One-liner

Private, parent-controlled voice network for kids and extended family — self-hostable, encryption-first.

## Voice

- Plain, parent-facing, privacy-forward
- Honest about limits (no PSTN, no 911, not emergency service)
- Anti-surveillance: allowlists, no strangers, no recording, no ads
- Confident but not hypey — family-tested, not vaporware

## Legal entity

- **Seller:** the operator
- **Support:** support@example.com
- **Storefront:** https://phonehome.pages.dev

Until [`docs/commercial-legal-review.md`](../commercial-legal-review.md) is signed off, do not claim counsel-approved terms in paid ads.

## Color palettes

PhoneHome uses two related systems. Use the **landing/dark** palette for social video overlays, Reels, and the Cloudflare homepage. Use **green accent** for legal/trial/buy pages and Stripe.

### Landing / social (primary for IG, TikTok, YouTube)

| Token | Hex | Use |
| ----- | --- | --- |
| Background | `#07110d` | Page/video background |
| Background alt | `#0e1a15` | Panels, gradients |
| Panel | `#16241e` | Cards |
| Text | `#f4f8f6` | Headlines, body on dark |
| Muted | `#b7cfc4` | Secondary text |
| Gold | `#f0c14d` | Accent, CTAs, highlights |
| Gold light | `#f7d77a` | Hover, emphasis |

Source: [`web/storefront-pages/landing.css`](../../web/storefront-pages/landing.css)

### Storefront / Stripe / legal

| Token | Hex | Use |
| ----- | --- | --- |
| Accent green | `#1f6b4a` | Buttons, theme-color on legal pages |
| Dark green | `#14201a` | Stripe secondary |

Source: [`web/storefront-pages/storefront.css`](../../web/storefront-pages/storefront.css), [`control/scripts/configure-stripe-business.mjs`](../../control/scripts/configure-stripe-business.mjs)

## Typography

| Role | Font | Weights |
| ---- | ---- | ------- |
| Display / headlines | **Fraunces** | 560, 680; italic 560 for emphasis |
| Body | **Sora** | 400–700 |
| Code / mono | **IBM Plex Mono** | 400, 500 (legal/trial pages only) |

Google Fonts link (landing):

```
https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,560;0,9..144,680;1,9..144,560&family=Sora:wght@400..700&display=swap
```

## Logo and icon

| Asset | Path |
| ----- | ---- |
| Primary SVG (UFO + phone) | [`web/public/icon.svg`](../../web/public/icon.svg) |
| App / social profile (1024×1024) | [`web/public/icon-1024.png`](../../web/public/icon-1024.png) |
| Social / OG (512×512) | [`web/public/icon-512.png`](../../web/public/icon-512.png) |

**Wordmark:** Phone**Home** — "Phone" regular weight, "Home" emphasized (gold on dark, green accent on storefront). HTML pattern: `Phone<em>Home</em>` or `Phone<span>Home</span>`.

**Sub-brand:** Mothership (server product name under the wordmark on nav).

There is no standalone wordmark SVG — use icon + text in layouts.

## Product vocabulary

| Term | Plain English |
| ---- | ------------- |
| Mothership | The always-on server |
| Pod | One household on a Mothership |
| Circle | A parent's approved contacts for their kids |
| Leaves | Phones on the network (app or analog) |
| TreeHouse | Kid hangout voice room |
| FamilyRoom | Mixed family talk room |

Full glossary: [`docs/glossary.md`](../glossary.md)

## Imagery

- Landing photography: [`web/storefront-pages/assets/landing/`](../../web/storefront-pages/assets/landing/)
- App screenshots: [`mobile/app-store/screenshots/`](../../mobile/app-store/screenshots/), [`docs/screenshots/`](../../docs/screenshots/)
- Illustrations: `ufo.svg`, `rotary-phone.svg`, `treehouse.svg`

See [`social-assets.md`](social-assets.md) for export sizes and photo usage rights.

## Do / don't

**Do**

- Lead with privacy and parent control
- Show real UI and real house-phone setups
- Link to https://phonehome.pages.dev, TestFlight, and compare page
- Use competitor names only with trademark disclaimer (see README)

**Don't**

- Imply PSTN, 911, or carrier replacement
- Promise call recording, transcription, or location tracking
- Use tracking pixels on the storefront (privacy pillar)
- Log or display SIP passwords, SDP, or crypto in marketing screenshots
