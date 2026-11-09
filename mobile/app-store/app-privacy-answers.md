# App Store Connect App Privacy answers

Use this as the source of truth when completing the App Privacy form. Recheck
against the production deployment before every release.

## Tracking

- Data used to track users: **No**
- Third-party advertising: **No**
- Advertising/analytics SDKs: **None**

## Data linked to the user

Declare these for **App Functionality** only:

| App Privacy category | PhoneHome use |
| --- | --- |
| User ID | Mothership account and line identifiers |
| Device ID | APNs/PushKit device token used to deliver calls |
| Product Interaction | Call status/activity metadata and parent-control actions |
| Audio Data | User-created voicemail stored on the selected Mothership |
| Other User Content | Display names, family/Pod names, approved contacts, greetings |

The selected Mothership—not Apple and not an advertising network—stores this
data. For managed customers PhoneHome operates that tenant infrastructure, so
the conservative disclosure is that the developer collects it and links it to
the account for App Functionality.

## Not collected

- Precise or coarse location
- Contacts from the iOS address book
- Browsing or search history
- Purchases inside the iOS app
- Health, fitness, financial, or sensitive-trait data
- Advertising data
- Call audio (other than a voicemail the user deliberately records)
- Crash/diagnostic analytics sent to PhoneHome

## Verification before submission

- Confirm the production app contains no newly added analytics/crash SDK.
- Confirm push payloads contain wake/display metadata only, never SDP or media.
- Confirm privacy policy describes self-hosted and managed Mothership roles.
- Confirm account deletion removes linked account/line data and saved media.
- Complete the App Store Connect form manually; this repository document does
  not change the live App Privacy answers by itself.
