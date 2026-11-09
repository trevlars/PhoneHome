import { WebPlugin } from '@capacitor/core';

import type {
  NativeIceCandidateOptions,
  NativeRemoteOfferOptions,
  PhoneHomeCallKitPlugin,
  ReportIncomingOptions,
  SetBadgeOptions,
  SetCallKitEnabledOptions,
  SetHeldOptions,
  SetMothershipUrlOptions,
  SetNativeMutedOptions,
  SetSpeakerOptions,
  StartOutgoingOptions,
} from './definitions';

const WEB_MOTHERSHIP_KEY = 'ph_mothership_url';

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

  async setConnected(): Promise<{ connectedAtMs?: number }> {
    return {};
  }

  async setSpeaker(options: SetSpeakerOptions): Promise<{ enabled: boolean }> {
    // Browsers cannot route to the earpiece; keep UX honest.
    console.info('[PhoneHomeCallKit] setSpeaker is iOS-only — web uses device default output');
    return { enabled: Boolean(options?.enabled) };
  }

  async setHeld(options: SetHeldOptions): Promise<{ onHold: boolean }> {
    return { onHold: Boolean(options?.onHold) };
  }

  async setRemoteHeld(options: SetHeldOptions): Promise<{ onHold: boolean }> {
    return { onHold: Boolean(options?.onHold) };
  }

  async setNativeMuted(options: SetNativeMutedOptions): Promise<{ muted: boolean }> {
    return { muted: Boolean(options?.muted) };
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

  async consumePendingOutgoing(): Promise<{ handle: string; ageMs?: number }> {
    return { handle: '', ageMs: 0 };
  }

  async setNativeRemoteOffer(
    _options: NativeRemoteOfferOptions
  ): Promise<{ type: string; sdp: string }> {
    throw this.unimplemented('Native WebRTC is iOS-only');
  }

  async addNativeIceCandidate(_options: NativeIceCandidateOptions): Promise<void> {}

  async endNativeCall(): Promise<void> {}

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

  async readClipboard(): Promise<{ text: string }> {
    try {
      const text = await navigator.clipboard.readText();
      return { text: String(text || '') };
    } catch {
      return { text: '' };
    }
  }

  async getStorefront(): Promise<{ countryCode: string }> {
    return { countryCode: '' };
  }

  async clipboardHasUrl(): Promise<{ hasUrl: boolean }> {
    return { hasUrl: false };
  }

  async openInAppBrowser(options: { url: string }): Promise<void> {
    window.open(options.url, '_blank', 'noopener');
  }

  async consumeInviteLink(): Promise<{ url: string }> {
    return { url: '' };
  }

  async getMothershipUrl(): Promise<{ url: string }> {
    try {
      return { url: localStorage.getItem(WEB_MOTHERSHIP_KEY) || '' };
    } catch {
      return { url: '' };
    }
  }

  async setMothershipUrl(options: SetMothershipUrlOptions): Promise<{ url: string }> {
    const raw = String(options?.url || '').trim();
    let url = raw;
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (!/^https:\/\//i.test(url)) {
      throw this.unavailable('Mothership address must start with https://');
    }
    try {
      const u = new URL(url);
      url = `${u.protocol}//${u.host}`;
    } catch {
      throw this.unavailable('That doesn’t look like a valid HTTPS URL');
    }
    try {
      localStorage.setItem(WEB_MOTHERSHIP_KEY, url);
    } catch {
      /* ignore */
    }
    if (options?.reload !== false && typeof window !== 'undefined') {
      let openPath = String(options?.openPath || '').trim();
      if (openPath && !openPath.startsWith('/')) openPath = `/${openPath}`;
      if (openPath.includes('://') || openPath.includes('\\')) openPath = '';
      window.location.href = openPath ? `${url}${openPath}` : url;
    }
    return { url };
  }

  async hideLaunchCover(): Promise<{ hidden: boolean }> {
    return { hidden: false };
  }

  async clearMothershipUrl(options?: { reload?: boolean }): Promise<{ cleared: boolean }> {
    try {
      localStorage.removeItem(WEB_MOTHERSHIP_KEY);
    } catch {
      /* ignore */
    }
    if (options?.reload !== false && typeof window !== 'undefined') {
      window.location.reload();
    }
    return { cleared: true };
  }

  async getOnboarding(): Promise<{ howItWorksDone: boolean }> {
    try {
      return { howItWorksDone: localStorage.getItem('ph_how_it_works_done_v1') === '1' };
    } catch {
      return { howItWorksDone: false };
    }
  }

  async setOnboarding(options: { howItWorksDone?: boolean }): Promise<{ howItWorksDone: boolean }> {
    const done = Boolean(options?.howItWorksDone);
    try {
      if (done) localStorage.setItem('ph_how_it_works_done_v1', '1');
      else localStorage.removeItem('ph_how_it_works_done_v1');
    } catch {
      /* ignore */
    }
    return { howItWorksDone: done };
  }

  async getMigrateTransfer(): Promise<{ json: string }> {
    try {
      return { json: localStorage.getItem('ph_migrate_transfer_v1') || '' };
    } catch {
      return { json: '' };
    }
  }

  async setMigrateTransfer(options: { json: string }): Promise<{ saved: boolean }> {
    try {
      const json = String(options?.json || '');
      if (json) localStorage.setItem('ph_migrate_transfer_v1', json);
      else localStorage.removeItem('ph_migrate_transfer_v1');
    } catch {
      /* ignore */
    }
    return { saved: true };
  }

  async clearMigrateTransfer(): Promise<{ cleared: boolean }> {
    try {
      localStorage.removeItem('ph_migrate_transfer_v1');
    } catch {
      /* ignore */
    }
    return { cleared: true };
  }
}
