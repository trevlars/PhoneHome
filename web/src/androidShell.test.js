import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(here, "app.js"), "utf8");

test("splash sign-in on a bundled app opens the Mothership URL step", () => {
  const fn = appSource.slice(
    appSource.indexOf("function skipSplashToSignIn"),
    appSource.indexOf("function splashHomescreenHtml")
  );
  assert.match(fn, /shouldConnectMothershipAfterTutorial\(\)/);
  assert.match(fn, /state\.screen = "mothership-url"/);
  const gate = fn.indexOf('state.screen = "mothership-url"');
  const welcome = fn.indexOf('state.screen = "welcome"');
  assert.ok(gate !== -1 && welcome !== -1 && gate < welcome);
});

test("android shell answers with in-process WebRTC", () => {
  assert.match(appSource, /function isNativeAndroidShell\(\)/);
  assert.match(appSource, /function isNativePhoneShell\(\)/);
  assert.match(appSource, /function usesNativeCallMedia\(\)/);
  assert.match(appSource, /return isNativePhoneShell\(\) && callKitOwnsUi\(\)/);
  assert.match(appSource, /return callKitEnabled\(\) && isNativePhoneShell\(\)/);
  const accept = appSource.slice(
    appSource.indexOf("async function acceptCallFromCallKit"),
    appSource.indexOf("async function registerIosVoipToken")
  );
  assert.doesNotMatch(accept, /await acceptCall\(\)/);
  assert.match(accept, /acceptCallViaNativeMedia/);
});

test("android registers an FCM token and does not hard-release the WebView mic", () => {
  assert.match(appSource, /async function registerAndroidFcmToken/);
  assert.match(appSource, /\/api\/devices\/fcm-token/);
  assert.match(appSource, /platform: "android"/);
  const refresh = appSource.slice(
    appSource.indexOf("async function refreshCallKitUplinkMic"),
    appSource.indexOf("function armCallKitUplinkRetries")
  );
  assert.match(refresh, /if \(!isNativeIosShell\(\)/);
});
