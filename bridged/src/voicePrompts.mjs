/**
 * Pre-rendered Piper (amy) prompts under bridged/sounds/.
 * Prefer these over Flite for FXS menus — neural TTS, no third-party cloud.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * @param {object} opts
 * @param {string} opts.soundsDir
 * @param {string} opts.mediaBaseUrl
 * @param {Map<string, { filePath: string, expires: number }>} opts.mediaTokens
 * @param {(channel: any, media: string) => Promise<void>} opts.playMediaUri
 */
export function createVoicePrompts(opts) {
  const { soundsDir, mediaBaseUrl, mediaTokens, playMediaUri } = opts;

  function promptPath(key) {
    const name = String(key || "").replace(/[^a-z0-9_-]/gi, "");
    if (!name) return null;
    const wav = path.join(soundsDir, `${name}.wav`);
    return fs.existsSync(wav) ? wav : null;
  }

  function registerMediaFile(filePath, ttlMs = 120_000) {
    const token = randomBytes(12).toString("hex");
    mediaTokens.set(token, { filePath, expires: Date.now() + ttlMs });
    return `${mediaBaseUrl.replace(/\/$/, "")}/media/${token}.wav`;
  }

  /**
   * Play a static Piper clip. Returns false if the file is missing.
   * @returns {Promise<boolean>}
   */
  async function playPrompt(channel, key) {
    const wav = promptPath(key);
    if (!wav) {
      console.warn(`[bridged] missing voice prompt: ${key}`);
      return false;
    }
    const url = registerMediaFile(wav);
    await playMediaUri(channel, `sound:${url}`);
    return true;
  }

  /** Map unread/total counts onto msgs-* clips. */
  function countPromptKey(unread, total) {
    const n = Math.max(0, Number(unread) || 0);
    const t = Math.max(0, Number(total) || 0);
    if (t === 0) return "msgs-none";
    if (n === 0) {
      // Heard-only inbox — still amy, not Flite.
      if (t === 1) return "msgs-heard-one";
      return "msgs-heard-many";
    }
    if (n === 1) return "msgs-one";
    if (n >= 2 && n <= 9) return `msgs-${n}`;
    return "msgs-many";
  }

  return { playPrompt, promptPath, countPromptKey };
}
