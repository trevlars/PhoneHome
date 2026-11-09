/**
 * In-memory failed-attempt limiter for short secrets (6-digit invite / guardian codes,
 * setup codes, passwords). Counts failures per key in a sliding window; a success
 * clears that key. Single-process Mothership, so memory is the right store.
 */
export type AttemptLimiter = {
  /** Seconds until the key may try again, or null when allowed. */
  retryAfter(keys: string[]): number | null;
  fail(keys: string[]): void;
  succeed(keys: string[]): void;
};

export function createAttemptLimiter(opts: {
  maxFailures: number;
  windowMs: number;
  now?: () => number;
}): AttemptLimiter {
  const now = opts.now ?? Date.now;
  const failures = new Map<string, number[]>();

  const recent = (key: string): number[] => {
    const cutoff = now() - opts.windowMs;
    const kept = (failures.get(key) || []).filter((t) => t > cutoff);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };

  const prune = () => {
    if (failures.size < 5000) return;
    for (const key of [...failures.keys()]) recent(key);
  };

  return {
    retryAfter(keys) {
      let wait = 0;
      for (const key of keys) {
        const hits = recent(key);
        if (hits.length < opts.maxFailures) continue;
        const oldest = hits[hits.length - opts.maxFailures];
        wait = Math.max(wait, oldest + opts.windowMs - now());
      }
      return wait > 0 ? Math.ceil(wait / 1000) : null;
    },
    fail(keys) {
      prune();
      const t = now();
      for (const key of keys) failures.set(key, [...recent(key), t]);
    },
    succeed(keys) {
      for (const key of keys) failures.delete(key);
    },
  };
}
