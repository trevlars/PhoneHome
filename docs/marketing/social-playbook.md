# PhoneHome social playbook

Bios, hashtags, and posting rules for Instagram, Facebook, TikTok, YouTube, Reddit, and Discord.

## Universal bio

> The home phone, reborn. Private family calling — kids tap a face to call people you approve. No strangers. No ads. No recording. Free iPhone app + optional house phone.

**Link in bio:** https://phonehome.pages.dev  
**Profile photo:** `web/public/icon-1024.png`

## Platform bios (character limits)

### Instagram (150)

```
The home phone, reborn 🏠📞
Kids call people you approve — nobody else.
No ads · no recording · no strangers
Free iPhone app + real house phones
↓
```

### Facebook Page (255)

```
PhoneHome — the home phone, reborn. A private family calling network where kids tap a face to call Grandma, cousins, and friends you approve. No public number. No ads. No call recording. Free iPhone app; optional analog house phone. Host your own Mothership or join a family who does.
```

### TikTok (80)

```
The home phone, reborn 📞
Private family calls — kids tap a face
No strangers · no ads · link below
```

### YouTube (1000)

```
PhoneHome is the home phone, reborn — a private, encrypted calling network for kids, parents, grandparents, and friends.

Kids tap a face to call people you approve. Strangers can't ring them. Parents set Quiet Time, daily limits, and household rules. Calls are encrypted and never recorded.

Free iPhone app. Optional real house phone via a small adapter. One Mothership server hosts your extended family — you host it, or someone you trust does.

Not a carrier. Does not call regular phone numbers or 911. Keep a real emergency line.

Website: https://phonehome.pages.dev
App Store (free iPhone app): https://apps.apple.com/app/id6804245868
Downloads: https://phonehome.pages.dev/downloads.html
Releases: https://github.com/trevlars/PhoneHome/releases/latest
Source (inspect, not open source): https://github.com/trevlars/PhoneHome
```

## Hashtag sets

### Parenting / family (IG, FB, TikTok)

```
#parenting #momlife #dadlife #familytech #kidsphone #screentime #digitalparenting #grandparents #familyfirst #privacy #phonehome
```

### Self-host / tech (Reddit, optional IG)

```
#selfhosted #homelab #privacy #degoogle #familytech #sourceavailable
```

Use 5–10 hashtags per post; rotate to avoid spam flags.

## Claims — do / don't

| Do | Don't |
| -- | ----- |
| App Store, free iPhone app, private family server | "Open source" or AGPL — PhoneHome is proprietary |
| Encryption-first, no ads, no recording | PSTN, 911, or carrier replacement |
| Competitor compare with disclaimer | Promise managed-pilot features as GA |
| Honest "not emergency service" posts | Kid photos without release confirmation |

Full legal gate: [`docs/commercial-legal-review.md`](../commercial-legal-review.md)

## Posting cadence (launch month)

| Platform | Frequency | Content mix |
| -------- | --------- | ------------- |
| Instagram | 3×/week | Reels (cross-post to FB), 1 carousel/week |
| Facebook | 3×/week | Same Reels as IG |
| TikTok | 4–5×/week | Short demos, text overlays |
| Reddit r/PhoneHome | 1–2×/week mod posts | Pinned updates, answer threads |
| YouTube | 2 videos launch, then 1/month | Tutorials, founder story |
| Discord | As needed | Announcements, support |

## Engagement routing

| Channel | Route to |
| ------- | -------- |
| IG/FB/TikTok DMs | Support email or Discord `#app-help` |
| Reddit comments | Helpful reply + link when relevant |
| Discord `#setup-help` | Docs, GitHub Issues for bugs |
| Bug reports | GitHub Issues |

## Paid ads

**Wait** until counsel signs off on terms/privacy ([`docs/commercial-legal-review.md`](../commercial-legal-review.md)). Organic social is fine now.

No Meta Pixel or GA on storefront — measure via platform-native analytics only.

## Trademark line (footer of long posts)

> Tin Can, Pinwheel, Ooma, Gabb, TickTalk, Gizmo, Apple, iPhone, and other names are trademarks of their owners. PhoneHome isn't affiliated with them.

## URLs config

Update [`web/storefront-pages/community-urls.json`](../../web/storefront-pages/community-urls.json) when accounts go live.
