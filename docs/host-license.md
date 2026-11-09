# Host license (self-hosted Mothership)

PhoneHome’s commercial model for **operators who run their own Mothership**:

- **30-day free trial** (full features from first mothership start)
- **$25/year** signed host license after trial ($20 first year with promo **OWNMS5**)
- **Free iOS / PWA** app (no IAP for the Mothership)
- **You** run the box (HAOS add-on, Docker, or compose) — PhoneHome does not host family databases
- Shared **APNs** push gateway is product plumbing on PhoneHome’s VPS (not a separate SKU)

Optional Circle billing (siblings → operator) stays off Stripe; PhoneHome takes no cut.

## Vs Tin Can, watches, and locked phones

PhoneHome is the **home phone reborn** on hardware you already choose — not a proprietary kid gadget with a monthly meter.

| | PhoneHome | Tin Can | Gabb / TickTalk / Gizmo-class |
| --- | --- | --- | --- |
| Kid endpoint | Softphone free, or ~$40 HT801 + any RJ11 analog (vintage, thrift, cordless) | ~$135 proprietary Wi‑Fi Can | ~$130–$180 brand watch / locked phone |
| Network fee | **$25/year** host license for the whole family mesh ($20 yr-1 with OWNMS5) | Can↔Can free; Party Line **$9.99/mo** (~$100–$120/yr) for regular numbers | Often **$10–$25+/mo** per device |
| Who hosts | Your HAOS / NAS / PC | Tin Can cloud | Carrier + brand cloud |
| Lock-in | None — any analog + ATA or softphone | Must use Tin Can handset | Brand device + often brand SIM |
| Outside PSTN / bundled 911 | Not Stage 1 — private mesh; HT801 e911 needs BYO trunk | Party Line / their stack | Carrier 911 on the wearable |

**Year-1 analog kid path ≈ $75–$105** (ATA + thrift/vintage handset + first license year at list), then ~$25/yr software. Softphone-only households skip the kit. With OWNMS5, year one is $5 less.

**Tin Can year-1** for calling regular phones is often ~$235–$255 (device + Party Line). Two kids = two Cans; PhoneHome stays one license.

Market the **full stack and the freedom**, not “just $25.” Link storefront compare: `/compare.html`.

## Trial → pay → renew

1. Download trial from the site (`/trial`) or HAOS trial add-on.
2. Clock starts on **first mothership start** (30 days).
3. Buy at `/buy` (Stripe Checkout, $25/year) → paste signed license in mothership / HA options.
4. Same local checker for trial and paid: `expires_at` in the future → run; else **locked mode** (calls blocked; admin can paste a new license).
5. Optional ~30-day **grace** after a paid year expires before hard lock.
6. Renew issues a new signed license (extend from payment or previous expiry).

Proprietary. A host license is permission to run one Mothership. It is not a license to the source. Easy install and updates are what the license funds.

## Spinoff promo + host referral

- **Guest:** promo **`OWNMS5`** — $5 off once (first year **$20** from $25 list). Applied automatically when checkout sends `source=spinoff` or a valid `ref`, or when the buyer enters the code. Create with `control/scripts/create-host-license-coupon.mjs`.
- **Referrer:** each paid host gets a shareable code (in signed license `ref` claim + buy-success page + operator Parent panel). When someone completes host-license checkout with that `ref`, control credits the referrer’s Stripe customer balance by **$3** (`HOST_LICENSE_REFERRAL_CREDIT_CENTS=300`) toward the next invoice. No self-referral; one credit per referred instance.
- Checkout body: `{ email, instanceId, promoCode?, referralCode?, source? }`.
- Product metadata: `GET /v1/host-license/product` includes `spinoff_promo`, `spinoff_first_year_usd`, `referral_credit_usd`.
- Lookup: `GET /v1/host-license/referral?instanceId=` or `?code=`.

In-app: **Parent → Start your own Mothership** (all parents); operators also see **Your referral code** under Parent → Mothership (from signed license `ref`, or `GET /v1/host-license/referral?instanceId=` for licenses issued before referral codes). Ops: `POST /v1/admin/host-license/backfill-referrals` creates missing codes. Details: [`migrate-mothership.md`](./migrate-mothership.md).

## App Store

The iOS app stays free. When the mothership reports `locked` / trial ended, show **status + Safari link** to the website. Do not sell the host license via IAP inside the app (free companion / external server pattern).

## One license per mothership

A license is bound to one mothership instance id (generated on first boot). Moving to new hardware: re-issue or transfer via support policy (document: one active instance per subscription).

## Stripe (control plane)

- Price: `STRIPE_PRICE_HOST_ANNUAL` ($25/year)
- Signing: `HOST_LICENSE_PRIVATE_KEY` on control; motherships verify with `HOST_LICENSE_PUBLIC_KEY`
- Checkout: `POST /v1/host-license/checkout` `{ email, instanceId, promoCode?, referralCode?, source? }`
- Success page can fetch `GET /v1/host-license/session/:sessionId` for the blob (+ `referral_code`)
- Renewal (`invoice.paid` after the first year) issues a new signed blob extending `expires_at`
- Env: `HOST_LICENSE_SPINOFF_PROMO=OWNMS5`, `HOST_LICENSE_REFERRAL_CREDIT_CENTS=300`

Storefront pages in-repo: `web/src/trial.html`, `buy.html`, `downloads.html`, `buy-success.html`, `terms.html`, `refund.html` (also mirrored under `web/storefront-pages/` for Cloudflare Pages). Production alias `phonehome.pages.dev` tracks the Pages **`main`** branch — deploy with:

`npx wrangler pages deploy web/storefront-pages --project-name=phonehome --branch=main`

## HAOS

Add-on under [`haos/phonehome/`](../haos/phonehome/) — paste license in add-on options (`host_license`). Analog networking caveats are documented there.

## Related

- [`managed-mothership.md`](./managed-mothership.md) — optional managed-VPS path (not the primary SKU)
- [`family-mesh.md`](./family-mesh.md) — invites; mothership peering for split households
- [`migrate-mothership.md`](./migrate-mothership.md) — leave a friend’s mothership and host your own
