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
* [`setHeld(...)`](#setheld)
* [`setRemoteHeld(...)`](#setremoteheld)
* [`setNativeMuted(...)`](#setnativemuted)
* [`getCallState()`](#getcallstate)
* [`consumePendingOutgoing()`](#consumependingoutgoing)
* [`setNativeRemoteOffer(...)`](#setnativeremoteoffer)
* [`addNativeIceCandidate(...)`](#addnativeicecandidate)
* [`endNativeCall()`](#endnativecall)
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
* [`readClipboard()`](#readclipboard)
* [`getStorefront()`](#getstorefront)
* [`clipboardHasUrl()`](#clipboardhasurl)
* [`openInAppBrowser(...)`](#openinappbrowser)
* [`consumeInviteLink()`](#consumeinvitelink)
* [`getMothershipUrl()`](#getmothershipurl)
* [`setMothershipUrl(...)`](#setmothershipurl)
* [`clearMothershipUrl(...)`](#clearmothershipurl)
* [`hideLaunchCover()`](#hidelaunchcover)
* [`getOnboarding()`](#getonboarding)
* [`setOnboarding(...)`](#setonboarding)
* [`getMigrateTransfer()`](#getmigratetransfer)
* [`setMigrateTransfer(...)`](#setmigratetransfer)
* [`clearMigrateTransfer()`](#clearmigratetransfer)
* [`addListener('voipToken' | 'voipTokenInvalid' | 'inviteLink' | 'apnsToken' | 'apnsTokenInvalid' | 'incomingPush' | 'incomingAlert' | 'callAnswered' | 'callEnded' | 'nativeRemoteEnded' | 'callStarted' | 'callConnected' | 'callHeld' | 'audioActivated' | 'audioDeactivated' | 'nativeLocalAnswer' | 'nativeIceCandidate' | 'nativeConnectionState' | 'nativeMediaStat', ...)`](#addlistenervoiptoken--voiptokeninvalid--invitelink--apnstoken--apnstokeninvalid--incomingpush--incomingalert--callanswered--callended--nativeremoteended--callstarted--callconnected--callheld--audioactivated--audiodeactivated--nativelocalanswer--nativeicecandidate--nativeconnectionstate--nativemediastat-)
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

Persist CallKit flag (always on — disable is ignored).

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
setConnected(options?: { callId?: string | undefined; connectedAtMs?: number | undefined; } | undefined) => Promise<{ connectedAtMs?: number; }>
```

| Param         | Type                                                      |
| ------------- | --------------------------------------------------------- |
| **`options`** | <code>{ callId?: string; connectedAtMs?: number; }</code> |

**Returns:** <code>Promise&lt;{ connectedAtMs?: number; }&gt;</code>

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


### setHeld(...)

```typescript
setHeld(options: SetHeldOptions) => Promise<{ onHold: boolean; }>
```

Request a local/system CallKit Hold or Resume transaction.

| Param         | Type                                                      |
| ------------- | --------------------------------------------------------- |
| **`options`** | <code><a href="#setheldoptions">SetHeldOptions</a></code> |

**Returns:** <code>Promise&lt;{ onHold: boolean; }&gt;</code>

--------------------


### setRemoteHeld(...)

```typescript
setRemoteHeld(options: SetHeldOptions) => Promise<{ onHold: boolean; }>
```

Apply a hold initiated by the remote party without changing CallKit's local held state.

| Param         | Type                                                      |
| ------------- | --------------------------------------------------------- |
| **`options`** | <code><a href="#setheldoptions">SetHeldOptions</a></code> |

**Returns:** <code>Promise&lt;{ onHold: boolean; }&gt;</code>

--------------------


### setNativeMuted(...)

```typescript
setNativeMuted(options: SetNativeMutedOptions) => Promise<{ muted: boolean; }>
```

Mute the app-process native WebRTC sender.

| Param         | Type                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| **`options`** | <code><a href="#setnativemutedoptions">SetNativeMutedOptions</a></code> |

**Returns:** <code>Promise&lt;{ muted: boolean; }&gt;</code>

--------------------


### getCallState()

```typescript
getCallState() => Promise<{ answered: boolean; audioActive: boolean; speakerOn?: boolean; localHeld?: boolean; remoteHeld?: boolean; ringing?: boolean; systemHasCall?: boolean; isOutgoing?: boolean; handle?: string; callId?: string; callUUID?: string; connectedAtMs?: number; pendingOutgoingHandle?: string; pendingOutgoingAgeMs?: number; }>
```

Snapshot of native CallKit / audio session — used when JS missed
callAnswered/audioActivated (lock-screen race / cold WebView).

**Returns:** <code>Promise&lt;{ answered: boolean; audioActive: boolean; speakerOn?: boolean; localHeld?: boolean; remoteHeld?: boolean; ringing?: boolean; systemHasCall?: boolean; isOutgoing?: boolean; handle?: string; callId?: string; callUUID?: string; connectedAtMs?: number; pendingOutgoingHandle?: string; pendingOutgoingAgeMs?: number; }&gt;</code>

--------------------


### consumePendingOutgoing()

```typescript
consumePendingOutgoing() => Promise<{ handle: string; ageMs?: number; }>
```

Consume a Recents/Favorites outbound handle persisted by native CXStartCallAction
before the WebView was ready. Returns `{ handle: "" }` when none.

**Returns:** <code>Promise&lt;{ handle: string; ageMs?: number; }&gt;</code>

--------------------


### setNativeRemoteOffer(...)

```typescript
setNativeRemoteOffer(options: NativeRemoteOfferOptions) => Promise<{ type: string; sdp: string; }>
```

CallKit inbound: answer offer with app-process WebRTC (not WKWebView).
Resolves with local `{ type: "answer", sdp }`.

| Param         | Type                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| **`options`** | <code><a href="#nativeremoteofferoptions">NativeRemoteOfferOptions</a></code> |

**Returns:** <code>Promise&lt;{ type: string; sdp: string; }&gt;</code>

--------------------


### addNativeIceCandidate(...)

```typescript
addNativeIceCandidate(options: NativeIceCandidateOptions) => Promise<void>
```

Forward remote trickle ICE to the native peer.

| Param         | Type                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| **`options`** | <code><a href="#nativeicecandidateoptions">NativeIceCandidateOptions</a></code> |

--------------------


### endNativeCall()

```typescript
endNativeCall() => Promise<void>
```

Tear down native WebRTC without ending CallKit UI (hangup cleans both).

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


### readClipboard()

```typescript
readClipboard() => Promise<{ text: string; }>
```

UIPasteboard / navigator.clipboard — Connect gate paste button.

**Returns:** <code>Promise&lt;{ text: string; }&gt;</code>

--------------------


### getStorefront()

```typescript
getStorefront() => Promise<{ countryCode: string; }>
```

App Store storefront country (ISO alpha-3, e.g. "USA"); empty when unknown.

**Returns:** <code>Promise&lt;{ countryCode: string; }&gt;</code>

--------------------


### clipboardHasUrl()

```typescript
clipboardHasUrl() => Promise<{ hasUrl: boolean; }>
```

True when the pasteboard probably holds a web URL (no paste prompt).

**Returns:** <code>Promise&lt;{ hasUrl: boolean; }&gt;</code>

--------------------


### openInAppBrowser(...)

```typescript
openInAppBrowser(options: { url: string; }) => Promise<void>
```

Present an https page in SFSafariViewController (stays inside the app).

| Param         | Type                          |
| ------------- | ----------------------------- |
| **`options`** | <code>{ url: string; }</code> |

--------------------


### consumeInviteLink()

```typescript
consumeInviteLink() => Promise<{ url: string; }>
```

Share link from `phonehome://connect?url=…`; empty when none. Clears on read.

**Returns:** <code>Promise&lt;{ url: string; }&gt;</code>

--------------------


### getMothershipUrl()

```typescript
getMothershipUrl() => Promise<{ url: string; }>
```

**Returns:** <code>Promise&lt;{ url: string; }&gt;</code>

--------------------


### setMothershipUrl(...)

```typescript
setMothershipUrl(options: SetMothershipUrlOptions) => Promise<{ url: string; }>
```

Save HTTPS origin and optionally reload the WebView onto that hub.

| Param         | Type                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| **`options`** | <code><a href="#setmothershipurloptions">SetMothershipUrlOptions</a></code> |

**Returns:** <code>Promise&lt;{ url: string; }&gt;</code>

--------------------


### clearMothershipUrl(...)

```typescript
clearMothershipUrl(options?: { reload?: boolean | undefined; } | undefined) => Promise<{ cleared: boolean; }>
```

Clear saved hub; reload bundled softphone when `reload` is true (default).

| Param         | Type                               |
| ------------- | ---------------------------------- |
| **`options`** | <code>{ reload?: boolean; }</code> |

**Returns:** <code>Promise&lt;{ cleared: boolean; }&gt;</code>

--------------------


### hideLaunchCover()

```typescript
hideLaunchCover() => Promise<{ hidden: boolean; }>
```

Fade the native launch-mark cover once the first real screen has painted.

**Returns:** <code>Promise&lt;{ hidden: boolean; }&gt;</code>

--------------------


### getOnboarding()

```typescript
getOnboarding() => Promise<{ howItWorksDone: boolean; }>
```

Device-scoped onboarding flags (UserDefaults). Survives Cap → Mothership
WebView hop so How it works is not replayed after Connect.

**Returns:** <code>Promise&lt;{ howItWorksDone: boolean; }&gt;</code>

--------------------


### setOnboarding(...)

```typescript
setOnboarding(options: SetOnboardingOptions) => Promise<{ howItWorksDone: boolean; }>
```

| Param         | Type                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **`options`** | <code><a href="#setonboardingoptions">SetOnboardingOptions</a></code> |

**Returns:** <code>Promise&lt;{ howItWorksDone: boolean; }&gt;</code>

--------------------


### getMigrateTransfer()

```typescript
getMigrateTransfer() => Promise<{ json: string; }>
```

Device-scoped Pod migrate transfer (UserDefaults `ph_migrate_transfer_v1`).
Survives Change Mothership so Restore can run on the new hub.

**Returns:** <code>Promise&lt;{ json: string; }&gt;</code>

--------------------


### setMigrateTransfer(...)

```typescript
setMigrateTransfer(options: SetMigrateTransferOptions) => Promise<{ saved: boolean; }>
```

| Param         | Type                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| **`options`** | <code><a href="#setmigratetransferoptions">SetMigrateTransferOptions</a></code> |

**Returns:** <code>Promise&lt;{ saved: boolean; }&gt;</code>

--------------------


### clearMigrateTransfer()

```typescript
clearMigrateTransfer() => Promise<{ cleared: boolean; }>
```

**Returns:** <code>Promise&lt;{ cleared: boolean; }&gt;</code>

--------------------


### addListener('voipToken' | 'voipTokenInvalid' | 'inviteLink' | 'apnsToken' | 'apnsTokenInvalid' | 'incomingPush' | 'incomingAlert' | 'callAnswered' | 'callEnded' | 'nativeRemoteEnded' | 'callStarted' | 'callConnected' | 'callHeld' | 'audioActivated' | 'audioDeactivated' | 'nativeLocalAnswer' | 'nativeIceCandidate' | 'nativeConnectionState' | 'nativeMediaStat', ...)

```typescript
addListener(eventName: "voipToken" | "voipTokenInvalid" | "inviteLink" | "apnsToken" | "apnsTokenInvalid" | "incomingPush" | "incomingAlert" | "callAnswered" | "callEnded" | "nativeRemoteEnded" | "callStarted" | "callConnected" | "callHeld" | "audioActivated" | "audioDeactivated" | "nativeLocalAnswer" | "nativeIceCandidate" | "nativeConnectionState" | "nativeMediaStat", listenerFunc: (event: Record<string, unknown>) => void) => Promise<{ remove: () => Promise<void>; }>
```

| Param              | Type                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`eventName`**    | <code>'voipToken' \| 'voipTokenInvalid' \| 'inviteLink' \| 'apnsToken' \| 'apnsTokenInvalid' \| 'incomingPush' \| 'incomingAlert' \| 'callAnswered' \| 'callEnded' \| 'nativeRemoteEnded' \| 'callStarted' \| 'callConnected' \| 'callHeld' \| 'audioActivated' \| 'audioDeactivated' \| 'nativeLocalAnswer' \| 'nativeIceCandidate' \| 'nativeConnectionState' \| 'nativeMediaStat'</code> |
| **`listenerFunc`** | <code>(event: <a href="#record">Record</a>&lt;string, unknown&gt;) =&gt; void</code>                                                                                                                                                                                                                                                                                                        |

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
| **`fromLineId`** | <code>string</code> |                                            |
| **`toLineId`**   | <code>string</code> |                                            |


#### StartOutgoingOptions

| Prop         | Type                |
| ------------ | ------------------- |
| **`callId`** | <code>string</code> |
| **`handle`** | <code>string</code> |


#### SetSpeakerOptions

| Prop          | Type                 | Description                                             |
| ------------- | -------------------- | ------------------------------------------------------- |
| **`enabled`** | <code>boolean</code> | true = loudspeaker; false = earpiece (default for 1:1). |


#### SetHeldOptions

| Prop         | Type                 | Description                                    |
| ------------ | -------------------- | ---------------------------------------------- |
| **`onHold`** | <code>boolean</code> |                                                |
| **`muted`**  | <code>boolean</code> | Preserve the in-app mute choice when resuming. |


#### SetNativeMutedOptions

| Prop        | Type                 |
| ----------- | -------------------- |
| **`muted`** | <code>boolean</code> |


#### NativeRemoteOfferOptions

| Prop             | Type                                                                                                                                | Description                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **`callId`**     | <code>string</code>                                                                                                                 |                                                                         |
| **`sdp`**        | <code>{ type?: string; sdp: string; }</code>                                                                                        | Remote offer — `{ type: "offer", sdp: string }` or pass offerSdp alone. |
| **`offerSdp`**   | <code>string</code>                                                                                                                 |                                                                         |
| **`iceServers`** | <code><a href="#array">Array</a>&lt;{ urls?: string \| string[]; url?: string; username?: string; credential?: string; }&gt;</code> |                                                                         |


#### Array

| Prop         | Type                | Description                                                                                            |
| ------------ | ------------------- | ------------------------------------------------------------------------------------------------------ |
| **`length`** | <code>number</code> | Gets or sets the length of the array. This is a number one higher than the highest index in the array. |

| Method             | Signature                                                                                                                     | Description                                                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **toString**       | () =&gt; string                                                                                                               | Returns a string representation of an array.                                                                                                                                                                                                |
| **toLocaleString** | () =&gt; string                                                                                                               | Returns a string representation of an array. The elements are converted to string using their toLocalString methods.                                                                                                                        |
| **pop**            | () =&gt; T \| undefined                                                                                                       | Removes the last element from an array and returns it. If the array is empty, undefined is returned and the array is not modified.                                                                                                          |
| **push**           | (...items: T[]) =&gt; number                                                                                                  | Appends new elements to the end of an array, and returns the new length of the array.                                                                                                                                                       |
| **concat**         | (...items: <a href="#concatarray">ConcatArray</a>&lt;T&gt;[]) =&gt; T[]                                                       | Combines two or more arrays. This method returns a new array without modifying any existing arrays.                                                                                                                                         |
| **concat**         | (...items: (T \| <a href="#concatarray">ConcatArray</a>&lt;T&gt;)[]) =&gt; T[]                                                | Combines two or more arrays. This method returns a new array without modifying any existing arrays.                                                                                                                                         |
| **join**           | (separator?: string \| undefined) =&gt; string                                                                                | Adds all the elements of an array into a string, separated by the specified separator string.                                                                                                                                               |
| **reverse**        | () =&gt; T[]                                                                                                                  | Reverses the elements in an array in place. This method mutates the array and returns a reference to the same array.                                                                                                                        |
| **shift**          | () =&gt; T \| undefined                                                                                                       | Removes the first element from an array and returns it. If the array is empty, undefined is returned and the array is not modified.                                                                                                         |
| **slice**          | (start?: number \| undefined, end?: number \| undefined) =&gt; T[]                                                            | Returns a copy of a section of an array. For both start and end, a negative index can be used to indicate an offset from the end of the array. For example, -2 refers to the second to last element of the array.                           |
| **sort**           | (compareFn?: ((a: T, b: T) =&gt; number) \| undefined) =&gt; this                                                             | Sorts an array in place. This method mutates the array and returns a reference to the same array.                                                                                                                                           |
| **splice**         | (start: number, deleteCount?: number \| undefined) =&gt; T[]                                                                  | Removes elements from an array and, if necessary, inserts new elements in their place, returning the deleted elements.                                                                                                                      |
| **splice**         | (start: number, deleteCount: number, ...items: T[]) =&gt; T[]                                                                 | Removes elements from an array and, if necessary, inserts new elements in their place, returning the deleted elements.                                                                                                                      |
| **unshift**        | (...items: T[]) =&gt; number                                                                                                  | Inserts new elements at the start of an array, and returns the new length of the array.                                                                                                                                                     |
| **indexOf**        | (searchElement: T, fromIndex?: number \| undefined) =&gt; number                                                              | Returns the index of the first occurrence of a value in an array, or -1 if it is not present.                                                                                                                                               |
| **lastIndexOf**    | (searchElement: T, fromIndex?: number \| undefined) =&gt; number                                                              | Returns the index of the last occurrence of a specified value in an array, or -1 if it is not present.                                                                                                                                      |
| **every**          | &lt;S extends T&gt;(predicate: (value: T, index: number, array: T[]) =&gt; value is S, thisArg?: any) =&gt; this is S[]       | Determines whether all the members of an array satisfy the specified test.                                                                                                                                                                  |
| **every**          | (predicate: (value: T, index: number, array: T[]) =&gt; unknown, thisArg?: any) =&gt; boolean                                 | Determines whether all the members of an array satisfy the specified test.                                                                                                                                                                  |
| **some**           | (predicate: (value: T, index: number, array: T[]) =&gt; unknown, thisArg?: any) =&gt; boolean                                 | Determines whether the specified callback function returns true for any element of an array.                                                                                                                                                |
| **forEach**        | (callbackfn: (value: T, index: number, array: T[]) =&gt; void, thisArg?: any) =&gt; void                                      | Performs the specified action for each element in an array.                                                                                                                                                                                 |
| **map**            | &lt;U&gt;(callbackfn: (value: T, index: number, array: T[]) =&gt; U, thisArg?: any) =&gt; U[]                                 | Calls a defined callback function on each element of an array, and returns an array that contains the results.                                                                                                                              |
| **filter**         | &lt;S extends T&gt;(predicate: (value: T, index: number, array: T[]) =&gt; value is S, thisArg?: any) =&gt; S[]               | Returns the elements of an array that meet the condition specified in a callback function.                                                                                                                                                  |
| **filter**         | (predicate: (value: T, index: number, array: T[]) =&gt; unknown, thisArg?: any) =&gt; T[]                                     | Returns the elements of an array that meet the condition specified in a callback function.                                                                                                                                                  |
| **reduce**         | (callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) =&gt; T) =&gt; T                           | Calls the specified callback function for all the elements in an array. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function.                      |
| **reduce**         | (callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) =&gt; T, initialValue: T) =&gt; T          |                                                                                                                                                                                                                                             |
| **reduce**         | &lt;U&gt;(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) =&gt; U, initialValue: U) =&gt; U | Calls the specified callback function for all the elements in an array. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function.                      |
| **reduceRight**    | (callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) =&gt; T) =&gt; T                           | Calls the specified callback function for all the elements in an array, in descending order. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function. |
| **reduceRight**    | (callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) =&gt; T, initialValue: T) =&gt; T          |                                                                                                                                                                                                                                             |
| **reduceRight**    | &lt;U&gt;(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) =&gt; U, initialValue: U) =&gt; U | Calls the specified callback function for all the elements in an array, in descending order. The return value of the callback function is the accumulated result, and is provided as an argument in the next call to the callback function. |


#### ConcatArray

| Prop         | Type                |
| ------------ | ------------------- |
| **`length`** | <code>number</code> |

| Method    | Signature                                                          |
| --------- | ------------------------------------------------------------------ |
| **join**  | (separator?: string \| undefined) =&gt; string                     |
| **slice** | (start?: number \| undefined, end?: number \| undefined) =&gt; T[] |


#### NativeIceCandidateOptions

| Prop            | Type                                                                     | Description                                          |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| **`candidate`** | <code><a href="#record">Record</a>&lt;string, unknown&gt; \| null</code> | RTCIceCandidate JSON, or null for end-of-candidates. |


#### SetBadgeOptions

| Prop        | Type                | Description                              |
| ----------- | ------------------- | ---------------------------------------- |
| **`count`** | <code>number</code> | Home-screen icon badge count (0 clears). |


#### SetMothershipUrlOptions

| Prop           | Type                 | Description                                                                                                                                                                                                  |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`url`**      | <code>string</code>  | Full HTTPS origin, e.g. https://mothership.example:8443                                                                                                                                                    |
| **`reload`**   | <code>boolean</code> | When true (default), reload the WebView to the new origin after save.                                                                                                                                        |
| **`openPath`** | <code>string</code>  | Optional path+query to open on first load after save (e.g. `/?join=…`). Origin is still what we persist; this only shapes the WebView navigation so share tokens survive the hop from the bundled Cap shell. |


#### SetOnboardingOptions

| Prop                 | Type                 | Description                                                        |
| -------------------- | -------------------- | ------------------------------------------------------------------ |
| **`howItWorksDone`** | <code>boolean</code> | When true, How it works is done on this device (survives hub hop). |


#### SetMigrateTransferOptions

| Prop       | Type                | Description                                                         |
| ---------- | ------------------- | ------------------------------------------------------------------- |
| **`json`** | <code>string</code> | JSON string of the migrate transfer blob (export + fromUrl + step). |


### Type Aliases


#### Record

Construct a type with a set of properties K of type T

<code>{ [P in K]: T; }</code>

</docgen-api>
