import {
  CALL_LIFECYCLE_CONTRACT_VERSION,
  CallTerminalOutcome,
  CallTerminalReason,
  type CallTerminalOutcome as CallTerminalOutcomeValue,
  type CallTerminalReason as CallTerminalReasonValue,
} from "./callLifecycle.js";

export type TerminalHangupSignal = {
  type: "call.hangup";
  contractVersion?: number;
  callId: string;
  fromLineId: string;
  toLineId: string;
  reason?: string;
  terminalOutcome?: CallTerminalOutcomeValue;
  terminalReason?: CallTerminalReasonValue;
};

type BufferedTerminalSignal = {
  signal: TerminalHangupSignal;
  expiresAt: number;
};

export type TerminalSignalBufferOptions = {
  ttlMs?: number;
  maxPerLine?: number;
  maxLines?: number;
  now?: () => number;
};

const DEFAULT_TTL_MS = 20_000;
const DEFAULT_MAX_PER_LINE = 8;
const DEFAULT_MAX_LINES = 256;
const MAX_ID_LENGTH = 128;
const MAX_REASON_LENGTH = 80;
const TERMINAL_OUTCOMES = new Set<string>(Object.values(CallTerminalOutcome));
const TERMINAL_REASONS = new Set<string>(Object.values(CallTerminalReason));

function boundedText(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeSignal(
  lineId: string,
  signal: TerminalHangupSignal
): TerminalHangupSignal | null {
  const targetLineId = boundedText(lineId, MAX_ID_LENGTH);
  const callId = boundedText(signal?.callId, MAX_ID_LENGTH);
  const fromLineId = boundedText(signal?.fromLineId, MAX_ID_LENGTH);
  const toLineId = boundedText(signal?.toLineId, MAX_ID_LENGTH);
  if (!targetLineId || !callId || !fromLineId || !toLineId) return null;
  if (targetLineId !== fromLineId && targetLineId !== toLineId) return null;

  const reason = boundedText(signal?.reason, MAX_REASON_LENGTH);
  const terminalOutcome = boundedText(signal?.terminalOutcome, 32);
  const terminalReason = boundedText(signal?.terminalReason, 32);
  return {
    type: "call.hangup",
    ...(signal.contractVersion === CALL_LIFECYCLE_CONTRACT_VERSION
      ? { contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION }
      : {}),
    callId,
    fromLineId,
    toLineId,
    ...(reason ? { reason } : {}),
    ...(TERMINAL_OUTCOMES.has(terminalOutcome)
      ? { terminalOutcome: terminalOutcome as CallTerminalOutcomeValue }
      : {}),
    ...(TERMINAL_REASONS.has(terminalReason)
      ? { terminalReason: terminalReason as CallTerminalReasonValue }
      : {}),
  };
}

/**
 * Short-lived in-memory terminal signaling for a softphone that briefly lost
 * its WebSocket. Only call routing ids and a bounded reason are retained.
 */
export class TerminalSignalBuffer {
  private readonly ttlMs: number;
  private readonly maxPerLine: number;
  private readonly maxLines: number;
  private readonly now: () => number;
  private readonly byLine = new Map<string, Map<string, BufferedTerminalSignal>>();

  constructor(options: TerminalSignalBufferOptions = {}) {
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs ?? DEFAULT_TTL_MS));
    this.maxPerLine = Math.max(1, Math.floor(options.maxPerLine ?? DEFAULT_MAX_PER_LINE));
    this.maxLines = Math.max(1, Math.floor(options.maxLines ?? DEFAULT_MAX_LINES));
    this.now = options.now ?? Date.now;
  }

  buffer(lineId: string, signal: TerminalHangupSignal): boolean {
    this.prune();
    const targetLineId = boundedText(lineId, MAX_ID_LENGTH);
    const normalized = normalizeSignal(targetLineId, signal);
    if (!normalized) return false;

    let lineSignals = this.byLine.get(targetLineId);
    if (!lineSignals) {
      while (this.byLine.size >= this.maxLines) {
        const oldestLine = this.byLine.keys().next().value as string | undefined;
        if (!oldestLine) break;
        this.byLine.delete(oldestLine);
      }
      lineSignals = new Map();
      this.byLine.set(targetLineId, lineSignals);
    }

    // A duplicate terminal event must not extend the original retention window.
    if (lineSignals.has(normalized.callId)) return false;
    while (lineSignals.size >= this.maxPerLine) {
      const oldestCall = lineSignals.keys().next().value as string | undefined;
      if (!oldestCall) break;
      lineSignals.delete(oldestCall);
    }
    lineSignals.set(normalized.callId, {
      signal: normalized,
      expiresAt: this.now() + this.ttlMs,
    });
    return true;
  }

  flush(
    lineId: string,
    deliver: (signal: TerminalHangupSignal) => boolean | void
  ): number {
    const targetLineId = boundedText(lineId, MAX_ID_LENGTH);
    if (!targetLineId) return 0;
    const lineSignals = this.byLine.get(targetLineId);
    if (!lineSignals) return 0;
    this.byLine.delete(targetLineId);

    const now = this.now();
    let delivered = 0;
    for (const entry of lineSignals.values()) {
      if (entry.expiresAt <= now) continue;
      if (deliver(entry.signal) === false) continue;
      delivered++;
    }
    return delivered;
  }

  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [lineId, lineSignals] of this.byLine) {
      for (const [callId, entry] of lineSignals) {
        if (entry.expiresAt > now) continue;
        lineSignals.delete(callId);
        removed++;
      }
      if (!lineSignals.size) this.byLine.delete(lineId);
    }
    return removed;
  }

  sizeForLine(lineId: string): number {
    this.prune();
    return this.byLine.get(boundedText(lineId, MAX_ID_LENGTH))?.size ?? 0;
  }
}
