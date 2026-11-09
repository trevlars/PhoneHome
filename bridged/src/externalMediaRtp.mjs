import net from "node:net";

function valueOf(result) {
  return String(result?.value ?? result ?? "").trim();
}

export function parseExternalMediaRtpEndpoint(addressRaw, portRaw, fallbackAddress) {
  let address = String(addressRaw || "").trim();
  const fallback = String(fallbackAddress || "").trim();
  const port = Number.parseInt(String(portRaw || "").trim(), 10);
  if (address === "0.0.0.0" || address === "::") address = fallback;
  if (!address || net.isIP(address) === 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return { address, port };
}

/**
 * Asterisk's UnicastRTP channel exposes the address/port that accepts injected
 * RTP. Resolve it immediately so WebRTC audio does not wait for Asterisk to
 * speak first (which deadlocks on a silent/VAD analog leg).
 */
export async function resolveExternalMediaRtpEndpoint(
  channel,
  { fallbackAddress, attempts = 8, delayMs = 25 } = {}
) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [addressResult, portResult] = await Promise.all([
        channel.getChannelVar({ variable: "UNICASTRTP_LOCAL_ADDRESS" }),
        channel.getChannelVar({ variable: "UNICASTRTP_LOCAL_PORT" }),
      ]);
      const endpoint = parseExternalMediaRtpEndpoint(
        valueOf(addressResult),
        valueOf(portResult),
        fallbackAddress
      );
      if (endpoint) return endpoint;
      lastError = new Error("Asterisk returned an invalid UnicastRTP endpoint");
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError || new Error("Asterisk did not expose its UnicastRTP endpoint");
}
