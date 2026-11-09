/**
 * Pure helpers for Circle-filtered analog TreeHouse mixing.
 * Asterisk cannot put one FXS channel in multiple bridges, so each leg gets a
 * personal hear-bridge fed by ChannelSnoop of Circle talk peers only.
 */

/**
 * Which already-present analog legs should be linked to a new joiner.
 * @param {string} selfId
 * @param {string[]} analogTalkPeerIds from PhoneHome join (Circle ∩ analog)
 * @param {Iterable<string>} presentAnalogIds legs currently on Asterisk
 * @returns {string[]}
 */
export function analogEdgesToLink(selfId, analogTalkPeerIds, presentAnalogIds) {
  const present = new Set(presentAnalogIds || []);
  return (analogTalkPeerIds || []).filter(
    (id) => Boolean(id) && id !== selfId && present.has(id)
  );
}

/**
 * Announce / listen fan-out: child + their linked analog Circle peers.
 * @param {string} childLineId
 * @param {Iterable<string>} linkedPeerIds snoops currently attached to the child leg
 * @returns {string[]}
 */
export function analogAnnounceTargets(childLineId, linkedPeerIds) {
  const out = new Set([childLineId]);
  for (const id of linkedPeerIds || []) {
    if (id) out.add(id);
  }
  return [...out];
}
