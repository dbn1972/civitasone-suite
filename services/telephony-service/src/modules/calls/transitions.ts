/**
 * Call lifecycle state machine (pure, no I/O).
 *
 * A government call-centre call moves through a small, well-defined set of
 * states. The consumer is the only writer and uses {@link canTransition} /
 * {@link assertTransition} to reject illegal moves (e.g. answering a call that
 * never rang, or completing a call that was already missed). Keeping this pure
 * makes the rules unit-testable without a DB or queue.
 *
 *   queued ──► ringing ──► answered ──► completed   (happy path, inbound)
 *     │           │
 *     │           ├──► missed       (agent never picked up)
 *     │           └──► abandoned    (caller hung up while ringing)
 *     └──► abandoned                (caller hung up in queue)
 *
 * Outbound calls start at `ringing` (no queue wait). `completed`, `missed` and
 * `abandoned` are terminal — no transition leaves them.
 */
export type CallStatus = "queued" | "ringing" | "answered" | "completed" | "missed" | "abandoned";
export type CallDirection = "inbound" | "outbound";

export const CALL_STATUSES: readonly CallStatus[] = [
  "queued",
  "ringing",
  "answered",
  "completed",
  "missed",
  "abandoned",
] as const;

export const TERMINAL_STATUSES: ReadonlySet<CallStatus> = new Set<CallStatus>([
  "completed",
  "missed",
  "abandoned",
]);

/** A call counts toward abandonment metrics when the caller gave up before answer. */
export const ABANDONED_STATUSES: ReadonlySet<CallStatus> = new Set<CallStatus>(["abandoned"]);

/** Allowed forward transitions for each state. */
const ALLOWED: Record<CallStatus, readonly CallStatus[]> = {
  queued: ["ringing", "abandoned"],
  ringing: ["answered", "missed", "abandoned"],
  answered: ["completed"],
  completed: [],
  missed: [],
  abandoned: [],
};

/** Valid initial states at call creation, keyed by direction. */
export const INITIAL_STATUS: Record<CallDirection, CallStatus> = {
  inbound: "queued",
  outbound: "ringing",
};

/** Dispositions a completed call may carry (agent wrap-up codes). */
export const DISPOSITIONS = [
  "resolved",
  "callback_scheduled",
  "escalated",
  "transferred",
  "information_provided",
  "wrong_number",
  "voicemail",
  "no_resolution",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export function isTerminal(status: CallStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransition(from: CallStatus, to: CallStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export class IllegalTransitionError extends Error {
  readonly code = "ILLEGAL_TRANSITION";
  constructor(
    readonly from: CallStatus,
    readonly to: CallStatus,
  ) {
    super(`illegal call transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: CallStatus, to: CallStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
