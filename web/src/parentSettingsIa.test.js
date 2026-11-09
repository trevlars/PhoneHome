import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appJs = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("app.js parses (node --check equivalent via vm.Script)", () => {
  const stripped = appJs.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm, "");
  assert.doesNotMatch(stripped.slice(0, 200), /^import\b/m);
  new vm.Script(stripped, { filename: "app.js" });
});

test("Parent settings IA teaches Pod vs Circle in the menu, not only Help", () => {
  assert.match(appJs, /This family \(Pod\)/);
  assert.match(appJs, /Kids &amp; Circles/);
  assert.match(appJs, /This child’s Circle/);
  assert.match(appJs, /Who are you adding\?/);
  assert.match(appJs, /id="go-invite-family"/);
  assert.match(appJs, /id="go-invite-friend"/);
  assert.match(appJs, /id="go-invite-grandparent"/);
  assert.match(appJs, /"join",\s*"invite"/);
  assert.doesNotMatch(appJs, /name="invite-kind"/);
  assert.match(appJs, /Grandma or Grandpa/);
  assert.match(appJs, /Sister, brother, or in-law/);
  assert.doesNotMatch(appJs, /Sibling or cousin/);
  assert.match(appJs, /you create it, they sign in|You make their login/);
  assert.doesNotMatch(
    appJs,
    /go-invite-grandparent[\s\S]{0,120}state\.screen = "invite"/
  );
  assert.match(appJs, /go-invite-grandparent[\s\S]{0,160}gp-setup-form/);
  assert.match(appJs, /familyInviteShared|markFamilyInviteShared/);
  assert.match(appJs, /share-gp-login/);
  assert.match(appJs, /Create &amp; text login/);
  assert.match(appJs, /showAddPeopleSheet/);
  assert.match(appJs, /growCircleBannerHtml/);
  assert.match(appJs, /grandparents — any parent in this family can edit|Any parent in this family can Manage/);
  assert.match(appJs, /not a shared family phone book/);
  assert.match(appJs, /\$\{kidLabel\}’s Circle/);
  assert.doesNotMatch(appJs, /Invite into my circle/);
  assert.doesNotMatch(appJs, /Your people, invites, and which lists kids can call/);
  assert.doesNotMatch(appJs, /parentGroupLabel\("people"/);
  assert.doesNotMatch(appJs, /parentGroupLabel\("house"/);
  assert.doesNotMatch(appJs, /Simple version/);
  assert.match(appJs, /Grandparent phone \(recommended\)/);
});

test("Mothership is its own Parent accordion, operators only", () => {
  assert.match(appJs, /"parent-mothership"/);
  assert.match(appJs, /id="parent-mothership"/);
  assert.match(appJs, /const isMsOperator = Boolean\(state\.mothership\?\.is_operator\)/);
  assert.match(appJs, /isMsOperator[\s\S]{0,80}parent-mothership/);
  assert.match(appJs, /parentSecToggle\(\s*"parent-mothership"/);
  assert.match(appJs, /case "mothership":\s*return mothershipGlyphHtml/);
  // Admin entry lives in the Mothership accordion, not nested under Account.
  const accountSec = appJs.match(
    /id="parent-account"[\s\S]*?id="parent-account-body"[\s\S]*?<\/section>/
  );
  assert.ok(accountSec, "parent-account section exists");
  assert.doesNotMatch(accountSec[0], /open-mothership-admin/);
  assert.doesNotMatch(accountSec[0], /mothership-operator-entry/);
});

test("Parent jump chips follow Pod then Circle", () => {
  const nav = appJs.match(/<nav class="parent-jump"[\s\S]*?<\/nav>/);
  assert.ok(nav, "parent jump nav exists");
  const chips = [...nav[0].matchAll(/<a href="#[^"]+">([^<]+)/g)].map((m) => m[1].trim());
  assert.equal(chips[0], "This family");
  assert.ok(chips.includes("Kids"));
  assert.ok(chips.includes("Circle"));
  assert.ok(chips.includes("Invite"));
  assert.ok(chips.includes("Grandparents"));
  assert.ok(chips.includes("Analog"));
  assert.ok(!chips.includes("Contacts"));
  assert.ok(!chips.includes("Co-parents"));
});

test("grandparent Settings is grandparents only — not inferred from a kid-less parent Pod", () => {
  const fn = appJs.match(
    /function isGrandparentExperience\(\) \{[\s\S]*?\n\}/
  );
  assert.ok(fn, "isGrandparentExperience exists");
  assert.match(fn[0], /role === "grandparent"/);
  assert.match(fn[0], /state\.grandparentPad/);
  assert.doesNotMatch(fn[0], /householdKidLines\(hh\)\.length === 0/);
});

test("grandparent Settings includes Quiet Time hours for their own phone", () => {
  assert.match(appJs, /id="gp-quiet-hours"/);
  assert.match(appJs, /<h2 class="gp-card-title">Quiet Time hours<\/h2>/);
  assert.match(appJs, /Evenings are 9pm–7am/);
  assert.match(appJs, /parent_schedule_preset \|\| "evenings"/);
});

test("Accessibility settings exist for Parent and grandparent phones", () => {
  assert.match(appJs, /"parent-a11y"/);
  assert.match(appJs, /id="parent-a11y"/);
  assert.match(appJs, /function a11ySettingsControlsHtml/);
  assert.match(appJs, /function bindA11ySettings/);
  assert.match(appJs, /kl_a11y_v1/);
  assert.match(appJs, /data-a11y-text/);
  assert.match(appJs, /data-a11y-motion/);
  assert.match(appJs, /id="a11y-targets"/);
  assert.match(appJs, /id="a11y-links"/);
  assert.match(appJs, /id="a11y-focus"/);
  assert.match(appJs, /id="gp-accessibility"/);
  assert.match(appJs, /Easier to read/);
  const nav = appJs.match(/<nav class="parent-jump"[\s\S]*?<\/nav>/);
  assert.ok(nav, "parent jump nav exists");
  assert.match(nav[0], /Accessibility/);
  const appCss = fs.readFileSync(new URL("./app.css", import.meta.url), "utf8");
  assert.match(appCss, /\.skip-link/);
  assert.match(appCss, /html\[data-a11y-text="large"\]/);
  assert.match(appCss, /html\[data-a11y-motion="reduce"\]/);
  assert.match(appCss, /html\[data-a11y-targets="1"\]/);
  const indexHtml = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(indexHtml, /id="app"/);
  assert.match(indexHtml, /skip-link/);
  assert.doesNotMatch(indexHtml, /user-scalable\s*=\s*no/);
  assert.doesNotMatch(indexHtml, /maximum-scale\s*=\s*1/);
});

test("native iOS settings avoid WKWebView touch-freeze paths", () => {
  assert.match(appJs, /function isNativeSettingsSurface\(\)/);
  assert.match(appJs, /if \(isNativeSettingsSurface\(\)\) return false;/);
  assert.match(appJs, /if \(isNativeSettingsSurface\(\)\) return;/);
  const sectionScroll = appJs.match(/function scrollSettingsSectionToTop\(el\) \{[\s\S]*?\n\}/);
  assert.ok(sectionScroll, "scrollSettingsSectionToTop exists");
  assert.match(sectionScroll[0], /if \(!el \|\| isNativeSettingsSurface\(\)\) return;/);
  assert.match(appJs, /function syncParentCatFilter\(\)/);
  assert.match(appJs, /parent-cat-hidden/);
  assert.match(appJs, /parentCatFilter/);
  assert.match(
    appJs,
    /querySelectorAll\("\.parent-jump a"\)\.forEach\(\(a\) => \{\s*a\.addEventListener\("click"[\s\S]{0,800}syncParentCatFilter\(\);/
  );
  assert.match(appJs, /focusDownload\) \{\s*if \(!isNativeSettingsSurface\(\)/);
});

test("in-app site links ignore same-page hash anchors (Parent / Profile jump chips)", () => {
  assert.match(appJs, /function inAppSiteUrl\(href\)/);
  assert.match(appJs, /raw\.startsWith\("#"\)/);
  assert.match(
    appJs,
    /url\.pathname === location\.pathname[\s\S]{0,80}url\.search === location\.search/
  );
});

test("grandparent setup board is sign-in + family only (no Silence / house phone homework)", () => {
  const fn = appJs.match(/function grandparentSetupSteps\([\s\S]*?\n\}/);
  assert.ok(fn, "grandparentSetupSteps exists");
  assert.match(fn[0], /id: "account"/);
  assert.match(fn[0], /id: "family"/);
  assert.doesNotMatch(fn[0], /id: "quiet"/);
  assert.doesNotMatch(fn[0], /id: "analog"/);
  assert.match(fn[0], /approvalStatus\(gc\)\.ready/);
  assert.doesNotMatch(fn[0], /gc\.mutual \|\| gc\.home_grandchild/);
});

test("grandparent Skip dismisses home setup banner; short How it works path exists", () => {
  assert.match(appJs, /const GP_TUTORIAL_SLIDES/);
  assert.match(appJs, /function prefersGrandparentTutorial/);
  assert.match(appJs, /setupChecklistDismissed\(\) && !state\.setupForceShow/);
  assert.match(appJs, /isGrandparentExperience\(\)[\s\S]{0,80}persistHowItWorksDoneToDevice/);
  assert.match(appJs, /gpPad && !pending\.length && !shouldShowSetupBanner/);
  const appCss = fs.readFileSync(new URL("./app.css", import.meta.url), "utf8");
  assert.match(appCss, /\.setup-board\.gp-setup-board[\s\S]{0,200}overflow-wrap:\s*break-word/);
  assert.match(appCss, /\.setup-board\.gp-setup-board \.setup-board-actions[\s\S]{0,120}position:\s*static/);
});
