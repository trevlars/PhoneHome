/**
 * "Call from {name}" for the analog handset on softphone→ATA calls.
 *
 * The phrase leaves the bridge as ordinary caller PCMU through the 20 ms
 * ExternalMedia pacer, in place of the softphone mic, so Asterisk and the HT801
 * see one unchanged RTP stream. Never Asterisk playback on this leg:
 * channel.play and bridge announcers in the FXS+ExternalMedia bridge wedged
 * HT801 SDES and buzzed every call (d29244e, 030256a).
 */

export const HANDSET_FRAME_BYTES = 160;
/** −6 dBFS. Piper renders peaks at 0 dBFS. */
export const HANDSET_PROMPT_PEAK = 16384;
const SAMPLES_PER_FRAME = 160;
/** 200 ms for the handset to reach the ear after pickup. */
const LEAD_FRAMES = 10;
/** 5 ms ramps so the trimmed edges do not click. */
const FADE_SAMPLES = 40;
/** −40 dBFS: Piper's leading/trailing silence. */
const EDGE_THRESHOLD = 328;

/**
 * HANDSET_CALLER_ANNOUNCE: "off" or empty disables, "all" enables every line,
 * anything else is a comma/space list of FXS extensions. bridged defaults to "all".
 */
export function handsetPromptEnabled(setting, extension) {
  const value = String(setting ?? "").trim().toLowerCase();
  if (!value || value === "off") return false;
  if (value === "all") return true;
  return value.split(/[\s,]+/).includes(String(extension));
}

/** 8 kHz mono 16-bit PCM WAV → samples; null for any other format. */
export function wavPcm16(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let fmtOk = false;
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= buf.length) {
      fmtOk =
        buf.readUInt16LE(body) === 1 &&
        buf.readUInt16LE(body + 2) === 1 &&
        buf.readUInt32LE(body + 4) === 8000 &&
        buf.readUInt16LE(body + 14) === 16;
    } else if (id === "data") {
      if (!fmtOk) return null;
      const end = Math.min(buf.length, body + size);
      const out = new Int16Array(Math.floor((end - body) / 2));
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(body + i * 2);
      return out;
    }
    off = body + size + (size & 1);
  }
  return null;
}

/**
 * Trim silent edges, attenuate to HANDSET_PROMPT_PEAK (never amplify), ramp
 * the edges, and cut into 20 ms µ-law frames behind a short silent lead-in.
 * @param {Int16Array} pcm 8 kHz samples
 * @param {(pcm: Int16Array) => Buffer} encodeUlaw
 * @returns {Buffer[]}
 */
export function handsetPromptFrames(pcm, encodeUlaw) {
  let start = 0;
  let end = pcm.length;
  while (start < end && Math.abs(pcm[start]) < EDGE_THRESHOLD) start++;
  while (end > start && Math.abs(pcm[end - 1]) < EDGE_THRESHOLD) end--;
  if (end <= start) return [];
  start = Math.max(0, start - SAMPLES_PER_FRAME);
  end = Math.min(pcm.length, end + SAMPLES_PER_FRAME);

  let peak = 0;
  for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  const gain = Math.min(1, HANDSET_PROMPT_PEAK / peak);
  const voiced = end - start;
  const fade = Math.min(FADE_SAMPLES, Math.floor(voiced / 2));
  const lead = LEAD_FRAMES * SAMPLES_PER_FRAME;
  const out = new Int16Array(lead + Math.ceil(voiced / SAMPLES_PER_FRAME) * SAMPLES_PER_FRAME);
  for (let i = 0; i < voiced; i++) {
    let g = gain;
    if (i < fade) g *= i / fade;
    else if (voiced - 1 - i < fade) g *= (voiced - 1 - i) / fade;
    out[lead + i] = Math.round(pcm[start + i] * g);
  }

  const ulaw = encodeUlaw(out);
  const frames = [];
  for (let off = 0; off < ulaw.length; off += HANDSET_FRAME_BYTES) {
    frames.push(Buffer.from(ulaw.subarray(off, off + HANDSET_FRAME_BYTES)));
  }
  return frames;
}

/**
 * Next frame for the pacer. A handset prompt replaces queued caller audio until
 * it runs out; the sender drops mic frames meanwhile, so the two never
 * interleave on the one RTP stream.
 * @returns {{ frame: Buffer | undefined, prompt: boolean }}
 */
export function nextPacerFrame(session) {
  const prompt = session._handsetPrompt;
  if (prompt) {
    const frame = prompt.frames[prompt.next++];
    if (prompt.next >= prompt.frames.length) session._handsetPrompt = null;
    if (frame) return { frame, prompt: true };
  }
  return { frame: session._pcmuQueue?.shift(), prompt: false };
}
