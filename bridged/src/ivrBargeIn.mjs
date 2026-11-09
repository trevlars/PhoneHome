/**
 * Grandparents / IVR barge-in helpers.
 * Digit during prompt cancels TTS and selects that menu choice.
 */

/** Normalize interrupt-key string for Flite / Piper barge-in (digits only). */
export function normalizeIvrIntKeys(intKeys) {
  if (intKeys == null || intKeys === false) return "";
  if (intKeys === true) return "123456789";
  return String(intKeys).replace(/\D/g, "");
}

/** True when a received DTMF digit is an allowed barge-in key. */
export function isIvrBargeInDigit(digit, intKeys) {
  const keys = normalizeIvrIntKeys(intKeys);
  if (!keys) return false;
  const d = String(digit || "").trim();
  return d.length === 1 && keys.includes(d);
}
