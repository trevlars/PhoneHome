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
* [`reportIncoming(...)`](#reportincoming)
* [`startOutgoing(...)`](#startoutgoing)
* [`endCall(...)`](#endcall)
* [`setConnected(...)`](#setconnected)
* [`addListener('voipToken' | 'voipTokenInvalid' | 'incomingPush' | 'callAnswered' | 'callEnded' | 'callStarted' | 'audioActivated' | 'audioDeactivated', ...)`](#addlistenervoiptoken--voiptokeninvalid--incomingpush--callanswered--callended--callstarted--audioactivated--audiodeactivated-)
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

--------------------


### reportIncoming(...)

```typescript
reportIncoming(options: ReportIncomingOptions) => Promise<void>
```

Locally report an incoming CallKit call (also used after push).

| Param         | Type                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| **`options`** | <code><a href="#reportincomingoptions">ReportIncomingOptions</a></code> |

--------------------


### startOutgoing(...)

```typescript
startOutgoing(options: StartOutgoingOptions) => Promise<{ callId: string; }>
```

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


### addListener('voipToken' | 'voipTokenInvalid' | 'incomingPush' | 'callAnswered' | 'callEnded' | 'callStarted' | 'audioActivated' | 'audioDeactivated', ...)

```typescript
addListener(eventName: "voipToken" | "voipTokenInvalid" | "incomingPush" | "callAnswered" | "callEnded" | "callStarted" | "audioActivated" | "audioDeactivated", listenerFunc: (event: Record<string, unknown>) => void) => Promise<{ remove: () => Promise<void>; }>
```

| Param              | Type                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`eventName`**    | <code>'voipToken' \| 'voipTokenInvalid' \| 'incomingPush' \| 'callAnswered' \| 'callEnded' \| 'callStarted' \| 'audioActivated' \| 'audioDeactivated'</code> |
| **`listenerFunc`** | <code>(event: <a href="#record">Record</a>&lt;string, unknown&gt;) =&gt; void</code>                                                                         |

**Returns:** <code>Promise&lt;{ remove: () =&gt; Promise&lt;void&gt;; }&gt;</code>

--------------------


### Interfaces


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


### Type Aliases


#### Record

Construct a type with a set of properties K of type T

<code>{ [P in K]: T; }</code>

</docgen-api>
