import type { CapacitorConfig } from '@capacitor/cli';

/**
 * PhoneHome native shell (Capacitor). iOS bundle id stays app.phonehome.ios.
 * Android applicationId is app.phonehome.android (set in android/app/build.gradle).
 *
 * Default: ship the bundled softphone. Parents enter their Mothership HTTPS
 * URL once (stored in UserDefaults). Optional PHONEHOME_CAP_URL only seeds
 * that preference for lab/dev installs — it is not required to change hubs.
 *
 * For offline-only QA without a hub: PHONEHOME_CAP_BUNDLED=1 (same as default).
 */
const bundled = process.env.PHONEHOME_CAP_BUNDLED === '1';
// Optional lab seed — written into UserDefaults on first launch if unset.
const liveUrl = (!bundled && process.env.PHONEHOME_CAP_URL?.trim()) || '';

const config: CapacitorConfig = {
  appId: 'app.phonehome.ios',
  appName: 'PhoneHome',
  webDir: '../web/public',
  server: {
    // Keep Cap bridge / CallKit JS when the WebView navigates to a self-hosted hub.
    allowNavigation: [
      '*',
      '*.duckdns.org',
      '*.trycloudflare.com',
    ],
    // Dev seed only — production/TestFlight builds omit this so URL is user-chosen.
    ...(liveUrl
      ? {
          url: liveUrl,
          cleartext: false,
        }
      : {}),
  },
  ios: {
    // CSS owns safe-area insets (env()). "automatic" double-pads the WebView on notch phones.
    contentInset: 'never',
    preferredContentMode: 'mobile',
    backgroundColor: '#0c1814',
  },
  android: {
    backgroundColor: '#0c1814',
    allowMixedContent: false,
  },
};

export default config;
