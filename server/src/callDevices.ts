/**
 * One line can hold two softphone sockets at once: a Safari tab and the CallKit
 * app on the same iPhone, or an iPad and an iPhone. The first device to accept
 * or answer owns the call. Every other device on that line must stop ringing
 * and must not touch the call: its answer, ICE, or hangup would land on the
 * owner's peer (call_vK_c7hvorV: the app's late CallKit answer kicked Safari's
 * socket and sent nine foreign ICE candidates to the bridge).
 */
export type DeviceSocket = {
  lineId?: string;
  isBridge?: boolean;
  /** Login session: identifies one device across WS reconnects. Never log it. */
  sessionId?: string;
};

export function sameDevice(
  a: DeviceSocket | null | undefined,
  b: DeviceSocket | null | undefined
): boolean {
  return Boolean(a && b && a.sessionId && a.sessionId === b.sessionId);
}

/** `owner` is the connected socket that took the call, or null if none/closed. */
export function isSecondDevice(owner: DeviceSocket | null, sender: DeviceSocket): boolean {
  if (!owner || sender.isBridge) return false;
  if (owner === sender || sameDevice(owner, sender)) return false;
  return Boolean(owner.lineId && owner.lineId === sender.lineId);
}

/** Sockets that must hear "answered elsewhere" when `answerer` takes the call. */
export function devicesToStopRinging<T extends DeviceSocket>(
  answerer: T,
  sockets: Iterable<T>
): T[] {
  if (answerer.isBridge || !answerer.lineId) return [];
  const out: T[] = [];
  for (const s of sockets) {
    if (s === answerer || s.isBridge || s.lineId !== answerer.lineId) continue;
    if (sameDevice(s, answerer)) continue;
    out.push(s);
  }
  return out;
}

/**
 * A softphone hello normally replaces the line's older softphone socket. It
 * must not replace a different device that is placing, ringing for, or holding
 * an open call; both stay connected and the first answer wins.
 */
export function keepSocketOnClaim(
  existing: DeviceSocket,
  incoming: DeviceSocket,
  existingInOpenCall: boolean
): boolean {
  if (existing.isBridge || incoming.isBridge) return false;
  if (sameDevice(existing, incoming)) return false;
  return existingInOpenCall;
}
