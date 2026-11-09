# Native Android softphone

PhoneHome on Android is the same Capacitor shell as iOS: the web softphone, plus system incoming/outgoing call UI, push wake, and biometric sign-in.

| Piece | Role |
| --- | --- |
| `mobile/android` | Capacitor app. `applicationId` is `app.phonehome.android`. Java package stays `app.phonehome.ios` so the shared Capacitor `appId` is not rewritten. |
| `mobile/plugins/phonehome-callkit/android` | Same JS plugin name (`PhoneHomeCallKit`). Telecom `ConnectionService` + call-style notification. |
| WebView | Signaling stays in the WebView. Answered-call audio is in-process WebRTC (DTLS-SRTP), so it survives the WebView being frozen. |
| Server | `POST /api/devices/fcm-token`. Data-only FCM. No SDP in the push. |

Minimum Android is 8 (API 26). There is no Play listing yet. Until one exists, install a debug build.

## Build

JDK 21 and the Android SDK command-line tools are required. Capacitor 7 compiles with Java 21.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
npm run build -w web
cd mobile && npm install && npx cap sync android
cd android && ./gradlew assembleDebug
```

Debug APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

`mobile/android/local.properties` (`sdk.dir`) is gitignored.

## Push

FCM is off until both sides have credentials.

1. Put `google-services.json` in `mobile/android/app/` (gitignored). Rebuild. Without that file the app still launches; `FirebaseInitProvider` is removed so a missing config does not crash startup.
2. On the mothership, set `FCM_SERVICE_ACCOUNT_JSON` to a path or the raw service-account JSON. Optional `FCM_PROJECT_ID` overrides `project_id`.

Wake and voicemail pushes are data-only (`android.priority = HIGH`). The app draws the full-screen incoming UI. Tokens are stored as platform `android` in `push_devices.voip_token` and are not lowercased. Dead tokens (`UNREGISTERED`, `NOT_FOUND`, `INVALID_ARGUMENT`) are deleted. Logs keep only the token suffix.

Managed motherships do not receive the Firebase service account in this version. Unset env means FCM no-ops, same as APNs without a key.

Full-screen incoming intents can be revoked by the user on Android 14+. Each cold start asks again until they are allowed. The call notification still shows if they stay denied. Android 12+ also asks the system Phone app to show the incoming call and to log it in Recents (`EXTRA_ADD_SELF_MANAGED_CALLS_TO_INCALLSERVICE`, `EXTRA_LOG_SELF_MANAGED_CALLS`).

A user force-stop blocks the next FCM until the app is opened again. That is an Android lock. Unrestricted battery use only stops Doze from delaying push. It does not undo force-stop.

## What matches iOS

- Mothership HTTPS URL, `phonehome://connect?url=https…` invites, onboarding and migrate transfer on device.
- Biometric sign-in (strong biometrics or device credential) with credentials in encrypted storage. Backup is off.
- Home-screen badge via a silent notification with `setNumber` and `setShowBadge`. Launchers that support a count show it. Pixel shows a dot.
- Speaker vs earpiece during a call (`MODE_IN_COMMUNICATION`).
- In-app purchase links stay available. The iOS App Store storefront gate does not apply.

## What stays different

- Android has one FCM token. It carries both incoming-call and voicemail data messages. There is no second push transport like PushKit plus alert APNs.
- There is no Play listing yet. Install a debug build until a Play Console app exists.
- Force-stop still blocks the next push. No app can override that.
