/**
 * SVC-095 RTI — pure domain: statutory timeline / deadline calculation,
 * appeal-tier transitions, and the maker-checker guard for appeal orders.
 *
 * All functions here are pure (no DB, no I/O) so they are unit-testable in
 * isolation and are the single source of truth for RTI Act 2005 timelines.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type RtiStatus =
  | "received"
  | "transferred"
  | "third_party_consult"
  | "responded"
  | "rejected"
  | "closed";

export type AppealTier = "first" | "second";
export type AppealOrder = "pending" | "allowed" | "rejected" | "partly_allowed";

/** RTI Act §7(1): normal disclosure window is 30 days from receipt. */
export const NORMAL_RESPONSE_DAYS = 30;
/** §7(1) proviso: life & liberty of a person → 48 hours. */
export const LIFE_LIBERTY_HOURS = 48;
/** §11: third-party consultation extends the window to 40 days. */
export const THIRD_PARTY_RESPONSE_DAYS = 40;
/** §19(1): first appeal must be filed within 30 days of the decision/deadline. */
export const FIRST_APPEAL_WINDOW_DAYS = 30;
/** §19(3): second appeal must be filed within 90 days of the first-appeal order. */
export const SECOND_APPEAL_WINDOW_DAYS = 90;

export interface DeadlineFactors {
  /** §7(1) proviso — request concerns the life or liberty of a person. */
  lifeOrLiberty?: boolean;
  /** §11 — a third party's interest requires consultation. */
  thirdParty?: boolean;
}

/**
 * Compute the statutory response deadline for an RTI application.
 * Precedence: life/liberty (48h) overrides everything; else third-party
 * consultation (40 days) overrides the normal 30-day window.
 */
export function computeResponseDeadline(receivedAt: Date, factors: DeadlineFactors = {}): Date {
  if (Number.isNaN(receivedAt.getTime())) {
    throw new DomainError("INVALID_DATE", "receivedAt is not a valid date");
  }
  if (factors.lifeOrLiberty) {
    return new Date(receivedAt.getTime() + LIFE_LIBERTY_HOURS * 60 * 60 * 1000);
  }
  const days = factors.thirdParty ? THIRD_PARTY_RESPONSE_DAYS : NORMAL_RESPONSE_DAYS;
  return new Date(receivedAt.getTime() + days * DAY_MS);
}

/**
 * §6(3): when an application is transferred to another public authority, the
 * clock effectively restarts from the transfer date (transfer must itself be
 * effected within 5 days, but the receiving PIO's 30-day window runs from
 * the date the transferred application is received). We compute the new
 * deadline from the transfer date.
 */
export function computeTransferDeadline(transferredAt: Date): Date {
  if (Number.isNaN(transferredAt.getTime())) {
    throw new DomainError("INVALID_DATE", "transferredAt is not a valid date");
  }
  return new Date(transferredAt.getTime() + NORMAL_RESPONSE_DAYS * DAY_MS);
}

/** Appeal filing deadline from the reference date (decision / order date). */
export function computeAppealDeadline(referenceAt: Date, tier: AppealTier): Date {
  if (Number.isNaN(referenceAt.getTime())) {
    throw new DomainError("INVALID_DATE", "referenceAt is not a valid date");
  }
  const days = tier === "first" ? FIRST_APPEAL_WINDOW_DAYS : SECOND_APPEAL_WINDOW_DAYS;
  return new Date(referenceAt.getTime() + days * DAY_MS);
}

/** True when `now` is strictly past the deadline. */
export function isOverdue(deadline: Date, now: Date = new Date()): boolean {
  return now.getTime() > deadline.getTime();
}

/** Whole days remaining until the deadline (negative when overdue). */
export function daysRemaining(deadline: Date, now: Date = new Date()): number {
  return Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Appeal-tier ordering guard. A second appeal is only competent once a first
 * appeal has been disposed of (an order was passed). A first appeal cannot be
 * filed twice.
 */
export function assertAppealTierAllowed(
  requestedTier: AppealTier,
  existing: { tier: AppealTier; order: AppealOrder }[],
): void {
  const firstAppeals = existing.filter((a) => a.tier === "first");
  const secondAppeals = existing.filter((a) => a.tier === "second");
  if (requestedTier === "first") {
    if (firstAppeals.length > 0) {
      throw new DomainError("APPEAL_EXISTS", "a first appeal has already been filed");
    }
    return;
  }
  // second appeal
  if (firstAppeals.length === 0) {
    throw new DomainError("FIRST_APPEAL_REQUIRED", "a first appeal must be filed before a second appeal");
  }
  const firstDisposed = firstAppeals.some((a) => a.order !== "pending");
  if (!firstDisposed) {
    throw new DomainError("FIRST_APPEAL_PENDING", "the first appeal has not been decided yet");
  }
  if (secondAppeals.length > 0) {
    throw new DomainError("APPEAL_EXISTS", "a second appeal has already been filed");
  }
}

/**
 * Maker-checker guard for an appeal order: the appellate authority passing the
 * order must NOT be the same actor who filed/recorded the appeal. Enforced
 * server-side (never trust the client) at the point the order is applied.
 */
export function assertDifferentActor(makerId: string, checkerId: string, subject = "order"): void {
  if (!checkerId) {
    throw new DomainError("CHECKER_REQUIRED", `${subject} requires a deciding authority`);
  }
  if (makerId === checkerId) {
    throw new DomainError("MAKER_CHECKER_VIOLATION", `${subject} must be decided by a different authority than the one who raised it`);
  }
}

const RTI_TRANSITIONS: Record<RtiStatus, RtiStatus[]> = {
  received: ["transferred", "third_party_consult", "responded", "rejected"],
  transferred: ["responded", "rejected", "third_party_consult", "closed"],
  third_party_consult: ["responded", "rejected"],
  responded: ["closed"],
  rejected: ["closed"],
  closed: [],
};

export function assertStatusTransition(from: RtiStatus, to: RtiStatus): void {
  if (!RTI_TRANSITIONS[from]?.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `cannot move RTI application from ${from} to ${to}`);
  }
}
