# PhoneHome press kit

One-pager for journalists, parent bloggers, and privacy writers.

## Boilerplate

**PhoneHome** is the home phone, reborn — a private, encrypted calling network for kids, parents, grandparents, and friends. Kids tap a face on a speed dial to call people their parents approve; strangers cannot ring them. Families run calls through their own **Mothership** server (self-hosted or trusted host), not an ad company's cloud. Free iPhone app; optional real house phone via analog adapter. **Not a carrier** — does not connect to the public phone network or 911.

**Tagline:** The home phone, reborn.

**Seller:** the operator  
**Website:** https://phonehome.pages.dev  
**License:** proprietary. Copyright © 2026 Trevor Larsen Marketing LLC.  
**Contact:** support@example.com

## Key facts

| | |
| --- | --- |
| **Price** | Host: $25/year after 30-day trial. Joiners: $0 |
| **Capacity** | Up to 50 phones per license |
| **Platforms** | iOS (TestFlight), PWA, macOS/Linux/Windows Mothership, Home Assistant, Docker |
| **Hardware** | Optional Grandstream HT801 + any RJ11 phone (~$40 ATA) |
| **Encryption** | WebRTC DTLS-SRTP (apps); SIP TLS + SRTP (house phones) |
| **Privacy** | No ads, no tracking cookies on storefront, no call recording, no transcription |

## What PhoneHome is not

- Not PSTN — cannot call regular phone numbers
- Not 911 or emergency service
- Not a kid GPS watch or smartphone replacement with open internet

## Comparison angle

Typical 3-year savings vs alternatives (one kid, house phone setup): ~$335 vs Ooma, ~$400 vs Tin Can, ~$680 vs kid watch, ~$940 vs Pinwheel. Full table: https://phonehome.pages.dev/compare.html

## Quotes (approved for organic use)

> "Family calls stay private — safety, not selling data." — [`docs/privacy-security.md`](../privacy-security.md)

> "The home phone, reborn." — product tagline

## Assets

| Asset | Path / URL |
| ----- | ---------- |
| Logo (SVG) | https://phonehome.pages.dev/icon.svg |
| Logo (PNG 512) | https://phonehome.pages.dev/icon-512.png |
| Hero photo | https://phonehome.pages.dev/assets/landing/kid-landline.jpg |
| App screenshots | [`mobile/app-store/screenshots/`](../../mobile/app-store/screenshots/) |
| Brand guide | [`docs/marketing/brand-guide.md`](brand-guide.md) |

## Founder

Add the publisher's name and a two-sentence bio here before sending this kit. Do not commit a home address, a private hostname, or a family member's name.

## Interview topics

- Why self-hosted beats centralized kid-phone clouds for breach exposure
- Allowlist-only calling and mutual approval between families
- Analog house phones on a modern encrypted network
- Parent controls without surveillance (activity metadata, not call content)
- Self-hosted Mothership and the host-license model

## Legal note

Terms, privacy, and refund pages are engineering drafts pending counsel review. Do not describe them as counsel-approved in paid advertising. Organic editorial use of public policy URLs is fine.

## Trademark

Tin Can, Pinwheel, Ooma, Gabb, TickTalk, Gizmo, Apple, iPhone, Home Assistant, Grandstream, and other names are trademarks of their respective owners. PhoneHome is not affiliated with them.

## Community

- Reddit: r/PhoneHome
- Discord: https://discord.gg/QWmCcnJn2Q
- GitHub Discussions: https://github.com/trevlars/PhoneHome/discussions

## Outreach email template

```
Subject: PhoneHome — private family calling (press / review)

Hi [Name],

PhoneHome is a private family phone network — kids tap a face to call people parents approve, on a server the family hosts or trusts. No ads, no recording, no strangers. Free iPhone app; optional house phone.

Press kit: https://phonehome.pages.dev/press.html
Compare & pricing: https://phonehome.pages.dev/compare.html

Happy to send a TestFlight invite or answer questions.

Cameron East
support@example.com
https://phonehome.pages.dev
```
