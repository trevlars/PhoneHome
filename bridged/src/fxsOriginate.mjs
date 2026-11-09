/**
 * Originate PJSIP/HT801 legs for PhoneHome bridged.
 *
 * NEVER call channel.answer() here — each call topology answers only after its
 * media mix is ready (see analogMedia.answerChannelsAfterBridgeJoin).
 */

/**
 * @param {object} deps
 * @param {import("ari-client").Client} deps.client
 * @param {import("ari-client").Channel} deps.dest channel handle from originate()
 * @param {(channelId: string, timeoutMs: number) => Promise<import("ari-client").Channel>} deps.waitForSipLeg
 * @param {number} deps.ringTimeoutMs
 * @returns {Promise<import("ari-client").Channel>}
 */
export async function waitForFxsPeerPickup({ client: _client, dest, waitForSipLeg, ringTimeoutMs }) {
  const peer = await waitForSipLeg(dest.id, ringTimeoutMs);
  return peer || dest;
}

/**
 * @param {object} deps
 * @param {import("ari-client").Client} deps.client
 * @param {{ destChannel?: import("ari-client").Channel | null, bindChannel: (ch: import("ari-client").Channel) => void }} deps.session
 * @param {string} deps.sipExtension
 * @param {string} deps.callerId
 * @param {string} deps.ariApp
 * @param {(ext: string) => string} deps.sipEndpoint e.g. PJSIP/2001
 * @param {(channelId: string, timeoutMs: number) => Promise<import("ari-client").Channel>} deps.waitForSipLeg
 * @param {number} deps.ringTimeoutMs
 * @returns {Promise<import("ari-client").Channel>}
 */
export async function originateFxsPeerWaitPickup(deps) {
  const {
    client,
    session,
    sipExtension,
    callerId,
    ariApp,
    sipEndpoint,
    waitForSipLeg,
    ringTimeoutMs,
  } = deps;
  const endpoint = sipEndpoint(sipExtension);
  console.log(`[bridged] originate ${endpoint} callerId=${callerId || ""}`);
  const ringSec = Math.max(15, Math.round(ringTimeoutMs / 1000));
  const dest = await client.channels.originate({
    endpoint,
    app: ariApp,
    appArgs: "sip-leg",
    callerId: callerId || '"PhoneHome" <0000>',
    timeout: ringSec,
  });
  session.destChannel = dest;
  session.bindChannel(dest);
  return waitForFxsPeerPickup({ client, dest, waitForSipLeg, ringTimeoutMs });
}
