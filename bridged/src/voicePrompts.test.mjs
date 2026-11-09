import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVoicePrompts } from "./voicePrompts.mjs";

test("playPrompt returns false when HTTP Piper playback fails", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ph-prompt-"));
  const wav = path.join(tmp, "menu-main.wav");
  fs.writeFileSync(wav, "not-a-wav");

  const prompts = createVoicePrompts({
    soundsDir: tmp,
    mediaBaseUrl: "http://127.0.0.1:8790",
    mediaTokens: new Map(),
    playMediaUri: async () => false,
  });

  const channel = { id: "ch-test" };
  const ok = await prompts.playPrompt(channel, "menu-main");
  assert.equal(ok, false);
});

test("countPromptFlite covers unread and empty inbox", () => {
  const prompts = createVoicePrompts({
    soundsDir: "/nonexistent",
    mediaBaseUrl: "http://127.0.0.1:8790",
    mediaTokens: new Map(),
    playMediaUri: async () => true,
  });

  assert.equal(prompts.countPromptFlite(0, 0), "You have no messages.");
  assert.equal(prompts.countPromptFlite(1, 1), "You have 1 new message.");
  assert.match(prompts.countPromptFlite(3, 5), /3 new messages/);
});
