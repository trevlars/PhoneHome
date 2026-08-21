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

export interface PhoneHomeCallKitPlugin {
  /** Start PushKit VoIP registration; listen for `voipToken`. */
  registerVoIP(): Promise<void>;
  /** Locally report an incoming CallKit call (also used after push). */
  reportIncoming(options: ReportIncomingOptions): Promise<void>;
  startOutgoing(options: StartOutgoingOptions): Promise<{ callId: string }>;
  endCall(options?: { callId?: string }): Promise<void>;
  setConnected(options?: { callId?: string }): Promise<void>;
  addListener(
    eventName: "voipToken" | "voipTokenInvalid" | "incomingPush" | "callAnswered" | "callEnded" | "callStarted" | "audioActivated" | "audioDeactivated",
    listenerFunc: (event: Record<string, unknown>) => void
  ): Promise<{ remove: () => Promise<void> }>;
}
