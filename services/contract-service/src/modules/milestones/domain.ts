/**
 * G15 — MoU milestone governance. Pure logic only: no I/O, no database, no
 * queue, no clock reads except through explicit `today` parameters.
 *
 * Covers:
 *   - the milestone status state machine (pending → met | missed → waived)
 *   - penalty computation in exact BigInt minor units
 *   - the deterministic occurrence key used as the double-count business key
 *   - periodic review-date advancement
 */

export class MilestoneDomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "MilestoneDomainError";
  }
}

// ── Milestone status state machine ──────────────────────────────────────────

/**
 * MoU milestone lifecycle.
 *   pending — registered against the agreement, outcome not yet assessed.
 *   met     — delivered. Terminal.
 *   missed  — due date passed without delivery. Penalty terms may fire.
 *   waived  — a missed milestone excused by an authorised actor. Terminal.
 *             A waiver ALWAYS records who waived it and why.
 */
export const MILESTONE_STATUSES = ["pending", "met", "missed", "waived"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

const TRANSITIONS: Record<MilestoneStatus, readonly MilestoneStatus[]> = {
  pending: ["met", "missed"],
  // A missed milestone can still be delivered late (→ met) or excused (→ waived).
  missed:  ["met", "waived"],
  met:     [],
  waived:  [],
};

export function isMilestoneStatus(value: string): value is MilestoneStatus {
  return (MILESTONE_STATUSES as readonly string[]).includes(value);
}

/** True when `from → to` is a legal milestone transition. */
export function canTransition(from: string, to: string): boolean {
  if (!isMilestoneStatus(from) || !isMilestoneStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: string, to: string): void {
  if (!isMilestoneStatus(from)) {
    throw new MilestoneDomainError("UNKNOWN_STATUS", `unknown milestone status '${from}'`);
  }
  if (!isMilestoneStatus(to)) {
    throw new MilestoneDomainError("UNKNOWN_STATUS", `unknown target milestone status '${to}'`);
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new MilestoneDomainError(
      "INVALID_TRANSITION",
      `milestone cannot transition from '${from}' to '${to}'`,
    );
  }
}

export interface WaiverRecord {
  waivedBy: string;
  reason: string;
}

/**
 * Validate a waiver. Only a `missed` milestone can be waived, and the waiver
 * must name an actor and carry a non-blank reason — an unattributable or
 * unexplained waiver is a governance hole, so it is rejected here as well as
 * by the CHECK constraint in migration 0018.
 */
export function assertWaiverAllowed(from: string, waiver: WaiverRecord): void {
  assertTransition(from, "waived");
  if (!waiver.waivedBy || waiver.waivedBy.trim() === "") {
    throw new MilestoneDomainError("WAIVER_ACTOR_REQUIRED", "a waiver must record who waived the milestone");
  }
  if (!waiver.reason || waiver.reason.trim() === "") {
    throw new MilestoneDomainError("WAIVER_REASON_REQUIRED", "a waiver must record why the milestone was waived");
  }
}

// ── Dates ──────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateOnly(value: string): Date {
  if (!DATE_RE.test(value)) {
    throw new MilestoneDomainError("INVALID_DATE", `date must be YYYY-MM-DD, got '${value}'`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new MilestoneDomainError("INVALID_DATE", `invalid calendar date '${value}'`);
  }
  return d;
}

function toDateOnly(d: Date): string {
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `dueDate` to `asOf`; 0 when not yet past due. */
export function daysOverdue(dueDate: string, asOf: string): number {
  const due = parseDateOnly(dueDate);
  const ref = parseDateOnly(asOf);
  const diff = Math.floor((ref.getTime() - due.getTime()) / MS_PER_DAY);
  return diff > 0 ? diff : 0;
}

/**
 * Decide whether a pending milestone should now be treated as missed.
 * `graceDays` comes from the penalty term's thresholdValue.
 */
export function isMissed(dueDate: string, asOf: string, graceDays = 0): boolean {
  if (graceDays < 0 || !Number.isInteger(graceDays)) {
    throw new MilestoneDomainError("INVALID_THRESHOLD", "graceDays must be a non-negative integer");
  }
  return daysOverdue(dueDate, asOf) > graceDays;
}

/** True when a milestone falls due on or before `asOf` + `windowDays`. */
export function isDueWithin(dueDate: string, asOf: string, windowDays: number): boolean {
  if (windowDays < 0 || !Number.isInteger(windowDays)) {
    throw new MilestoneDomainError("INVALID_WINDOW", "windowDays must be a non-negative integer");
  }
  const due = parseDateOnly(dueDate);
  const ref = parseDateOnly(asOf);
  const daysUntil = Math.floor((due.getTime() - ref.getTime()) / MS_PER_DAY);
  return daysUntil <= windowDays;
}

// ── Penalty computation (exact BigInt minor units) ──────────────────────────

export type PenaltyKind = "fixed" | "percentage" | "per_day";
export type PenaltyTrigger = "milestone_missed" | "sla_breached";

export interface PenaltyTermSpec {
  penaltyKind: PenaltyKind;
  /** Minor units. Required for "fixed" and "per_day". */
  penaltyAmountMinor?: bigint | undefined;
  /** Basis points (1 bp = 0.01%). Required for "percentage". */
  penaltyRateBps?: number | undefined;
  /** Cap as basis points of the milestone amount. 10000 bp = 100%. */
  maxPenaltyBps: number;
  /** Grace days before the penalty starts accruing. */
  thresholdValue: number;
}

export interface PenaltyComputationInput {
  term: PenaltyTermSpec;
  /** Milestone value in minor units. Cap is a fraction of this. */
  milestoneAmountMinor: bigint;
  /** Days late. Only consulted by "per_day". */
  overdueDays: number;
}

export interface PenaltyComputationResult {
  /** Exact penalty in minor units, after the cap. */
  penaltyMinor: bigint;
  /** Penalty before the cap was applied. */
  uncappedMinor: bigint;
  /** The cap that applied, in minor units. */
  capMinor: bigint;
  capped: boolean;
  /** Days actually charged (per_day only, after the grace threshold). */
  chargeableDays: number;
  /** Milestone amount less the penalty, floored at zero. */
  netPayableMinor: bigint;
}

const BPS_DIVISOR = 10_000n;

/**
 * Compute a penalty in exact minor units.
 *
 * Every arithmetic step is BigInt. Nothing is ever cast to Number: basis
 * points and day counts are integers, so `amount * BigInt(bps) / 10000n` is
 * exact integer division truncating toward zero (i.e. rounding in the payer's
 * favour, the conservative choice for a government recovery).
 *
 * Amounts above 2^53 stay exact — proven by the domain tests.
 */
export function computePenalty(input: PenaltyComputationInput): PenaltyComputationResult {
  const { term, milestoneAmountMinor, overdueDays } = input;

  if (milestoneAmountMinor < 0n) {
    throw new MilestoneDomainError("INVALID_AMOUNT", "milestoneAmountMinor must be non-negative");
  }
  if (!Number.isInteger(overdueDays) || overdueDays < 0) {
    throw new MilestoneDomainError("INVALID_OVERDUE", "overdueDays must be a non-negative integer");
  }
  if (!Number.isInteger(term.maxPenaltyBps) || term.maxPenaltyBps < 0 || term.maxPenaltyBps > 10_000) {
    throw new MilestoneDomainError("INVALID_CAP", "maxPenaltyBps must be an integer between 0 and 10000");
  }
  if (!Number.isInteger(term.thresholdValue) || term.thresholdValue < 0) {
    throw new MilestoneDomainError("INVALID_THRESHOLD", "thresholdValue must be a non-negative integer");
  }

  const chargeableDays = Math.max(0, overdueDays - term.thresholdValue);

  let uncappedMinor: bigint;
  switch (term.penaltyKind) {
    case "fixed": {
      uncappedMinor = requireAmount(term);
      break;
    }
    case "per_day": {
      uncappedMinor = requireAmount(term) * BigInt(chargeableDays);
      break;
    }
    case "percentage": {
      const bps = requireRateBps(term);
      uncappedMinor = (milestoneAmountMinor * BigInt(bps)) / BPS_DIVISOR;
      break;
    }
    default: {
      // Exhaustive over PenaltyKind; guards against an unvalidated DB value.
      throw new MilestoneDomainError("UNKNOWN_PENALTY_KIND", `unsupported penalty kind '${String(term.penaltyKind)}'`);
    }
  }

  const capMinor = (milestoneAmountMinor * BigInt(term.maxPenaltyBps)) / BPS_DIVISOR;
  const capped = uncappedMinor > capMinor;
  const penaltyMinor = capped ? capMinor : uncappedMinor;
  const netPayableMinor = milestoneAmountMinor > penaltyMinor ? milestoneAmountMinor - penaltyMinor : 0n;

  return { penaltyMinor, uncappedMinor, capMinor, capped, chargeableDays, netPayableMinor };
}

function requireAmount(term: PenaltyTermSpec): bigint {
  if (term.penaltyAmountMinor === undefined || term.penaltyAmountMinor === null) {
    throw new MilestoneDomainError(
      "MISSING_PENALTY_AMOUNT",
      `penalty kind '${term.penaltyKind}' requires penaltyAmountMinor`,
    );
  }
  if (term.penaltyAmountMinor < 0n) {
    throw new MilestoneDomainError("INVALID_PENALTY_AMOUNT", "penaltyAmountMinor must be non-negative");
  }
  return term.penaltyAmountMinor;
}

function requireRateBps(term: PenaltyTermSpec): number {
  if (term.penaltyRateBps === undefined || term.penaltyRateBps === null) {
    throw new MilestoneDomainError("MISSING_PENALTY_RATE", "penalty kind 'percentage' requires penaltyRateBps");
  }
  if (!Number.isInteger(term.penaltyRateBps) || term.penaltyRateBps < 0 || term.penaltyRateBps > 10_000) {
    throw new MilestoneDomainError("INVALID_PENALTY_RATE", "penaltyRateBps must be an integer between 0 and 10000");
  }
  return term.penaltyRateBps;
}

/**
 * Validate that a term's money representation matches its kind. Mirrors the
 * penalty_terms_representation_check CHECK constraint so a bad term is
 * rejected at the route boundary rather than by a Postgres error.
 */
export function assertTermRepresentation(term: PenaltyTermSpec): void {
  if (term.penaltyKind === "percentage") {
    if (term.penaltyAmountMinor !== undefined && term.penaltyAmountMinor !== null) {
      throw new MilestoneDomainError(
        "TERM_REPRESENTATION",
        "a percentage penalty must use penaltyRateBps, not penaltyAmountMinor",
      );
    }
    requireRateBps(term);
    return;
  }
  if (term.penaltyRateBps !== undefined && term.penaltyRateBps !== null) {
    throw new MilestoneDomainError(
      "TERM_REPRESENTATION",
      `a '${term.penaltyKind}' penalty must use penaltyAmountMinor, not penaltyRateBps`,
    );
  }
  requireAmount(term);
}

// ── Double-count business key ──────────────────────────────────────────────

/**
 * Deterministic identity of the occurrence being penalised. Combined with
 * (tenantId, penaltyTermId) this is the UNIQUE business key in
 * mou.penalty_applications, so the same occurrence cannot be charged twice
 * even under command redelivery.
 */
export function occurrenceKey(trigger: PenaltyTrigger, ref: string): string {
  if (!ref || ref.trim() === "") {
    throw new MilestoneDomainError("INVALID_OCCURRENCE_REF", "occurrence reference must not be blank");
  }
  return trigger === "milestone_missed" ? `milestone:${ref}` : `sla:${ref}`;
}

// ── Review-date cadence ────────────────────────────────────────────────────

export const REVIEW_CADENCES = ["monthly", "quarterly", "half_yearly", "annual"] as const;
export type ReviewCadence = (typeof REVIEW_CADENCES)[number];

const CADENCE_MONTHS: Record<ReviewCadence, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annual: 12,
};

export function isReviewCadence(value: string): value is ReviewCadence {
  return (REVIEW_CADENCES as readonly string[]).includes(value);
}

/**
 * Advance a review date by one cadence period.
 *
 * Month arithmetic clamps to the end of the target month, so 2026-01-31 plus
 * one month is 2026-02-28 rather than rolling into March. Government review
 * calendars are month-anchored, and silently sliding a date forward a month
 * would drift the whole schedule.
 */
export function nextReviewDate(from: string, cadence: string): string {
  if (!isReviewCadence(cadence)) {
    throw new MilestoneDomainError("INVALID_CADENCE", `unknown review cadence '${cadence}'`);
  }
  const base = parseDateOnly(from);
  const months = CADENCE_MONTHS[cadence];

  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();

  const targetMonthIndex = m + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;

  // Day 0 of the following month == last day of the target month.
  const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = d > lastDayOfTarget ? lastDayOfTarget : d;

  return toDateOnly(new Date(Date.UTC(targetYear, targetMonth, day)));
}

/** True when a scheduled review falls due on or before `asOf`. */
export function isReviewDue(nextDate: string, asOf: string): boolean {
  return parseDateOnly(nextDate).getTime() <= parseDateOnly(asOf).getTime();
}

export const REVIEW_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const REVIEW_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  // Completing a cycle re-schedules the next one, hence completed → scheduled.
  scheduled: ["completed", "cancelled"],
  completed: ["scheduled"],
  cancelled: [],
};

export function assertReviewTransition(from: string, to: string): void {
  const fromOk = (REVIEW_STATUSES as readonly string[]).includes(from);
  const toOk = (REVIEW_STATUSES as readonly string[]).includes(to);
  if (!fromOk || !toOk) {
    throw new MilestoneDomainError("UNKNOWN_STATUS", `unknown review status '${fromOk ? to : from}'`);
  }
  if (!REVIEW_TRANSITIONS[from as ReviewStatus].includes(to as ReviewStatus)) {
    throw new MilestoneDomainError(
      "INVALID_TRANSITION",
      `review schedule cannot transition from '${from}' to '${to}'`,
    );
  }
}
