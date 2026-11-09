# App Store privacy labels — ASC UI walkthrough

Complete this in [App Store Connect](https://appstoreconnect.apple.com) before **Submit for Review**. Source of truth: [`mobile/app-store/app-privacy-answers.md`](../../mobile/app-store/app-privacy-answers.md).

Social launch can use TestFlight now; App Store link needs approval after this step.

## Steps

1. App Store Connect → **Apps** → **PhoneHome: Family Calling** → **App Privacy**
2. **Get Started** or **Edit** if partially filled
3. **Do you or your third-party partners collect data from this app?** → **Yes**
4. For each category below, select **Yes**, then purpose **App Functionality** only, linked to user **Yes**:

| Category | Collected | Purpose |
| -------- | --------- | ------- |
| User ID | Yes | App Functionality |
| Device ID | Yes | App Functionality |
| Product Interaction | Yes | App Functionality |
| Audio Data | Yes | App Functionality (voicemail user records) |
| Other User Content | Yes | App Functionality (names, contacts, greetings) |

5. **Not collected** (confirm each is No): Location, Contacts (address book), Browsing History, Purchases, Financial Info, Health, Sensitive Info, Advertising Data, Crash Data, Performance Data, Other Diagnostic Data

6. **Tracking** → No — data is not used for tracking

7. **Publish** privacy responses

## After labels

```bash
cd mobile
./scripts/asc-upload.sh submit_appstore   # when hub is 24/7 and you're ready
```

Or ask an agent to run `submit_appstore` after you confirm labels are published.

## Review readiness

- [ ] Mothership HTTPS 24/7 during review (`https://mothership.example:8443` or production hub)
- [ ] App Privacy labels published (this doc)
- [ ] Demo user `test` works in ASC review notes

Full checklist: [`docs/app-store-go-live.md`](../app-store-go-live.md)
