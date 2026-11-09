export function createAudioEvidence() {
  return {
    webrtc: { activeFrames: 0, peak: 0 },
    fxs: { activeFrames: 0, peak: 0 },
  };
}

export function observePcmActivity(evidence, samples, threshold = 256) {
  if (!evidence || !samples?.length) return 0;
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(Number(sample) || 0));
  evidence.peak = Math.max(evidence.peak || 0, peak);
  if (peak >= threshold) evidence.activeFrames = (evidence.activeFrames || 0) + 1;
  return peak;
}

export function directionalMediaSnapshot(session) {
  return {
    webrtcIn: Number(session?._webrtcRtpIn || 0),
    sipOut: Number(session?._sipRtpOut || 0),
    fxsIn: Number(session?._fxsRtpIn || 0),
    webrtcOut: Number(session?._webrtcRtpOut || 0),
    webrtcActive: Number(session?.audioEvidence?.webrtc?.activeFrames || 0),
    webrtcPeak: Number(session?.audioEvidence?.webrtc?.peak || 0),
    fxsActive: Number(session?.audioEvidence?.fxs?.activeFrames || 0),
    fxsPeak: Number(session?.audioEvidence?.fxs?.peak || 0),
  };
}

export function directionalMediaDelta(previous, current) {
  const prior = previous || {};
  return {
    webToFxs: Math.max(0, current.sipOut - Number(prior.sipOut || 0)),
    fxsToWeb: Math.max(0, current.fxsIn - Number(prior.fxsIn || 0)),
  };
}

/** Parse Asterisk "ssrc=..;rxcount=..;txcount=..;lp=..;rlp=..;rxjitter=.." QoS text. */
export function rtpQosCounters(text) {
  const fields = {};
  for (const part of String(text || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    fields[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  const num = (key) => {
    const value = Number(fields[key]);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    rx: num("rxcount"),
    tx: num("txcount"),
    lp: num("lp"),
    rlp: num("rlp"),
    rxjitter: fields.rxjitter ?? "?",
    present: Boolean(text && String(text).trim()),
  };
}

export function ataLegDelta(previous, current) {
  const prior = previous || {};
  const prevCaller = prior.caller || {};
  const prevCallee = prior.callee || {};
  return {
    callerRx: Math.max(0, current.caller.rx - Number(prevCaller.rx || 0)),
    callerTx: Math.max(0, current.caller.tx - Number(prevCaller.tx || 0)),
    calleeRx: Math.max(0, current.callee.rx - Number(prevCallee.rx || 0)),
    calleeTx: Math.max(0, current.callee.tx - Number(prevCallee.tx || 0)),
  };
}

/**
 * RTP timestamp slots to advance for an FXS frame given wall-clock gap since the
 * previous frame. Short gaps stay continuous (softphone jitter buffer absorbs
 * them); real outages (>= 200ms) keep timestamps wall-clock aligned so the
 * phone conceals the loss instead of replaying stale audio late.
 */
export function gapAdjustedRtpAdvance(gapMs, { frameMs = 20, minGapMs = 200, maxSlots = 15000 } = {}) {
  if (!Number.isFinite(gapMs) || gapMs < minGapMs) return { slots: 1, marker: false };
  const slots = Math.min(maxSlots, Math.max(1, Math.round(gapMs / frameMs)));
  return { slots, marker: true };
}
