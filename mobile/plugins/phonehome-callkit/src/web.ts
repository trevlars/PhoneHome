import { WebPlugin } from '@capacitor/core';

import type { PhoneHomeCallKitPlugin, ReportIncomingOptions, StartOutgoingOptions } from './definitions';

export class PhoneHomeCallKitWeb extends WebPlugin implements PhoneHomeCallKitPlugin {
  async registerVoIP(): Promise<void> {
    console.info('[PhoneHomeCallKit] registerVoIP is iOS-only');
  }

  async reportIncoming(_options: ReportIncomingOptions): Promise<void> {
    console.info('[PhoneHomeCallKit] reportIncoming is iOS-only');
  }

  async startOutgoing(options: StartOutgoingOptions): Promise<{ callId: string }> {
    return { callId: options.callId || `web-${Date.now()}` };
  }

  async endCall(): Promise<void> {}

  async setConnected(): Promise<void> {}
}
