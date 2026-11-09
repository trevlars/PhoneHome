/** Pure helpers for Analog Phone / HT801 parent setup UX. */

export function lineHasAtaSaved(line) {
  return Boolean(line?.ata?.sip_extension && line.ata.has_sip_password);
}

export function ataConfigSeen(line, statusSt) {
  return Boolean(
    statusSt?.config_seen ||
      line?.ata?.mac ||
      line?.ata?.last_provision_at ||
      line?.ata?.last_config_download_at
  );
}

export function ataStatusIsWorking(st) {
  return Boolean(st && st.status === "online" && st.registered !== false);
}

/**
 * Saved connection exists but PhoneHome settings are probably not on the box yet.
 * Used for Phone-tab CTA, auto-open Analog section, and setup checklist copy.
 */
export function analogNeedsConfigDownload(line, statusSt) {
  if (!lineHasAtaSaved(line)) return false;
  if (ataStatusIsWorking(statusSt)) return false;
  if (statusSt?.phase === "waiting") return false;
  return !ataConfigSeen(line, statusSt);
}

/**
 * @returns {{ active: 0|1|2|3, completed: number[] }}
 */
export function analogSetupStepState(line, statusSt) {
  const saved = lineHasAtaSaved(line);
  const configSeen = ataConfigSeen(line, statusSt);
  const working = ataStatusIsWorking(statusSt);
  if (!saved) return { active: 1, completed: [] };
  if (!configSeen && !working) return { active: 2, completed: [1] };
  if (!working) return { active: 3, completed: [1, 2] };
  return { active: 0, completed: [1, 2, 3] };
}

/** Short labels for home chrome / aria. */
export function analogHomeCtaCopy(kind) {
  switch (kind) {
    case "needs-download":
      return {
        label: "Download config file",
        sub: "House phone saved — get settings for the adapter box",
        aria: "Download config file for house phone — open Analog Phone setup",
        cls: "needs-download",
      };
    case "not-set-up":
      return {
        label: "Set up house phone",
        sub: "Connect the adapter box for your kid",
        aria: "Set up Analog Phone — open Parent Analog Phone",
        cls: "needs-setup",
      };
    case "offline":
      return {
        label: "House phone offline",
        sub: "Open setup to fix connection",
        aria: "Analog Phone offline — open Parent Analog Phone",
        cls: "offline",
      };
    case "waiting":
      return {
        label: "Reboot the house phone",
        sub: "Upload done — reboot once, then wait about a minute",
        aria: "Reboot Analog Phone adapter — open Parent Analog Phone",
        cls: "waiting",
      };
    default:
      return {
        label: "Finish house phone setup",
        sub: "Upload config on the box, reboot, then wait a minute",
        aria: "Finish Analog Phone setup — open Parent Analog Phone",
        cls: "unknown",
      };
  }
}
