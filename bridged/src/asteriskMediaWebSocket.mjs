export function asteriskMediaWebSocketUrl(ariUrl, connectionId) {
  const url = new URL(ariUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/media/${encodeURIComponent(String(connectionId || ""))}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function splitPcmuFrames(data, frameSize = 160) {
  const buffer = Buffer.from(data || []);
  const frames = [];
  for (let offset = 0; offset + frameSize <= buffer.length; offset += frameSize) {
    frames.push(buffer.subarray(offset, offset + frameSize));
  }
  return frames;
}

export async function resolveMediaWebSocketConnectionId(
  channel,
  { attempts = 20, delayMs = 50 } = {}
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await channel.getChannelVar({
        variable: "MEDIA_WEBSOCKET_CONNECTION_ID",
      });
      const value = String(result?.value || "").trim();
      if (value) return value;
      lastError = new Error("Asterisk returned an empty media WebSocket connection id");
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError || new Error("Asterisk media WebSocket connection id unavailable");
}
