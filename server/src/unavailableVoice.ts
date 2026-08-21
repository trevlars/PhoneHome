/**
 * Spoken prompts when a call is rejected by household policy.
 * Short system lines only — no call transcription / cloud STT.
 */

export type UnavailableVoice =
  | "timeout"
  | "bedtime"
  | "school"
  | "quiet"
  | "paused"
  | "cap"
  | "allowlist"
  | "self"
  | "unknown";

export const UNAVAILABLE_SPOKEN: Record<
  UnavailableVoice,
  { callee: string; caller: string }
> = {
  timeout: {
    callee: "They're in a timeout right now. Please try again later.",
    caller: "Timeout is on. Please try again later.",
  },
  bedtime: {
    callee: "They're not available until tomorrow. Please try again then.",
    caller: "It's Bedtime. Please try again tomorrow.",
  },
  school: {
    callee: "They're at school right now. Please try again later.",
    caller: "It's School hours. Please try again later.",
  },
  quiet: {
    callee: "They're in Quiet Time right now. Please try again later.",
    caller: "Quiet Time is on. Please try again later.",
  },
  paused: {
    callee: "They're in a timeout right now. Please try again later.",
    caller: "Timeout is on. Please try again later.",
  },
  cap: {
    callee: "Their talk time for today is full. Please try again tomorrow.",
    caller: "Daily talk time limit reached. Please try again tomorrow.",
  },
  allowlist: {
    callee: "You're not on their approved contacts.",
    caller: "That contact isn't on your approved list.",
  },
  self: {
    callee: "You can't call your own line.",
    caller: "You can't call your own line.",
  },
  unknown: {
    callee: "They're not available right now. Please try again later.",
    caller: "That call can't go through right now.",
  },
};

export function spokenFor(voice: UnavailableVoice, side: "callee" | "caller"): string {
  return UNAVAILABLE_SPOKEN[voice]?.[side] || UNAVAILABLE_SPOKEN.unknown[side];
}

/** Asterisk sound basenames under sounds/phonehome/ (no extension). */
export function asteriskSoundFor(voice: UnavailableVoice, side: "callee" | "caller"): string {
  const map: Partial<Record<UnavailableVoice, string>> = {
    timeout: "unavailable-timeout",
    bedtime: "unavailable-bedtime",
    school: "unavailable-school",
    quiet: "unavailable-quiet",
    paused: "unavailable-paused",
    cap: "unavailable-cap",
  };
  const base = map[voice];
  if (!base) return "cannot-complete-as-dialed";
  // Caller-side uses same clip when we only ship callee-oriented ATA prompts;
  // softphone speaks the exact string via speechSynthesis.
  void side;
  return `phonehome/${base}`;
}
