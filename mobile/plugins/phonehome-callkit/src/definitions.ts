export interface ReportIncomingOptions {
  callId: string;
  /** Generic CallKit handle (line id or label). */
  handle: string;
  callerName: string;
  fromLineId?: string;
  toLineId?: string;
}

export interface StartOutgoingOptions {
  callId?: string;
  handle: string;
}

export interface SetBadgeOptions {
  /** Home-screen icon badge count (0 clears). */
  count: number;
}

export interface SetSpeakerOptions {
  /** true = loudspeaker; false = earpiece (default for 1:1). */
  enabled: boolean;
}

export interface SetHeldOptions {
  onHold: boolean;
  /** Preserve the in-app mute choice when resuming. */
  muted?: boolean;
}

export interface SetNativeMutedOptions {
  muted: boolean;
}

export interface SetCallKitEnabledOptions {
  /** When false (default), no system CallKit UI / no PushKit VoIP. */
  enabled: boolean;
}

export interface NativeRemoteOfferOptions {
  callId: string;
  /** Remote offer — `{ type: "offer", sdp: string }` or pass offerSdp alone. */
  sdp?: { type?: string; sdp: string };
  offerSdp?: string;
  iceServers?: Array<{
    urls?: string | string[];
    url?: string;
    username?: string;
    credential?: string;
  }>;
}

export interface NativeIceCandidateOptions {
  /** RTCIceCandidate JSON, or null for end-of-candidates. */
  candidate?: Record<string, unknown> | null;
}

export interface SetMothershipUrlOptions {
  /** Full HTTPS origin, e.g. https://mothership.example:8443 */
  url: string;
  /** When true (default), reload the WebView to the new origin after save. */
  reload?: boolean;
  /**
   * Optional path+query to open on first load after save (e.g. `/?join=…`).
   * Origin is still what we persist; this only shapes the WebView navigation
   * so share tokens survive the hop from the bundled Cap shell.
   */
  openPath?: string;
}

export interface SetOnboardingOptions {
  /** When true, How it works is done on this device (survives hub hop). */
  howItWorksDone?: boolean;
}

export interface SetMigrateTransferOptions {
  /** JSON string of the migrate transfer blob (export + fromUrl + step). */
  json: string;
}

export interface PhoneHomeCallKitPlugin {
  /**
   * Start PushKit VoIP registration; listen for `voipToken`.
   * No-op when CallKit is disabled (default) — Apple requires CallKit on every VoIP push.
   */
  registerVoIP(): Promise<void>;
  /**
   * Request alert/sound/badge permission and register for standard APNs.
   * Preferred path when CallKit is tabled — tap opens in-app softphone UI.
   */
  registerAlertPush(): Promise<{ granted: boolean }>;
  /** Persist CallKit flag (always on — disable is ignored). */
  setCallKitEnabled(options: SetCallKitEnabledOptions): Promise<{ enabled: boolean }>;
  isCallKitEnabled(): Promise<{ enabled: boolean }>;
  /** Locally report an incoming CallKit call (also used after push). No-op if CallKit off. */
  reportIncoming(options: ReportIncomingOptions): Promise<void>;
  /** System outgoing CallKit UI. No-op if CallKit off. */
  startOutgoing(options: StartOutgoingOptions): Promise<{ callId: string }>;
  endCall(options?: { callId?: string }): Promise<void>;
  setConnected(options?: {
    callId?: string;
    /** Epoch milliseconds used by both the app sheet and CallKit duration. */
    connectedAtMs?: number;
  }): Promise<{ connectedAtMs?: number }>;
  /**
   * Route call audio to loudspeaker (`enabled: true`) or earpiece (`false`).
   * Also toggles proximity monitoring (on for earpiece, off for speaker).
   */
  setSpeaker(options: SetSpeakerOptions): Promise<{ enabled: boolean }>;
  /** Request a local/system CallKit Hold or Resume transaction. */
  setHeld(options: SetHeldOptions): Promise<{ onHold: boolean }>;
  /** Apply a hold initiated by the remote party without changing CallKit's local held state. */
  setRemoteHeld(options: SetHeldOptions): Promise<{ onHold: boolean }>;
  /** Mute the app-process native WebRTC sender. */
  setNativeMuted(options: SetNativeMutedOptions): Promise<{ muted: boolean }>;
  /**
   * Snapshot of native CallKit / audio session — used when JS missed
   * callAnswered/audioActivated (lock-screen race / cold WebView).
   */
  getCallState(): Promise<{
    answered: boolean;
    audioActive: boolean;
    speakerOn?: boolean;
    localHeld?: boolean;
    remoteHeld?: boolean;
    ringing?: boolean;
    systemHasCall?: boolean;
    /** True when the live CallKit call is outbound (Recents / Favorites / startOutgoing). */
    isOutgoing?: boolean;
    /** Remote CallKit handle (usually a line id). */
    handle?: string;
    callId?: string;
    callUUID?: string;
    connectedAtMs?: number;
    pendingOutgoingHandle?: string;
    pendingOutgoingAgeMs?: number;
  }>;
  /**
   * Consume a Recents/Favorites outbound handle persisted by native CXStartCallAction
   * before the WebView was ready. Returns `{ handle: "" }` when none.
   */
  consumePendingOutgoing(): Promise<{ handle: string; ageMs?: number }>;
  /**
   * CallKit inbound: answer offer with app-process WebRTC (not WKWebView).
   * Resolves with local `{ type: "answer", sdp }`.
   */
  setNativeRemoteOffer(options: NativeRemoteOfferOptions): Promise<{ type: string; sdp: string }>;
  /** Forward remote trickle ICE to the native peer. */
  addNativeIceCandidate(options: NativeIceCandidateOptions): Promise<void>;
  /** Tear down native WebRTC without ending CallKit UI (hangup cleans both). */
  endNativeCall(): Promise<void>;
  /**
   * Request badge authorization (UNUserNotificationCenter `.badge`).
   * Safe to call repeatedly; returns whether badge permission is granted.
   */
  requestBadgePermission(): Promise<{ granted: boolean }>;
  /** Set or clear the iOS home-screen app icon badge. */
  setBadge(options: SetBadgeOptions): Promise<void>;
  /** Convenience: setBadge({ count: 0 }). */
  clearBadge(): Promise<void>;
  /** Store username + password in the iOS Keychain (this device only). */
  saveLogin(options: { username: string; password: string }): Promise<{ saved: boolean }>;
  hasSavedLogin(): Promise<{ saved: boolean; username: string; biometry: string }>;
  /** Face ID / Touch ID, then return the Keychain password. Never log the result. */
  getLogin(options?: { reason?: string }): Promise<{ username: string; password: string }>;
  clearLogin(): Promise<{ cleared: boolean }>;
  /** Persist the hub session token in Keychain so WKWebView localStorage wipes don't log you out. */
  saveSession(options: { sessionId: string }): Promise<{ saved: boolean }>;
  getSession(): Promise<{ sessionId: string }>;
  clearSession(): Promise<{ cleared: boolean }>;
  /**
   * Self-hosted Mothership HTTPS origin (UserDefaults `ph_mothership_url`).
   * Empty string when unset — show the native URL gate.
   */
  /** UIPasteboard / navigator.clipboard — Connect gate paste button. */
  readClipboard(): Promise<{ text: string }>;
  /** App Store storefront country (ISO alpha-3, e.g. "USA"); empty when unknown. */
  getStorefront(): Promise<{ countryCode: string }>;
  /** True when the pasteboard probably holds a web URL (no paste prompt). */
  clipboardHasUrl(): Promise<{ hasUrl: boolean }>;
  /** Present an https page in SFSafariViewController (stays inside the app). */
  openInAppBrowser(options: { url: string }): Promise<void>;
  /** Share link from `phonehome://connect?url=…`; empty when none. Clears on read. */
  consumeInviteLink(): Promise<{ url: string }>;
  getMothershipUrl(): Promise<{ url: string }>;
  /** Save HTTPS origin and optionally reload the WebView onto that hub. */
  setMothershipUrl(options: SetMothershipUrlOptions): Promise<{ url: string }>;
  /** Clear saved hub; reload bundled softphone when `reload` is true (default). */
  clearMothershipUrl(options?: { reload?: boolean }): Promise<{ cleared: boolean }>;
  /** Fade the native launch-mark cover once the first real screen has painted. */
  hideLaunchCover(): Promise<{ hidden: boolean }>;
  /**
   * Device-scoped onboarding flags (UserDefaults). Survives Cap → Mothership
   * WebView hop so How it works is not replayed after Connect.
   */
  getOnboarding(): Promise<{ howItWorksDone: boolean }>;
  setOnboarding(options: SetOnboardingOptions): Promise<{ howItWorksDone: boolean }>;
  /**
   * Device-scoped Pod migrate transfer (UserDefaults `ph_migrate_transfer_v1`).
   * Survives Change Mothership so Restore can run on the new hub.
   */
  getMigrateTransfer(): Promise<{ json: string }>;
  setMigrateTransfer(options: SetMigrateTransferOptions): Promise<{ saved: boolean }>;
  clearMigrateTransfer(): Promise<{ cleared: boolean }>;
  addListener(
    eventName:
      | "voipToken"
      | "voipTokenInvalid"
      | "inviteLink"
      | "apnsToken"
      | "apnsTokenInvalid"
      | "incomingPush"
      | "incomingAlert"
      | "callAnswered"
      | "callEnded"
      | "nativeRemoteEnded"
      | "callStarted"
      | "callConnected"
      | "callHeld"
      | "audioActivated"
      | "audioDeactivated"
      | "nativeLocalAnswer"
      | "nativeIceCandidate"
      | "nativeConnectionState"
      | "nativeMediaStat",
    listenerFunc: (event: Record<string, unknown>) => void
  ): Promise<{ remove: () => Promise<void> }>;
}
