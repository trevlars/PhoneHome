# README screenshots

Marketing and UI captures for the GitHub README.

| File | What it shows |
| --- | --- |
| `01-splash.png` | Splash — brand + kid on landline |
| `02-tutorial-your-people.png` | How it works — your people slide |
| `03-phone-pad.png` | Speed dial pad, TreeHouse / FamilyRoom |
| `04-parent-settings.png` | Parent controls panel |
| `05-activity.png` | Activity / call history |
| `06-kid-landline.jpg` | Lifestyle — kid on house phone |
| `07-invite-family.jpg` | Invite cousins (QR at the table) |
| `08-ht801-adapter.png` | Grandstream HT801 v2 product shot |

## Regenerate UI shots

```bash
npm run screenshots              # README + App Store / TestFlight frames
npm run app-store:screenshots    # App Store only (mobile/app-store/screenshots/)
```

Requires Playwright Chromium (`npx playwright install chromium` on first run). Lifestyle/product images are copied from `web/public/assets/`.
