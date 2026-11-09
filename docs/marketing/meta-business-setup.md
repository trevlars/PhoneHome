# Meta Business setup — Instagram + Facebook

Step-by-step for the operator. One Meta Business account powers both Facebook Page and Instagram Business.

## Prerequisites

- Business name: **the operator**
- Profile photo: [`web/public/icon-1024.png`](../../web/public/icon-1024.png)
- Bio copy: [`social-playbook.md`](social-playbook.md)
- Website: https://phonehome.pages.dev

## 1. Create Meta Business account

1. Go to [business.facebook.com](https://business.facebook.com)
2. **Create account** → business name: the operator
3. Add your name and business email
4. Verify email if prompted

## 2. Create Facebook Page

1. Meta Business Suite → **All tools** → **Pages** → **Create**
2. Name: **PhoneHome**
3. Category: **Technology company** or **Software**
4. Bio: paste Facebook Page bio from [`social-playbook.md`](social-playbook.md)
5. Website: `https://phonehome.pages.dev`
6. Profile picture: `icon-1024.png`
7. Cover photo: 820×312 banner (see [`social-assets.md`](social-assets.md))

## 3. Connect Instagram Business

1. Create Instagram account or convert existing to Business
2. Handle: try `@phonehome`, then `@phonehomeapp`, then `@phonehomefamily`
3. Meta Business Suite → **Settings** → **Accounts** → **Instagram accounts** → **Connect**
4. Link to PhoneHome Facebook Page
5. Bio + link: see [`social-playbook.md`](social-playbook.md)
6. Profile photo: same `icon-1024.png`

## 4. Meta Business Suite basics

- **Planner:** schedule IG + FB posts (optional; manual posting is fine for launch)
- **Inbox:** IG/FB DMs in one place — route to support email or Discord
- **Insights:** reach, profile visits, link clicks (no storefront pixel needed)

## 5. Cross-posting Reels

1. Create Reel in Instagram app or upload via Meta Suite
2. Enable **Share to Facebook** when publishing
3. Same video works for TikTok (upload separately — no auto-cross-post)

## 6. Update repo URLs

Edit [`web/storefront-pages/community-urls.json`](../../web/storefront-pages/community-urls.json):

```json
"instagram": "https://instagram.com/YOUR_HANDLE",
"facebook": "https://facebook.com/YOUR_PAGE"
```

Redeploy storefront: `npx wrangler pages deploy web/storefront-pages --project-name=phonehome --branch=main`

## 7. Security

- Enable 2FA on Facebook and Instagram
- Limit Page roles to people who need them
- Do not share Meta Business login in Discord or public channels

## Paid ads (later)

Wait for counsel sign-off on [`docs/commercial-legal-review.md`](../commercial-legal-review.md) before running conversion ads.
