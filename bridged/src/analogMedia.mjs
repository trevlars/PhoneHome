/**
 * PhoneHome 1:1 analog media invariants (HT801 SDES + Asterisk ARI).
 *
 * Every softphone↔ATA and ATA↔ATA call MUST follow these rules or audio wedges:
 *  1. Plain `mixing` bridge only — never proxy_media / native_rtp on HT801 legs.
 *  2. All channels join the bridge BEFORE any channel.answer().
 *  3. No Piper/channel.play on FXS before the mix exists.
 *  4. Softphone↔ATA uses UDP UnicastRTP ExternalMedia — never chan_websocket.
 *  5. Bridge FXS+ExternalMedia before answer(); arm bidirectional RTP only after FXS answer().
 *
 * @see docs/analog-media-invariants.md
 */

/** @typedef {import("ari-client").Client} AriClient */
/** @typedef {import("ari-client").Bridge} Bridge */
/** @typedef {import("ari-client").Channel} Channel */

export const ONE_TO_ONE_BRIDGE_TYPE = "mixing";

/** Tokens that must never appear in 1:1 HT801 bridge types. */
export const FORBIDDEN_BRIDGE_TOKENS = Object.freeze(["proxy_media", "native_rtp"]);

/** ExternalMedia transport for softphone↔ATA — chan_websocket wedged home uplink in lab. */
export const EXTERNAL_MEDIA_TRANSPORT = "udp";
export const EXTERNAL_MEDIA_ENCAPSULATION = "rtp";

/**
 * @param {string} type
 * @returns {string}
 */
export function assertOneToOneBridgeType(type) {
  const value = String(type || "");
  for (const token of FORBIDDEN_BRIDGE_TOKENS) {
    if (value.includes(token)) {
      throw new Error(`Forbidden HT801 bridge type token "${token}" in: ${value}`);
    }
  }
  if (value !== ONE_TO_ONE_BRIDGE_TYPE) {
    throw new Error(
      `HT801 1:1 bridge must be "${ONE_TO_ONE_BRIDGE_TYPE}", got "${value}"`
    );
  }
  return value;
}

/**
 * @param {AriClient} client
 * @param {string} name
 * @returns {Promise<Bridge>}
 */
export async function createOneToOneBridge(client, name) {
  const bridge = await client.bridges.create({
    type: ONE_TO_ONE_BRIDGE_TYPE,
    name,
  });
  assertOneToOneBridgeType(ONE_TO_ONE_BRIDGE_TYPE);
  return bridge;
}

/**
 * @param {Bridge} bridge
 * @param {string[]} channelIds
 */
export async function addLegsToBridge(bridge, channelIds) {
  const ids = (channelIds || []).filter(Boolean);
  if (ids.length < 2) {
    throw new Error("addLegsToBridge requires at least two channel ids");
  }
  await bridge.addChannel({ channel: ids.join(",") });
}

/**
 * HT801 SDES wedges if answer() runs with no mix peer. Call only after bridge join.
 * @param {Channel[]} channels
 */
export async function answerChannelsAfterBridgeJoin(channels) {
  for (const ch of channels || []) {
    if (!ch) continue;
    try {
      await ch.answer();
    } catch {
      /* already Up */
    }
  }
}

/**
 * Static guard run in CI and post-deploy smoke — catches regressions before customers do.
 * @param {string} source full bridged index.mjs (or bundle) source text
 * @returns {{ ok: true } | { ok: false, violations: string[] }}
 */
export function validateAnalogMediaSource(source) {
  const text = String(source || "");
  const violations = [];

  for (const token of FORBIDDEN_BRIDGE_TOKENS) {
    if (text.includes(token)) {
      violations.push(`forbidden bridge token: ${token}`);
    }
  }
  if (/transport:\s*["']websocket["']/.test(text)) {
    violations.push("ExternalMedia must not use transport websocket (use UDP UnicastRTP)");
  }
  if (/external_host:\s*["']INCOMING["']/.test(text)) {
    violations.push("ExternalMedia must not use external_host INCOMING (chan_websocket)");
  }
  if (/encapsulation:\s*["']none["']/.test(text)) {
    violations.push("ExternalMedia must use encapsulation rtp, not none");
  }

  const ataStart = text.indexOf("async function startAtaToAta");
  const ataEnd = ataStart >= 0 ? text.indexOf("\n/**", ataStart + 1) : -1;
  if (ataStart >= 0 && ataEnd > ataStart) {
    const ata = text.slice(ataStart, ataEnd);
    if (!/createOneToOneBridge|ONE_TO_ONE_BRIDGE_TYPE/.test(ata)) {
      violations.push("startAtaToAta must use createOneToOneBridge");
    }
    if (!/originateFxsPeerWaitPickup|originateFxsPeer\b/.test(ata)) {
      violations.push("startAtaToAta must originate without pre-bridge answer");
    }
    const join = ata.indexOf("addLegsToBridge");
    const answer = ata.indexOf("answerChannelsAfterBridgeJoin");
    if (join < 0 || answer < 0 || answer <= join) {
      violations.push("startAtaToAta must answer only after addLegsToBridge");
    }
    if (/announceDialingOnFxs/.test(ata)) {
      violations.push(
        "startAtaToAta must not play Calling after connect; it belongs before ring"
      );
    }
  }

  const preRing = text.indexOf("await announceDialingOnFxs(channel, resolved.toLabel)");
  const ataCall = text.indexOf("await startAtaToAta(client, session, channel, resolved)");
  const webrtcStart = text.indexOf("const webrtcLeg = startWebRtcLeg(session, resolved)");
  if (
    preRing < 0 ||
    ataCall < 0 ||
    webrtcStart < 0 ||
    !(preRing < ataCall && preRing < webrtcStart)
  ) {
    violations.push(
      "onStasisStart must finish Calling {name} before ATA originate or softphone ring"
    );
  }

  const softStart = text.indexOf("async function handleSoftphoneToAta");
  const softEnd =
    softStart >= 0 ? text.indexOf("\n/** Match server softphoneCidNumber", softStart) : -1;
  const ataSoftStart = text.indexOf("// No FXS playback on this leg. Piper after join killed");
  const ataSoftEnd =
    ataSoftStart >= 0 ? text.indexOf("[bridged] media up call=", ataSoftStart) : -1;
  if (ataSoftStart >= 0 && ataSoftEnd > ataSoftStart) {
    const block = text.slice(ataSoftStart, ataSoftEnd);
    const join = block.indexOf("attachExternalMedia(client, session, channel");
    const answer = block.indexOf("answerFxsWhenMediaReady");
    const arm = block.lastIndexOf("armExternalMediaMix(session)");
    if (join < 0 || answer < 0 || arm < 0 || !(join < answer && answer < arm)) {
      violations.push(
        "ATA→softphone must join ExternalMedia, answer FXS, then armExternalMediaMix"
      );
    }
    if (/announceDialingOnFxs|announceCallerOnFxs|channel\.play/.test(block)) {
      violations.push(
        "ATA→softphone must not channel.play on the FXS leg (wedges HT801 SDES)"
      );
    }
    if (/void answerFxsWhenMediaReady\(session, "call\.accepted"\)/.test(text)) {
      violations.push("do not attach/answer FXS on call.accepted before call.answer");
    }
  }

  if (softStart >= 0 && softEnd > softStart) {
    const soft = text.slice(softStart, softEnd);
    const join = soft.indexOf("attachExternalMedia(client, session, dest");
    const answer = soft.indexOf("answerChannelsAfterBridgeJoin");
    const arm = soft.lastIndexOf("armExternalMediaMix(session)");
    if (join < 0 || answer < 0 || arm < 0 || !(join < answer && answer < arm)) {
      violations.push(
        "handleSoftphoneToAta must join, answer FXS, then armExternalMediaMix"
      );
    }
    if (/announceDialingOnFxs|announceCallerOnFxs|channel\.play/.test(soft)) {
      violations.push(
        "handleSoftphoneToAta must not channel.play on the FXS leg (wedges HT801 SDES)"
      );
    }
    if (/playBridgePhrase|bridge\.play|announceCallerOnHandset/.test(soft)) {
      violations.push(
        "handleSoftphoneToAta must not play bridge prompts before the mix (HT801 uplink buzz)"
      );
    }
    const handsetPrompt = soft.indexOf("startHandsetCallerPrompt(session");
    if (handsetPrompt >= 0 && handsetPrompt < arm) {
      violations.push(
        "handleSoftphoneToAta must start the handset caller prompt only after armExternalMediaMix"
      );
    }
    if (!/attachExternalMedia\(client, session, null\)/.test(soft)) {
      violations.push("handleSoftphoneToAta must prep ExternalMedia while FXS rings");
    }
  }

  const promptStart = text.indexOf("const handsetPromptCache");
  const promptEnd = promptStart >= 0 ? text.indexOf("async function handleSoftphoneToAta", promptStart) : -1;
  if (promptStart >= 0 && promptEnd > promptStart) {
    const promptFns = text.slice(promptStart, promptEnd);
    if (/\.play\(|playMediaUri|playBridgePhrase|announce\w*On(Fxs|Handset)/.test(promptFns)) {
      violations.push(
        "handset caller prompt must be caller PCMU through the pacer, never Asterisk playback"
      );
    }
  }

  const endFnStart = text.indexOf("async function endAtaCallFromSoftphoneHangup");
  const endFnEnd = endFnStart >= 0 ? text.indexOf("const voicePrompts", endFnStart) : -1;
  if (endFnStart >= 0 && endFnEnd > endFnStart) {
    const endFn = text.slice(endFnStart, endFnEnd);
    const said = endFn.indexOf("sayCallEnded(session)");
    const bye = endFn.indexOf("fxs.hangup()");
    if (said < 0 || bye < 0 || !(said < bye)) {
      violations.push("softphone hangup must play Call ended on the bridge before BYE");
    }
    if (/channel\.play/.test(endFn)) {
      violations.push("softphone hangup must not channel.play the FXS leg");
    }
  }
  if (!/this\.ataToAta && this\.callConnected && !this\._saidCallEnded/.test(text)) {
    violations.push("ATA↔ATA teardown must play Call ended to the surviving handset");
  }

  if (violations.length) return { ok: false, violations };
  return { ok: true };
}
