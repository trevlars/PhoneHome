import type { CapacitorConfig } from '@capacitor/cli';

/**
 * PhoneHome iOS shell (Capacitor).
 *
 * Default: load the live HTTPS softphone so auth/cookies match the hub.
 * For offline/bundled QA, set PHONEHOME_CAP_BUNDLED=1 and re-run `npx cap sync ios`.
 */
const bundled = process.env.PHONEHOME_CAP_BUNDLED === '1';
// Set PHONEHOME_CAP_URL to your hub's PUBLIC_BASE_URL before `npx cap sync ios`.
const liveUrl = process.env.PHONEHOME_CAP_URL || '';

const config: CapacitorConfig = {
  appId: 'app.phonehome.ios',
  appName: 'PhoneHome',
  webDir: '../web/public',
  ...(!bundled && liveUrl
    ? {
        server: {
          url: liveUrl,
          cleartext: false,
        },
      }
    : {}),
  ios: {
    // CSS owns safe-area insets (env()). "automatic" double-pads the WebView on notch phones.
    contentInset: 'never',
    preferredContentMode: 'mobile',
    backgroundColor: '#16241e',
  },
};

export default config;
