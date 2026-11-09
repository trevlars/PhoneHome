import test from "node:test";
import assert from "node:assert/strict";

/** Mirror of bridged opusChannelsFromSdp / upmixMonoToStereo for regression. */
function opusChannelsFromSdp(sdp) {
  const s = String(sdp || "");
  if (/a=fmtp:\d+[^\r\n]*stereo=1/i.test(s)) return 2;
  return 1;
}

function upmixMonoToStereo(pcmMono) {
  const out = new Int16Array(pcmMono.length * 2);
  for (let i = 0; i < pcmMono.length; i++) {
    out[i * 2] = pcmMono[i];
    out[i * 2 + 1] = pcmMono[i];
  }
  return out;
}

test("Chrome/Android opus/48000/2 without stereo=1 is mono outbound", () => {
  const sdp = [
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
  ].join("\r\n");
  assert.equal(opusChannelsFromSdp(sdp), 1);
});

test("stereo=1 fmtp is stereo", () => {
  assert.equal(
    opusChannelsFromSdp("a=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1;useinbandfec=1"),
    2
  );
});

test("mono opus stays mono", () => {
  assert.equal(opusChannelsFromSdp("a=rtpmap:111 opus/48000/1\r\na=fmtp:111 useinbandfec=1"), 1);
});

test("upmix duplicates mono samples to L/R", () => {
  const mono = Int16Array.from([100, -200, 300]);
  const stereo = upmixMonoToStereo(mono);
  assert.deepEqual([...stereo], [100, 100, -200, -200, 300, 300]);
});

test("softphone→ATA uses stereo encode only when fmtp stereo=1", () => {
  assert.equal(opusChannelsFromSdp("a=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1"), 2);
  assert.equal(opusChannelsFromSdp("a=rtpmap:111 opus/48000/2\r\na=fmtp:111 useinbandfec=1"), 1);
});
