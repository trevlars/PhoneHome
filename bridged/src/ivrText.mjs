/**
 * Sanitize spoken IVR phrases for Flite dialplan / Piper.
 *
 * Asterisk Flite(text[,intkeys]) treats commas as argument separators unless the
 * whole phrase is quoted in dialplan — keep punctuation for Piper, but never
 * truncate a multi-grandparent menu mid-sentence (old 180-char cap did).
 */

/** Letters, digits, spaces, basic punctuation — safe for Flite IVR phrases. */
export function sanitizeIvrText(text, maxLen = 500) {
  const limit = Math.max(40, Number(maxLen) || 500);
  return (
    String(text || "")
      .replace(/[^a-zA-Z0-9\s.,!?'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit) || "Sorry."
  );
}
