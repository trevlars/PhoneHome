# phonehome-callkit

CallKit + PushKit for PhoneHome softphone

## Install

To use npm

```bash
npm install phonehome-callkit
````

To use yarn

```bash
yarn add phonehome-callkit
```

Sync native files

```bash
npx cap sync
```

## API

<docgen-index>

* [`registerVoIP()`](#registervoip)
* [`registerAlertPush()`](#registeralertpush)
* [`setCallKitEnabled(...)`](#setcallkitenabled)
* [`isCallKitEnabled()`](#iscallkitenabled)
* [`reportIncoming(...)`](#reportincoming)
* [`startOutgoing(...)`](#startoutgoing)
* [`endCall(...)`](#endcall)
* [`setConnected(...)`](#setconnected)
* [`setSpeaker(...)`](#setspeaker)
* [`getCallState()`](#getcallstate)
* [`requestBadgePermission()`](#requestbadgepermission)
* [`setBadge(...)`](#setbadge)
* [`clearBadge()`](#clearbadge)
* [`saveLogin(...)`](#savelogin)
* [`hasSavedLogin()`](#hassavedlogin)
* [`getLogin(...)`](#getlogin)
* [`clearLogin()`](#clearlogin)
* [`saveSession(...)`](#savesession)
* [`getSession()`](#getsession)
* [`clearSession()`](#clearsession)
* [`addListener('voipToken' | 'voipTokenInvalid' | 'apnsToken' | 'apnsTokenInvalid' | 'incomingPush' | 'incomingAlert' | 'callAnswered' | 'callEnded' | 'callStarted' | 'audioActivated' | 'audioDeactivated', ...)`](#addlistenervoiptoken--voiptokeninvalid--apnstoken--apnstokeninvalid--incomingpush--incomingalert--callanswered--callended--callstarted--audioactivated--audiodeactivated-)
* [Interfaces](#interfaces)
* [Type Aliases](#type-aliases)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

### registerVoIP()

```typescript
registerVoIP() => Promise<void>
```

Start PushKit VoIP registration; listen for `voipToken`.
No-op when CallKit is disabled (default) — Apple requires CallKit on every VoIP push.

--------------------


### registerAlertPush()

```typescript
registerAlertPush() => Promise<{ granted: boolean; }>
```

Request alert/sound/badge permission and register for standard APNs.
Preferred path when CallKit is tabled — tap opens in-app softphone UI.

**Returns:** <code>Promise&lt;{ granted: boolean; }&gt;</code>

--------------------


### setCallKitEnabled(...)

```typescript
setCallKitEnabled(options: SetCallKitEnabledOptions) => Promise<{ enabled: boolean; }>
```

Persist CallKit feature flag (UserDefaults `kl_callkit`). Default remains off.

| Param         | Type                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| **`options`** | <code><a href="#setcallkitenabledoptions">SetCallKitEnabledOptions</a></code> |

**Returns:** <code>Promise&lt;{ enabled: boolean; }&gt;</code>

--------------------


### isCallKitEnabled()

```typescript
isCallKitEnabled() => Promise<{ enabled: boolean; }>
```

**Returns:** <code>Promise&lt;{ enabled: boolean; }&gt;</code>

--------------------


### reportIncoming(...)

```typescript
reportIncoming(options: ReportIncomingOptions) => Promise<void>
```

Locally report an incoming CallKit call (also used after push). No-op if CallKit off.

| Param         | Type                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| **`options`** | <code><a href="#reportincomingoptions">ReportIncomingOptions</a></code> |

--------------------


### startOutgoing(...)

```typescript
startOutgoing(options: StartOutgoingOptions) => Promise<{ callId: string; }>
```

System outgoing CallKit UI. No-op if CallKit off.

| Param         | Type                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **`options`** | <code><a href="#startoutgoingoptions">StartOutgoingOptions</a></code> |

**Returns:** <code>Promise&lt;{ callId: string; }&gt;</code>

--------------------


### endCall(...)

```typescript
endCall(options?: { callId?: string | undefined; } | undefined) => Promise<void>
```

| Param         | Type                              |
| ------------- | --------------------------------- |
| **`options`** | <code>{ callId?: string; }</code> |

--------------------


### setConnected(...)

```typescript
setConnected(options?: { callId?: string | undefined; } | undefined) => Promise<void>
```

| Param         | Type                              |
| ------------- | --------------------------------- |
| **`options`** | <code>{ callId?: string; }</code> |

--------------------


### setSpeaker(...)

```typescript
setSpeaker(options: SetSpeakerOptions) => Promise<{ enabled: boolean; }>
```

Route call audio to loudspeaker (`enabled: true`) or earpiece (`false`).
Also toggles proximity monitoring (on for earpiece, off for speaker).

| Param         | Type                                                            |
| ------------- | --------------------------------------------------------------- |
| **`options`** | <code><a href="#setspeakeroptions">SetSpeakerOptions</a></code> |

**Returns:** <code>Promise&lt;{ enabled: boolean; }&gt;</code>

--------------------


### getCallState()

```typescript
getCallState() => Promise<{ answered: boolean; audioActive: boolean; speakerOn?: boolean; ringing?: boolean; systemHasCall?: boolean; callUUID?: string; callId?: string; }>
```

Snapshot of native CallKit / audio session — used when JS missed
callAnswered/audioActivated (lock-screen race / cold WebView).

**Returns:** <code>Promise&lt;{ answered: boolean; audioActive: boolean; speakerOn?: boolean; ringing?: boolean; systemHasCall?: boolean; callUUID?: string; callId?: string; }&gt;</code>

--------------------


### requestBadgePermission()

```typescript
requestBadgePermission() => Promise<{ granted: boolean; }>
```

Request badge authorization (UNUserNotificationCenter `.badge`).
Safe to call repeatedly; returns whether badge permission is granted.

**Returns:** <code>Promise&lt;{ granted: boolean; }&gt;</code>

--------------------


### setBadge(...)

```typescript
setBadge(options: SetBadgeOptions) => Promise<void>
```

Set or clear the iOS home-screen app icon badge.

| Param         | Type                                                        |
| ------------- | ----------------------------------------------------------- |
| **`options`** | <code><a href="#setbadgeoptions">SetBadgeOptions</a></code> |

--------------------


### clearBadge()

```typescript
clearBadge() => Promise<void>
```

Convenience: setBadge({ count: 0 }).

--------------------


### saveLogin(...)

```typescript
saveLogin(options: { username: string; password: string; }) => Promise<{ saved: boolean; }>
```

Store username + password in the iOS Keychain (this device only).

| Param         | Type                                                 |
| ------------- | ---------------------------------------------------- |
| **`options`** | <code>{ username: string; password: string; }</code> |

**Returns:** <code>Promise&lt;{ saved: boolean; }&gt;</code>

--------------------


### hasSavedLogin()

```typescript
hasSavedLogin() => Promise<{ saved: boolean; username: string; biometry: string; }>
```

**Returns:** <code>Promise&lt;{ saved: boolean; username: string; biometry: string; }&gt;</code>

--------------------


### getLogin(...)

```typescript
getLogin(options?: { reason?: string | undefined; } | undefined) => Promise<{ username: string; password: string; }>
```

Face ID / Touch ID, then return the Keychain password. Never log the result.

| Param         | Type                              |
| ------------- | --------------------------------- |
| **`options`** | <code>{ reason?: string; }</code> |

**Returns:** <code>Promise&lt;{ username: string; password: string; }&gt;</code>

--------------------


### clearLogin()

```typescript
clearLogin() => Promise<{ cleared: boolean; }>
```

**Returns:** <code>Promise&lt;{ cleared: boolean; }&gt;</code>

--------------------


### saveSession(...)

```typescript
saveSession(options: { sessionId: string; }) => Promise<{ saved: boolean; }>
```

Persist the hub session token in Keychain so WKWebView localStorage wipes don't log you out.

| Param         | Type                                |
| ------------- | ----------------------------------- |
| **`options`** | <code>{ sessionId: string; }</code> |

**Returns:** <code>Promise&lt;{ saved: boolean; }&gt;</code>

--------------------


### getSession()

```typescript
getSession() => Promise<{ sessionId: string; }>
```

**Returns:** <code>Promise&lt;{ sessionId: string; }&gt;</code>

--------------------


### clearSession()

```typescript
clearSession() => Promise<{ cleared: boolean; }>
```

**Returns:** <code>Promise&lt;{ cleared: boolean; }&gt;</code>

--------------------


### addListener('voipToken' | 'voipTokenInvalid' | 'apnsToken' | 'apnsTokenInvalid' | 'incomingPush' | 'incomingAlert' | 'callAnswered' | 'callEnded' | 'callStarted' | 'audioActivated' | 'audioDeactivated', ...)

```typescript
addListener(eventName: "voipToken" | "voipTokenInvalid" | "apnsToken" | "apnsTokenInvalid" | "incomingPush" | "incomingAlert" | "callAnswered" | "callEnded" | "callStarted" | "audioActivated" | "audioDeactivated", listenerFunc: (event: Record<string, unknown>) => void) => Promise<{ remove: () => Promise<void>; }>
```

| Param              | Type                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`eventName`**    | <code>'voipToken' \| 'voipTokenInvalid' \| 'apnsToken' \| 'apnsTokenInvalid' \| 'incomingPush' \| 'incomingAlert' \| 'callAnswered' \| 'callEnded' \| 'callStarted' \| 'audioActivated' \| 'audioDeactivated'</code> |
| **`listenerFunc`** | <code>(event: <a href="#record">Record</a>&lt;string, unknown&gt;) =&gt; void</code>                                                                                                                                 |

**Returns:** <code>Promise&lt;{ remove: () =&gt; Promise&lt;void&gt;; }&gt;</code>

--------------------


### Interfaces


#### SetCallKitEnabledOptions

| Prop          | Type                 | Description                                                   |
| ------------- | -------------------- | ------------------------------------------------------------- |
| **`enabled`** | <code>boolean</code> | When false (default), no system CallKit UI / no PushKit VoIP. |


#### ReportIncomingOptions

| Prop             | Type                | Description                                |
| ---------------- | ------------------- | ------------------------------------------ |
| **`callId`**     | <code>string</code> |                                            |
| **`handle`**     | <code>string</code> | Generic CallKit handle (line id or label). |
| **`callerName`** | <code>string</code> |                                            |


#### StartOutgoingOptions

| Prop         | Type                |
| ------------ | ------------------- |
| **`callId`** | <code>string</code> |
| **`handle`** | <code>string</code> |


#### SetSpeakerOptions

| Prop          | Type                 | Description                                             |
| ------------- | -------------------- | ------------------------------------------------------- |
| **`enabled`** | <code>boolean</code> | true = loudspeaker; false = earpiece (default for 1:1). |


#### SetBadgeOptions

| Prop        | Type                | Description                              |
| ----------- | ------------------- | ---------------------------------------- |
| **`count`** | <code>number</code> | Home-screen icon badge count (0 clears). |


### Type Aliases


#### Record

Construct a type with a set of properties K of type T

<code>{ [P in K]: T; }</code>

</docgen-api>
