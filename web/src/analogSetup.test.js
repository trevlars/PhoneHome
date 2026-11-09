import assert from "node:assert/strict";
import test from "node:test";
import {
  analogHomeCtaCopy,
  analogNeedsConfigDownload,
  analogSetupStepState,
  ataConfigSeen,
  ataStatusIsWorking,
  lineHasAtaSaved,
} from "./analogSetup.js";

const savedLine = {
  ata: { sip_extension: "1201", has_sip_password: true },
};

test("lineHasAtaSaved requires extension + password flag", () => {
  assert.equal(lineHasAtaSaved(savedLine), true);
  assert.equal(lineHasAtaSaved({ ata: { sip_extension: "1" } }), false);
  assert.equal(lineHasAtaSaved({}), false);
});

test("analogNeedsConfigDownload when saved but box never got settings", () => {
  assert.equal(analogNeedsConfigDownload(savedLine, null), true);
  assert.equal(analogNeedsConfigDownload(savedLine, { status: "offline" }), true);
  assert.equal(
    analogNeedsConfigDownload(savedLine, { status: "online", registered: true }),
    false
  );
  assert.equal(
    analogNeedsConfigDownload(savedLine, { status: "offline", phase: "waiting" }),
    false
  );
  assert.equal(
    analogNeedsConfigDownload(savedLine, {
      status: "offline",
      config_seen: true,
    }),
    false
  );
});

test("ataConfigSeen from status or line metadata", () => {
  assert.equal(ataConfigSeen(savedLine, null), false);
  assert.equal(ataConfigSeen({ ata: { last_config_download_at: "x" } }, null), true);
  assert.equal(ataConfigSeen(savedLine, { config_seen: true }), true);
});

test("analogSetupStepState tracks Save → Download → Upload", () => {
  assert.deepEqual(analogSetupStepState({}, null), { active: 1, completed: [] });
  assert.deepEqual(analogSetupStepState(savedLine, null), {
    active: 2,
    completed: [1],
  });
  assert.deepEqual(
    analogSetupStepState(savedLine, { status: "offline", config_seen: true }),
    { active: 3, completed: [1, 2] }
  );
  assert.deepEqual(
    analogSetupStepState(savedLine, { status: "online", registered: true }),
    { active: 0, completed: [1, 2, 3] }
  );
});

test("analogHomeCtaCopy highlights Download for needs-download", () => {
  const cta = analogHomeCtaCopy("needs-download");
  assert.match(cta.label, /Download config file/);
  assert.equal(cta.cls, "needs-download");
});

test("ataStatusIsWorking requires registered online", () => {
  assert.equal(ataStatusIsWorking({ status: "online", registered: true }), true);
  assert.equal(ataStatusIsWorking({ status: "online", registered: false }), false);
});
