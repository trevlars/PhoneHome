# Account setup checklist (Cameron)

Human-only steps to complete PhoneHome's marketing and community presence. Repo docs and storefront wiring are ready — update URLs when each account exists.

## Handle priority

Try in order on each platform: `@phonehome` → `@phonehomeapp` → `@phonehomefamily`

## Checklist

| # | Task | Guide | Done |
| - | ---- | ----- | ---- |
| 1 | Meta Business account (the operator) | [`meta-business-setup.md`](meta-business-setup.md) | [ ] |
| 2 | Facebook Page — PhoneHome | meta-business-setup | [ ] |
| 3 | Instagram Business linked to Page | meta-business-setup | [ ] |
| 4 | TikTok business/creator account | [`social-playbook.md`](social-playbook.md) | [ ] |
| 5 | YouTube channel — PhoneHome | social-playbook | [ ] |
| 6 | Reddit subreddit r/PhoneHome + 3 pinned posts | [`reddit-discord-setup.md`](reddit-discord-setup.md) | [ ] |
| 7 | Discord server + Community + public invite | reddit-discord-setup | [x] |
| 8 | Enable 2FA on Meta, Reddit, Discord | — | [ ] |
| 9 | Update `web/storefront-pages/community-urls.json` with real URLs | — | [ ] |
| 10 | Redeploy storefront | `npx wrangler pages deploy web/storefront-pages --project-name=phonehome --branch=main` | [ ] |
| 11 | Film 8 launch videos | [`video-scripts.md`](video-scripts.md) | [ ] |
| 12 | Confirm kid-landline.jpg rights for social | [`social-assets.md`](social-assets.md) | [ ] |
| 13 | App Store privacy labels in ASC UI | [`mobile/app-store/app-privacy-answers.md`](../../mobile/app-store/app-privacy-answers.md) | [ ] |
| 14 | Submit for Review (App Store) | [`docs/app-store-go-live.md`](../app-store-go-live.md) | [ ] |

## URLs to send back

After creating accounts, fill in and commit `community-urls.json`:

```json
{
  "instagram": "https://instagram.com/…",
  "facebook": "https://facebook.com/…",
  "tiktok": "https://tiktok.com/@…",
  "youtube": "https://youtube.com/@…",
  "reddit": "https://reddit.com/r/PhoneHome",
  "discord": "https://discord.gg/…",
  "github": "https://github.com/trevlars/PhoneHome",
  "discussions": "https://github.com/trevlars/PhoneHome/discussions"
}
```

Empty strings hide a platform from the storefront footer until the URL is set.
