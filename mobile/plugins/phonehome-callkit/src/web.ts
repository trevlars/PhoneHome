import { WebPlugin } from '@capacitor/core';

import type {
  PhoneHomeCallKitPlugin,
  ReportIncomingOptions,
  SetBadgeOptions,
  SetCallKitEnabledOptions,
  SetSpeakerOptions,
  StartOutgoingOptions,
} from './definitions';

export class PhoneHomeCallKitWeb extends WebPlugin implements PhoneHomeCallKitPlugin {
  async registerVoIP(): Promise<void> {
    console.info('[PhoneHomeCallKit] registerVoIP is iOS-only');
  }

  async registerAlertPush(): Promise<{ granted: boolean }> {
    console.info('[PhoneHomeCallKit] registerAlertPush is iOS-only');
    return { granted: false };
  }

  async setCallKitEnabled(options: SetCallKitEnabledOptions): Promise<{ enabled: boolean }> {
    return { enabled: Boolean(options?.enabled) };
  }

  async isCallKitEnabled(): Promise<{ enabled: boolean }> {
    return { enabled: false };
  }

  async reportIncoming(_options: ReportIncomingOptions): Promise<void> {
    console.info('[PhoneHomeCallKit] reportIncoming is iOS-only');
  }

  async startOutgoing(options: StartOutgoingOptions): Promise<{ callId: string }> {
    return { callId: options.callId || `web-${Date.now()}` };
  }

  async endCall(): Promise<void> {}

  async setConnected(): Promise<void> {}

  async setSpeaker(options: SetSpeakerOptions): Promise<{ enabled: boolean }> {
    // Browsers cannot route to the earpiece; keep UX honest.
    console.info('[PhoneHomeCallKit] setSpeaker is iOS-only — web uses device default output');
    return { enabled: Boolean(options?.enabled) };
  }

  async getCallState(): Promise<{
    answered: boolean;
    audioActive: boolean;
    speakerOn?: boolean;
    ringing?: boolean;
    systemHasCall?: boolean;
    callUUID?: string;
    callId?: string;
  }> {
    return { answered: false, audioActive: false, speakerOn: false };
  }

  async requestBadgePermission(): Promise<{ granted: boolean }> {
    return { granted: false };
  }

  async setBadge(_options: SetBadgeOptions): Promise<void> {}

  async clearBadge(): Promise<void> {}

  async saveLogin(): Promise<{ saved: boolean }> {
    return { saved: false };
  }

  async hasSavedLogin(): Promise<{ saved: boolean; username: string; biometry: string }> {
    return { saved: false, username: '', biometry: 'none' };
  }

  async getLogin(): Promise<{ username: string; password: string }> {
    throw this.unimplemented('Keychain login is iOS-only');
  }

  async clearLogin(): Promise<{ cleared: boolean }> {
    return { cleared: true };
  }

  async saveSession(): Promise<{ saved: boolean }> {
    return { saved: false };
  }

  async getSession(): Promise<{ sessionId: string }> {
    return { sessionId: '' };
  }

  async clearSession(): Promise<{ cleared: boolean }> {
    return { cleared: true };
  }
}
