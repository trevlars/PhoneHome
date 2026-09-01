export interface ReportIncomingOptions {
  callId: string;
  /** Generic CallKit handle (line id or label). */
  handle: string;
  callerName: string;
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

export interface SetCallKitEnabledOptions {
  /** When false (default), no system CallKit UI / no PushKit VoIP. */
  enabled: boolean;
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
  /** Persist CallKit feature flag (UserDefaults `kl_callkit`). Default remains off. */
  setCallKitEnabled(options: SetCallKitEnabledOptions): Promise<{ enabled: boolean }>;
  isCallKitEnabled(): Promise<{ enabled: boolean }>;
  /** Locally report an incoming CallKit call (also used after push). No-op if CallKit off. */
  reportIncoming(options: ReportIncomingOptions): Promise<void>;
  /** System outgoing CallKit UI. No-op if CallKit off. */
  startOutgoing(options: StartOutgoingOptions): Promise<{ callId: string }>;
  endCall(options?: { callId?: string }): Promise<void>;
  setConnected(options?: { callId?: string }): Promise<void>;
  /**
   * Route call audio to loudspeaker (`enabled: true`) or earpiece (`false`).
   * Also toggles proximity monitoring (on for earpiece, off for speaker).
   */
  setSpeaker(options: SetSpeakerOptions): Promise<{ enabled: boolean }>;
  /**
   * Snapshot of native CallKit / audio session — used when JS missed
   * callAnswered/audioActivated (lock-screen race / cold WebView).
   */
  getCallState(): Promise<{
    answered: boolean;
    audioActive: boolean;
    speakerOn?: boolean;
    ringing?: boolean;
    systemHasCall?: boolean;
    callUUID?: string;
    callId?: string;
  }>;
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
  addListener(
    eventName:
      | "voipToken"
      | "voipTokenInvalid"
      | "apnsToken"
      | "apnsTokenInvalid"
      | "incomingPush"
      | "incomingAlert"
      | "callAnswered"
      | "callEnded"
      | "callStarted"
      | "audioActivated"
      | "audioDeactivated",
    listenerFunc: (event: Record<string, unknown>) => void
  ): Promise<{ remove: () => Promise<void> }>;
}
