import type { CapacitorConfig } from '@capacitor/cli';

/**
 * PhoneHome iOS shell (Capacitor).
 *
 * Default: load the live HTTPS softphone so auth/cookies match the hub.
 * For offline/bundled QA, set PHONEHOME_CAP_BUNDLED=1 and re-run `npx cap sync ios`.
 */
const bundled = process.env.PHONEHOME_CAP_BUNDLED === '1';
const liveUrl = process.env.PHONEHOME_CAP_URL || 'https://y5876647.eero.online:8443';

const config: CapacitorConfig = {
  appId: 'app.phonehome.ios',
  appName: 'PhoneHome',
  webDir: '../web/public',
  ...(bundled
    ? {}
    : {
        server: {
          url: liveUrl,
          cleartext: false,
        },
      }),
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
  },
};

export default config;
