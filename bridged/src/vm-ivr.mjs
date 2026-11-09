/**
 * ATA *98 Messages / greeting IVR (PhoneHome inbox — not FreePBX Comedian Mail).
 *
 * Entry (no personal greeting):
 *   1) “You have N new messages” / “You have no messages”
 *   2) “Press 1 for messages. Press 2 for greetings.” (once, then wait)
 * Greetings submenu: “Press 1 to record your greeting. Press 2 to play it. Press 3 to clear it.”
 * After record (Asterisk vm-review): 1 = save, 2 = listen, 3 = re-record
 * While listening: 4 = replay, 7 = delete, 9 = keep, # = next
 *
 * Spoken menus use pre-rendered Piper (amy) WAVs under bridged/sounds/.
 * Message audio is PhoneHome WAV via HTTP media (requires FreePBX /var/cache/asterisk).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * @param {object} deps
 * @param {(path: string, opts?: object) => Promise<any>} deps.phFetch
 * @param {string} deps.ariUrl
 * @param {string} deps.ariUser
 * @param {string} deps.ariPass
 * @param {string} deps.mediaBaseUrl  e.g. http://192.168.2.106:8790
 * @param {Map<string, { filePath: string, expires: number }>} deps.mediaTokens
 * @param {(channel: any, key: string) => Promise<boolean>} deps.playPrompt  Piper clip
 * @param {(unread: number, total: number) => string} deps.countPromptKey
 * @param {(unread: number, total: number) => string} [deps.countPromptFlite]
 * @param {(channel: any, text: string) => Promise<void>} [deps.sayText]  Flite fallback only
 */
export function createVmIvr(deps) {
  const {
    phFetch,
    ariUrl,
    ariUser,
    ariPass,
    mediaBaseUrl,
    mediaTokens,
    playPrompt,
    countPromptKey,
    countPromptFlite,
    sayText,
  } = deps;

  function registerMediaFile(filePath, ttlMs = 120_000) {
    const token = randomBytes(16).toString("hex");
    mediaTokens.set(token, { filePath, expires: Date.now() + ttlMs });
    return `${mediaBaseUrl.replace(/\/$/, "")}/media/${token}.wav`;
  }

  async function ensureWavFile(buf, contentType, hint) {
    const ct = String(contentType || "").toLowerCase();
    const tmpDir = path.join(os.tmpdir(), "phonehome-ivr");
    fs.mkdirSync(tmpDir, { recursive: true });
    const base = `${hint || "audio"}-${Date.now()}-${randomBytes(4).toString("hex")}`;
    if (ct.includes("wav") || ct.includes("wave")) {
      const out = path.join(tmpDir, `${base}.wav`);
      fs.writeFileSync(out, buf);
      return out;
    }
    const ext = ct.includes("ogg")
      ? "ogg"
      : ct.includes("mp4") || ct.includes("m4a")
        ? "m4a"
        : ct.includes("webm")
          ? "webm"
          : "bin";
    const src = path.join(tmpDir, `${base}.${ext}`);
    const out = path.join(tmpDir, `${base}.wav`);
    fs.writeFileSync(src, buf);
    const r = spawnSync(
      "ffmpeg",
      ["-y", "-i", src, "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", out],
      { encoding: "utf8" }
    );
    try {
      fs.unlinkSync(src);
    } catch {}
    if (r.status !== 0 || !fs.existsSync(out)) {
      throw new Error(`ffmpeg convert failed: ${r.stderr || r.stdout || "unknown"}`);
    }
    return out;
  }

  async function phGetBuffer(apiPath) {
    const base = (deps.phUrl || "").replace(/\/$/, "");
    const res = await fetch(`${base}${apiPath}`, {
      headers: { Authorization: `Bearer ${deps.bridgeSecret}` },
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
  }

  function playFinished(playback, timeoutMs = 90_000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        cleanup();
        resolve("timeout");
      }, timeoutMs);
      const onFin = () => {
        cleanup();
        resolve("finished");
      };
      const onFail = () => {
        cleanup();
        resolve("failed");
      };
      function cleanup() {
        clearTimeout(t);
        try {
          playback.removeListener("PlaybackFinished", onFin);
        } catch {}
        try {
          playback.removeListener("PlaybackFailed", onFail);
        } catch {}
      }
      playback.once("PlaybackFinished", onFin);
      playback.once("PlaybackFailed", onFail);
    });
  }

  async function playMedia(channel, media, timeoutMs = 90_000) {
    const playback = await channel.play({ media });
    return playFinished(playback, timeoutMs);
  }

  async function say(channel, key, fliteFallback) {
    const ok = await playPrompt(channel, key);
    if (ok) return;
    if (sayText && fliteFallback) await sayText(channel, fliteFallback);
  }

  function waitDigit(channel, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        channel.removeListener("ChannelDtmfReceived", handler);
        resolve(null);
      }, timeoutMs);
      function handler(event) {
        clearTimeout(t);
        channel.removeListener("ChannelDtmfReceived", handler);
        resolve(String(event.digit || ""));
      }
      channel.on("ChannelDtmfReceived", handler);
    });
  }

  /** Speak a Piper menu clip, then wait for one digit (listener active during prompt). */
  async function gatherMenu(channel, promptKey, timeoutMs = 10000, fliteFallback) {
    const digitPromise = waitDigit(channel, timeoutMs);
    await say(channel, promptKey, fliteFallback);
    return digitPromise;
  }

  async function ariGetRecordingFile(name) {
    const auth = Buffer.from(`${ariUser}:${ariPass}`).toString("base64");
    const url = `${ariUrl.replace(/\/$/, "")}/ari/recordings/stored/${encodeURIComponent(name)}/file`;
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`ARI recording fetch ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async function ariDeleteRecording(name) {
    const auth = Buffer.from(`${ariUser}:${ariPass}`).toString("base64");
    const url = `${ariUrl.replace(/\/$/, "")}/ari/recordings/stored/${encodeURIComponent(name)}`;
    try {
      await fetch(url, { method: "DELETE", headers: { Authorization: `Basic ${auth}` } });
    } catch {}
  }

  function recordFinished(rec) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        cleanup();
        resolve("timeout");
      }, 90_000);
      const onFin = () => {
        cleanup();
        resolve("finished");
      };
      const onFail = (err) => {
        cleanup();
        reject(err || new Error("record failed"));
      };
      function cleanup() {
        clearTimeout(t);
        try {
          rec.removeListener("RecordingFinished", onFin);
        } catch {}
        try {
          rec.removeListener("RecordingFailed", onFail);
        } catch {}
      }
      rec.once("RecordingFinished", onFin);
      rec.once("RecordingFailed", onFail);
    });
  }

  async function playHttpWav(channel, wavPath) {
    const url = registerMediaFile(wavPath);
    return playMedia(channel, `sound:${url}`, 120_000);
  }

  async function playPhoneHomeAudio(channel, apiPath, hint) {
    const { buf, contentType } = await phGetBuffer(apiPath);
    const wav = await ensureWavFile(buf, contentType, hint);
    try {
      return await playHttpWav(channel, wav);
    } finally {
      setTimeout(() => {
        try {
          fs.unlinkSync(wav);
        } catch {}
      }, 180_000);
    }
  }

  async function greetingSubmenu(channel, mailbox) {
    while (true) {
      const digit = await gatherMenu(
        channel,
        "menu-greeting",
        10000,
        "Press 1 to record your greeting. Press 2 to play it. Press 3 to clear it."
      );
      if (!digit || digit === "*" || digit === "#") return;
      if (digit === "2") {
        if (!mailbox.hasGreeting) {
          await say(channel, "no-greeting", "There is no custom greeting. Using the default.");
          continue;
        }
        try {
          await playPhoneHomeAudio(
            channel,
            `/api/bridge/lines/${mailbox.lineId}/greeting`,
            `greet-${mailbox.lineId}`
          );
        } catch (e) {
          console.error("[bridged] play greeting failed:", e.message || e);
          await say(channel, "sorry-play", "Sorry. Could not play the greeting.");
        }
        continue;
      }
      if (digit === "3") {
        try {
          await phFetch(`/api/bridge/lines/${mailbox.lineId}/greeting`, { method: "DELETE" });
          mailbox.hasGreeting = false;
          await say(channel, "greeting-cleared", "Greeting cleared.");
        } catch {
          await say(channel, "sorry", "Sorry.");
        }
        continue;
      }
      if (digit === "1") {
        await recordGreetingFlow(channel, mailbox);
        continue;
      }
    }
  }

  async function recordGreetingFlow(channel, mailbox) {
    while (true) {
      await say(
        channel,
        "record-greeting",
        "Record your greeting after the beep. Press pound when finished."
      );
      const recName = `ph-greet-${mailbox.lineId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}-${Date.now()}`;
      let rec;
      try {
        rec = await channel.record({
          name: recName,
          format: "wav",
          beep: true,
          ifExists: "overwrite",
          maxDurationSeconds: 60,
          maxSilenceSeconds: 4,
          terminateOn: "#",
        });
      } catch (e) {
        console.error("[bridged] record start failed:", e.message || e);
        await say(channel, "sorry-record", "Sorry. Could not record.");
        return;
      }
      await recordFinished(rec);

      review: while (true) {
        const choice = await gatherMenu(
          channel,
          "menu-review",
          10000,
          "Press 1 to save. Press 2 to listen. Press 3 to re-record."
        );
        if (choice === "2") {
          try {
            const buf = await ariGetRecordingFile(recName);
            const tmp = path.join(os.tmpdir(), "phonehome-ivr", `${recName}.wav`);
            fs.mkdirSync(path.dirname(tmp), { recursive: true });
            fs.writeFileSync(tmp, buf);
            await playHttpWav(channel, tmp);
          } catch (e) {
            console.error("[bridged] review listen failed:", e.message || e);
            await say(channel, "sorry", "Sorry.");
          }
          continue;
        }
        if (choice === "3") {
          await ariDeleteRecording(recName);
          break; // outer while → re-record
        }
        if (choice === "1" || choice === null) {
          try {
            const buf = await ariGetRecordingFile(recName);
            await phFetch(`/api/bridge/lines/${mailbox.lineId}/greeting`, {
              method: "PUT",
              body: JSON.stringify({
                audioBase64: buf.toString("base64"),
                audioMime: "audio/wav",
              }),
            });
            mailbox.hasGreeting = true;
            await say(channel, "greeting-saved", "Greeting saved.");
          } catch (e) {
            console.error("[bridged] save greeting failed:", e.message || e);
            await say(channel, "sorry-save", "Sorry. Could not save.");
          }
          await ariDeleteRecording(recName);
          return;
        }
        if (choice === "*" || choice === "#") {
          await ariDeleteRecording(recName);
          return;
        }
      }
    }
  }

  async function messagesPlayback(channel, mailbox) {
    let list;
    try {
      const body = await phFetch(`/api/bridge/lines/${mailbox.lineId}/voicemails`);
      list = body.voicemails || [];
    } catch (e) {
      console.error("[bridged] list voicemails failed:", e.message || e);
      await say(channel, "sorry-load", "Sorry. Could not load messages.");
      return;
    }
    if (!list.length) {
      await say(channel, "msgs-none", "You have no messages.");
      return;
    }

    const unread = list.filter((v) => !v.listened).length;
    if (unread > 0) {
      await say(
        channel,
        countPromptKey(unread, list.length),
        countPromptFlite ? countPromptFlite(unread, list.length) : null
      );
    } else {
      await say(channel, "playing-messages", "Playing your messages.");
    }

    for (const vm of list) {
      let digit = null;
      try {
        console.log(`[bridged] *98 playing voicemail ${vm.id}`);
        digit = await playPhoneHomeAudio(
          channel,
          `/api/bridge/voicemails/${vm.id}/audio`,
          `vm-${vm.id}`
        );
      } catch (e) {
        console.error(`[bridged] *98 play ${vm.id} failed:`, e.message || e);
        await say(channel, "sorry-play-msg", "Sorry. Could not play that message.");
        continue;
      }
      if (!digit) {
        digit = await gatherMenu(
          channel,
          "menu-message",
          6000,
          "Press 4 to replay. Press 7 to delete. Press 9 to keep."
        );
      }
      while (digit === "4") {
        try {
          digit = await playPhoneHomeAudio(
            channel,
            `/api/bridge/voicemails/${vm.id}/audio`,
            `vm-${vm.id}`
          );
        } catch {
          break;
        }
        if (!digit) {
          digit = await gatherMenu(
            channel,
            "menu-message",
            6000,
            "Press 4 to replay. Press 7 to delete. Press 9 to keep."
          );
        }
      }
      if (digit === "7") {
        try {
          await phFetch(`/api/bridge/voicemails/${vm.id}`, { method: "DELETE" });
          await say(channel, "message-deleted", "Message deleted.");
        } catch {
          await say(channel, "sorry", "Sorry.");
        }
        continue;
      }
      try {
        await phFetch(`/api/bridge/voicemails/${vm.id}/listen`, { method: "POST", body: "{}" });
      } catch {}
      if (digit === "*") return;
    }
    await say(channel, "no-more-messages", "No more messages.");
  }

  /**
   * @param {import("ari-client").Channel} channel
   * @param {string} sipExtension
   */
  async function runVoicemailIvr(channel, sipExtension) {
    await channel.answer();
    const mailbox = await phFetch("/api/bridge/mailbox", {
      method: "POST",
      body: JSON.stringify({ sipExtension }),
    });
    const box = {
      lineId: mailbox.lineId,
      householdId: mailbox.householdId,
      label: mailbox.label,
      hasGreeting: Boolean(mailbox.hasGreeting),
      unreadCount: Number(mailbox.unreadCount || 0),
      messageCount: Number(mailbox.messageCount || 0),
    };
    console.log(
      `[bridged] *98 IVR line=${box.lineId} unread=${box.unreadCount}/${box.messageCount} greeting=${box.hasGreeting}`
    );

    // Never play the line's personal greeting here (that is deposit/OGM only).
    await say(
      channel,
      countPromptKey(box.unreadCount, box.messageCount),
      countPromptFlite ? countPromptFlite(box.unreadCount, box.messageCount) : null
    );

    while (true) {
      const digit = await gatherMenu(
        channel,
        "menu-main",
        10000,
        "Press 1 for messages. Press 2 for greetings."
      );
      if (!digit || digit === "#" || digit === "*") {
        await say(channel, "goodbye", "Goodbye.");
        return;
      }
      if (digit === "1") {
        await messagesPlayback(channel, box);
        try {
          const again = await phFetch("/api/bridge/mailbox", {
            method: "POST",
            body: JSON.stringify({ sipExtension }),
          });
          box.unreadCount = Number(again.unreadCount || 0);
          box.messageCount = Number(again.messageCount || 0);
          box.hasGreeting = Boolean(again.hasGreeting);
        } catch {}
        continue;
      }
      if (digit === "2") {
        await greetingSubmenu(channel, box);
        continue;
      }
    }
  }

  /**
   * After unanswered ATA/softphone ring: play callee greeting (or default), record, save.
   * @param {import("ari-client").Channel} channel caller FXS (still in Stasis)
   * @param {{ fromLineId: string, toLineId: string, toLabel?: string }} opts
   */
  async function runNoAnswerDeposit(channel, opts) {
    const fromLineId = String(opts?.fromLineId || "");
    const toLineId = String(opts?.toLineId || "");
    const toLabel = String(opts?.toLabel || "them").slice(0, 40);
    if (!fromLineId || !toLineId) return;

    try {
      await channel.answer();
    } catch {}

    // Personal OGM if present; else a short default.
    let playedGreeting = false;
    try {
      const { buf, contentType } = await phGetBuffer(`/api/bridge/lines/${toLineId}/greeting`);
      const wav = await ensureWavFile(buf, contentType, `ogm-${toLineId}`);
      await playHttpWav(channel, wav);
      playedGreeting = true;
    } catch {
      /* no custom greeting */
    }
    if (!playedGreeting) {
      await say(
        channel,
        "no-answer-default",
        `Sorry. ${toLabel} is not available. Please leave a message after the beep.`
      );
    } else {
      await say(channel, "leave-message-beep", "Please leave a message after the beep.");
    }

    const recName = `ph-vm-${fromLineId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24)}-${Date.now()}`;
    let rec;
    try {
      rec = await channel.record({
        name: recName,
        format: "wav",
        beep: true,
        ifExists: "overwrite",
        maxDurationSeconds: 45,
        maxSilenceSeconds: 5,
        terminateOn: "#",
      });
    } catch (e) {
      console.error("[bridged] no-answer record start failed:", e.message || e);
      await say(channel, "sorry-record", "Sorry. Could not record.");
      return;
    }
    await recordFinished(rec);

    try {
      const buf = await ariGetRecordingFile(recName);
      if (!buf || buf.length < 64) {
        await say(channel, "sorry-short", "No message recorded.");
        await ariDeleteRecording(recName);
        return;
      }
      await phFetch("/api/bridge/voicemails", {
        method: "POST",
        body: JSON.stringify({
          fromLineId,
          toLineId,
          audioBase64: buf.toString("base64"),
          audioMime: "audio/wav",
        }),
      });
      await say(channel, "message-saved", "Message saved. Goodbye.");
      console.log(`[bridged] no-answer voicemail ${fromLineId}→${toLineId} (${buf.length}b)`);
    } catch (e) {
      console.error("[bridged] no-answer voicemail save failed:", e.message || e);
      await say(channel, "sorry-save", "Sorry. Could not save the message.");
    }
    await ariDeleteRecording(recName);
  }

  return { runVoicemailIvr, runNoAnswerDeposit, registerMediaFile };
}
