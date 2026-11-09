# Commercial legal review gate

This is an engineering checklist, not legal advice. Public paid signup remains
blocked until qualified counsel approves the final customer-facing documents
and child-privacy flow.

## Required documents

- Managed Mothership Terms of Service
- Privacy Policy covering PhoneHome as managed service provider
- COPPA parental notice/consent and deletion process
- Data Processing Addendum where applicable
- Acceptable Use Policy
- Subscription renewal, cancellation, refund, and failed-payment/grace policy
- Security and incident-notification commitments
- Operator/PhoneHome support responsibility split

## Required statements

- The iOS/PWA client is free; the subscription pays for managed Mothership
  infrastructure and support.
- Circle payments are directly between an operator and relatives. PhoneHome
  does not process them or take a percentage.
- PhoneHome Stage 1 does not connect to PSTN and cannot place 911 or other
  emergency calls. It is not a replacement for emergency-capable telephone
  service.
- Parents/guardians create and control child accounts and approved contacts.
- No call recording, transcription, advertising, or call-content analytics.
- What the Mothership operator can access versus what central PhoneHome services
  can access.
- Retention, export, deletion, backup expiry, and account cancellation timing.

## App Store review alignment

Counsel-approved language must remain consistent with App Store review notes,
privacy nutrition labels, `privacy.html`, and the actual data flow:

- Mothership: family accounts, contacts, call metadata, voicemail, device tokens.
- Push gateway: transient device token and minimal wake metadata.
- Control plane: operator email, Stripe/customer/subscription identifiers,
  instance status, and entitlements.
- Stripe and Apple receive only the data required for their respective services.

Do not enable public paid signup or describe these documents as approved until
the reviewer and approval date are recorded here.

## Draft customer pages (engineering)

Storefront drafts pending counsel approval (do not claim “counsel-approved” in ads):

- [`web/src/terms.html`](../web/src/terms.html) → https://phonehome.pages.dev/terms.html
- [`web/src/refund.html`](../web/src/refund.html) → https://phonehome.pages.dev/refund.html
- [`web/src/privacy.html`](../web/src/privacy.html) (indexable)
- Support contact: `support@example.com` (also Stripe business support email)

## Approval record

- Reviewer:
- Jurisdiction/scope:
- Approval date:
- Document versions: terms/refund/privacy drafts dated 2026-09-27 (engineering)
- Follow-up date:
