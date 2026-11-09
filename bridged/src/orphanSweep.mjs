/**
 * A bridged restart strands the old process's ExternalMedia legs in Stasis: the
 * WebRTC side died with that process, so the house leg sat in a dead bridge
 * (UnicastRTP leaked 20+ min after the Oct 4 18:44 deploy). Call before
 * client.start(), so no live session can own them. ATA↔ATA bridges have no
 * ExternalMedia leg and keep mixing.
 */
export async function sweepOrphanedExternalMedia(client, { extMediaHost, log = console } = {}) {
  let bridges;
  let channels;
  try {
    [bridges, channels] = await Promise.all([client.bridges.list(), client.channels.list()]);
  } catch (e) {
    log.warn("[bridged] orphan sweep skipped:", e?.message || e);
    return { channels: 0, bridges: 0 };
  }
  const isOurExternalMedia = (ch) => String(ch?.name || "").startsWith(`UnicastRTP/${extMediaHost}:`);
  const byId = new Map(channels.map((ch) => [ch.id, ch]));
  const hangupIds = new Set(channels.filter(isOurExternalMedia).map((ch) => ch.id));
  const destroyIds = [];
  for (const bridge of bridges) {
    if (bridge.bridge_class !== "stasis" || !String(bridge.name || "").startsWith("ph-")) continue;
    const members = (bridge.channels || []).map((id) => byId.get(id)).filter(Boolean);
    if (members.length && !members.some(isOurExternalMedia)) continue;
    for (const ch of members) hangupIds.add(ch.id);
    destroyIds.push(bridge.id);
  }
  if (!hangupIds.size && !destroyIds.length) return { channels: 0, bridges: 0 };
  log.warn(
    `[bridged] orphan sweep: ending ${hangupIds.size} channel(s) and ${destroyIds.length} bridge(s) left by a previous bridged process`
  );
  for (const channelId of hangupIds) {
    await client.channels.hangup({ channelId }).catch(() => {});
  }
  for (const bridgeId of destroyIds) {
    await client.bridges.destroy({ bridgeId }).catch(() => {});
  }
  return { channels: hangupIds.size, bridges: destroyIds.length };
}
