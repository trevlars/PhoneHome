# Managed Mothership paid pilot

Use this runbook for 3–5 invite-only operators before public signup. Each pilot
gets an isolated VPS and must include at least two households and one HT801.

## Entry gate

- Operator has accepted the reviewed Terms and privacy disclosures.
- Stripe test-clock scenarios passed, then the operator completed a live
  subscription Checkout.
- Provisioning webhook created the VPS and returned its HTTPS URL.
- Backup repository, uptime checks, and support contact are active.
- No public UDP 5060; SIP TLS, SRTP, HTTPS, and TURN checks pass.
- iPhone build is the App Store/TestFlight production build with production APNs.

## Per-pilot matrix

Record pass/fail, timestamp, networks, device versions, and ticket links. Never
record audio, SDP, push tokens, SIP passwords, or family call content.

| Scenario | Required |
| --- | --- |
| iPhone → iPhone, both foreground | Pass |
| iPhone → killed iPhone via PushKit/CallKit | Pass |
| Wi-Fi ↔ cellular and two unrelated home networks | Pass |
| HT801 → iPhone and iPhone → HT801 | Pass |
| HT801 → HT801 | Pass |
| Hold/resume and either side hangs up | Pass |
| Busy, missed call, voicemail, Quiet Time, Timeout | Pass |
| Circle isolation negative tests | Pass |
| TURN relay forced | Pass |
| Hub/bridge restart and recovery | Pass |
| Encrypted backup restored to a fresh VPS | Pass |
| Subscription payment failure → grace → recovery | Pass |
| Cancellation export and credential revocation | Pass |

## Success criteria

- Seven consecutive days without an unresolved privacy, authentication,
  missed-wake, one-way-audio, or analog-registration incident.
- At least 95% of attempted allowed calls ring the intended endpoint.
- Every failed call has an operator-visible diagnostic that contains no secret
  or call content.
- Backup age stays below 26 hours and a fresh-VPS restore is demonstrated.
- Operator can onboard another Pod and an HT801 without maintainer shell access.

## Stop conditions

Pause all new pilot onboarding for:

- any cross-Circle visibility or calling leak;
- distribution of Apple, SIP, TURN, or tenant credentials;
- cleartext public SIP/RTP;
- repeated killed-app wake failure;
- unrecoverable backup, billing duplication, or tenant crossover.

Existing family calls remain available while the incident is contained unless
continuing would expose another family’s data.
