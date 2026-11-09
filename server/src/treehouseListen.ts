/**
 * TreeHouse mesh signaling: never steal parent listen-in or kid WebRTC
 * to an HT801 inbound-claim socket (findByLine prefers the bridge).
 */
export function groupSignalingRole(opts: {
  destIsListener: boolean;
  destIsAnalogMember: boolean;
}): "softphone" | "bridge" {
  if (opts.destIsListener) return "softphone";
  if (opts.destIsAnalogMember) return "bridge";
  return "softphone";
}

/**
 * Softphone TreeHouse mesh peers. Analog FXS stays on the Asterisk mix —
 * offering WebRTC to an analog member is treated as parent listen-in by the
 * bridge and can announce a false “parent is listening”.
 */
export function meshTalkPeerIds(
  talkPeerIds: string[],
  analogMemberIds?: Iterable<string>,
  opts: { joinerIsAnalog?: boolean } = {}
): string[] {
  if (opts.joinerIsAnalog) return [];
  const analog = new Set(analogMemberIds || []);
  return (talkPeerIds || []).filter((id) => Boolean(id) && !analog.has(id));
}

/**
 * Filter room members to Circle talk peers (symmetric). Used by softphone mesh
 * and parent listen-in so a child never hears kids outside their Circles.
 */
export function filterCircleTalkPeers(
  memberIds: string[],
  selfId: string,
  canTalk: (a: string, b: string) => boolean
): string[] {
  return (memberIds || []).filter(
    (id) => Boolean(id) && id !== selfId && canTalk(selfId, id)
  );
}

/**
 * Parent listen targets = child + child's Circle talk peers (never the whole room).
 */
export function listenTargetsForChild(
  memberIds: string[],
  childLineId: string,
  canTalk: (a: string, b: string) => boolean
): string[] {
  const peers = filterCircleTalkPeers(memberIds, childLineId, canTalk);
  return [childLineId, ...peers];
}

/**
 * Analog FXS TreeHouse: only other *analog* members on Circle talk edges.
 * Softphones stay on WebRTC mesh; ATA hearing is Asterisk snoops between these ids.
 */
export function analogCircleTalkPeers(
  memberIds: string[],
  selfId: string,
  analogMemberIds: Iterable<string>,
  canTalk: (a: string, b: string) => boolean
): string[] {
  const analog = new Set(analogMemberIds || []);
  return filterCircleTalkPeers(memberIds, selfId, canTalk).filter((id) => analog.has(id));
}
