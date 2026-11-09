import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeIvrText } from "./ivrText.mjs";
import { isIvrBargeInDigit, normalizeIvrIntKeys } from "./ivrBargeIn.mjs";

test("grandparents menu dialplan reads a Piper URL instead of ARI playback", () => {
  const conf = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "freepbx", "extensions_custom.conf"),
    "utf8"
  );
  const block = conf.slice(conf.indexOf("[phonehome-ivr-say]"));
  assert.match(block, /GotoIf\(\$\["\$\{PH_IVR_MEDIA\}" != ""\]\?piper\)/);
  assert.match(block, /Read\(PH_IVR_DIGIT,\$\{PH_IVR_MEDIA\},1,,1,12\)/);
  assert.match(block, /Stasis\(phonehome,post-ivr-say,\$\{PH_IVR_DIGIT\},\$\{READSTATUS\}\)/);
});

test("IVR barge-in intkeys normalize and match menu digits", () => {
  assert.equal(normalizeIvrIntKeys(true), "123456789");
  assert.equal(normalizeIvrIntKeys("123"), "123");
  assert.equal(normalizeIvrIntKeys(null), "");
  assert.equal(isIvrBargeInDigit("3", "123456789"), true);
  assert.equal(isIvrBargeInDigit("0", "123456789"), false);
  assert.equal(isIvrBargeInDigit("3", null), false);
});

test("grandparents menu prompt keeps all press-digit clauses", () => {
  const prompt =
    "To call Gramma East, press 1. To call Grandma North, press 2. To call Papa East, press 3.";
  const out = sanitizeIvrText(prompt);
  assert.equal(out, prompt);
  assert.match(out, /press 1/);
  assert.match(out, /press 2/);
  assert.match(out, /press 3/);
  assert.match(out, /Gramma East/);
  assert.match(out, /Grandma North/);
  assert.match(out, /Papa East/);
});

test("long multi-GP menu is not cut at the old 180-char Flite cap", () => {
  const choices = Array.from({ length: 6 }, (_, i) => ({
    label: `Grandparent Name ${i + 1}`,
    digit: i + 1,
  }));
  const prompt = choices.map((c) => `To call ${c.label}, press ${c.digit}.`).join(" ");
  assert.ok(prompt.length > 180);
  const out = sanitizeIvrText(prompt);
  assert.ok(out.length > 180);
  assert.match(out, /press 6/);
  assert.match(out, /Grandparent Name 6/);
});
