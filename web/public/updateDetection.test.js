import assert from "node:assert/strict";
import test from "node:test";
import {
  appBuildVersionFromHtml,
  appBuildVersionFromModuleUrl,
  compareBuildVersions,
  isNewerBuildVersion,
  webUpdateDecision,
} from "./updateDetection.js";

test("extracts build tokens from module and fresh index URLs", () => {
  assert.equal(
    appBuildVersionFromModuleUrl("https://example.test/app.js?v=muior8pa"),
    "muior8pa"
  );
  assert.equal(
    appBuildVersionFromHtml(
      '<script type="module" src="/app.js?v=muior9zz"></script>',
      "https://example.test/"
    ),
    "muior9zz"
  );
  assert.equal(appBuildVersionFromHtml("<html></html>"), "");
});

test("compares timestamp-derived base36 build versions chronologically", () => {
  assert.equal(compareBuildVersions("muior8pa", "muior8pa"), 0);
  assert.equal(compareBuildVersions("muior8pa", "muior9zz"), -1);
  assert.equal(compareBuildVersions("muior9zz", "muior8pa"), 1);
  assert.equal(isNewerBuildVersion("muior8pa", "muior9zz"), true);
  assert.equal(isNewerBuildVersion("muior9zz", "muior8pa"), false);
  assert.equal(compareBuildVersions("", "muior9zz"), null);
});

test("defers updates while media is active and reloads once idle", () => {
  assert.equal(
    webUpdateDecision({
      currentVersion: "muior8pa",
      availableVersion: "muior9zz",
      busy: true,
    }),
    "defer"
  );
  assert.equal(
    webUpdateDecision({
      currentVersion: "muior8pa",
      availableVersion: "muior8pa",
      pending: true,
      busy: false,
    }),
    "reload"
  );
  assert.equal(
    webUpdateDecision({
      currentVersion: "muior8pa",
      availableVersion: "muior9zz",
      reloading: true,
    }),
    "none"
  );
});
