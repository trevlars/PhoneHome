import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HANDSET_FRAME_BYTES,
  HANDSET_PROMPT_PEAK,
  handsetPromptEnabled,
  handsetPromptFrames,
  nextPacerFrame,
  wavPcm16,
} from "./handsetPrompt.mjs";

function wav(samples, { rate = 8000, channels = 1, bits = 16, extraChunk = true } = {}) {
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE((rate * channels * bits) / 8, 16);
  fmt.writeUInt16LE((channels * bits) / 8, 20);
  fmt.writeUInt16LE(bits, 22);
  const list = Buffer.from("LIST\x05\x00\x00\x00INFOx\x00", "binary");
  const data = Buffer.alloc(8 + samples.length * 2);
  data.write("data", 0, "ascii");
  data.writeUInt32LE(samples.length * 2, 4);
  samples.forEach((s, i) => data.writeInt16LE(s, 8 + i * 2));
  const body = Buffer.concat([fmt, extraChunk ? list : Buffer.alloc(0), data]);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WAVE", 8, "ascii");
  return Buffer.concat([head, body]);
}

function tone(n, amplitude) {
  return Array.from({ length: n }, (_, i) => Math.round(amplitude * Math.sin((2 * Math.PI * 400 * i) / 8000)));
}

/** Records the PCM handed to the encoder; one byte per sample like µ-law. */
function recordingEncoder() {
  const seen = [];
  const encode = (pcm) => {
    seen.push(Int16Array.from(pcm));
    return Buffer.alloc(pcm.length, 0xff);
  };
  return { encode, seen };
}

test("HANDSET_CALLER_ANNOUNCE selects lines", () => {
  for (const off of [undefined, "", "off", "OFF", " "]) {
    assert.equal(handsetPromptEnabled(off, "2001"), false, `setting ${JSON.stringify(off)}`);
  }
  assert.equal(handsetPromptEnabled("all", "2003"), true);
  assert.equal(handsetPromptEnabled("2001", "2001"), true);
  assert.equal(handsetPromptEnabled("2001", "2002"), false);
  assert.equal(handsetPromptEnabled("2001, 2003", 2003), true);
  assert.equal(handsetPromptEnabled("20011", "2001"), false);
});

test("wavPcm16 reads ffmpeg-style WAVs and rejects other formats", () => {
  assert.deepEqual(Array.from(wavPcm16(wav([1, -2, 32767, -32768]))), [1, -2, 32767, -32768]);
  assert.deepEqual(Array.from(wavPcm16(wav([5], { extraChunk: false }))), [5]);
  assert.equal(wavPcm16(wav([1], { rate: 16000 })), null);
  assert.equal(wavPcm16(wav([1], { channels: 2 })), null);
  assert.equal(wavPcm16(Buffer.from("not a wav file at all")), null);
});

test("prompt frames trim silence, lead in, and stay at or below -6 dBFS", () => {
  const voiced = tone(1600, 32767);
  const { encode, seen } = recordingEncoder();
  const frames = handsetPromptFrames(Int16Array.from([...new Array(800).fill(0), ...voiced, ...new Array(800).fill(0)]), encode);

  assert.ok(frames.length > 0);
  assert.ok(frames.every((f) => f.length === HANDSET_FRAME_BYTES));
  const pcm = seen[0];
  assert.equal(pcm.length, frames.length * 160);
  assert.ok(pcm.subarray(0, 1600).every((s) => s === 0), "200 ms silent lead-in");
  let peak = 0;
  for (const s of pcm) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak <= HANDSET_PROMPT_PEAK && peak > HANDSET_PROMPT_PEAK * 0.95, `peak ${peak}`);
  // 800-sample silent edges were trimmed to the 20 ms margin, not kept whole.
  assert.ok(frames.length <= 10 + Math.ceil((1600 + 2 * 160) / 160));
});

test("prompt frames ramp a render that starts and ends loud", () => {
  const { encode, seen } = recordingEncoder();
  handsetPromptFrames(Int16Array.from(tone(1600, 32767)), encode);
  const pcm = seen[0];
  assert.equal(pcm[1600], 0, "fade-in starts at silence");
  assert.ok(Math.abs(pcm[1601]) < HANDSET_PROMPT_PEAK / 8, "no step at the cut");
  assert.equal(pcm[1600 + 1599], 0, "fade-out ends at silence");
});

test("prompt frames never amplify a quiet render", () => {
  const { encode, seen } = recordingEncoder();
  handsetPromptFrames(Int16Array.from(tone(1600, 4000)), encode);
  let peak = 0;
  for (const s of seen[0]) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak <= 4000, `peak ${peak}`);
});

test("all-silent render yields no frames", () => {
  const { encode } = recordingEncoder();
  assert.deepEqual(handsetPromptFrames(new Int16Array(4000), encode), []);
});

test("pacer sends every prompt frame before any queued caller audio", () => {
  const a = Buffer.alloc(160, 1);
  const b = Buffer.alloc(160, 2);
  const mic = Buffer.alloc(160, 3);
  const session = { _handsetPrompt: { frames: [a, b], next: 0 }, _pcmuQueue: [mic] };
  assert.deepEqual(nextPacerFrame(session), { frame: a, prompt: true });
  assert.deepEqual(nextPacerFrame(session), { frame: b, prompt: true });
  assert.equal(session._handsetPrompt, null);
  assert.deepEqual(nextPacerFrame(session), { frame: mic, prompt: false });
  assert.deepEqual(nextPacerFrame(session), { frame: undefined, prompt: false });
  assert.deepEqual(nextPacerFrame({ _pcmuQueue: null }), { frame: undefined, prompt: false });
});

test("sender drops caller audio while a prompt plays and the pacer outlives an empty queue", () => {
  const source = fs.readFileSync(fileURLToPath(new URL("./index.mjs", import.meta.url)), "utf8");
  const start = source.indexOf("function armExternalMediaSend");
  const fn = source.slice(start, source.indexOf("\n}\n", start));
  assert.match(fn, /if \(session\._handsetPrompt\) return false;\n\s+session\._pcmuQueue\.push/);
  assert.match(fn, /if \(!session\._pcmuQueue\.length && !session\._handsetPrompt\)/);
  assert.match(fn, /const \{ frame, prompt \} = nextPacerFrame\(session\)/);
});
