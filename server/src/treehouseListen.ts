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
