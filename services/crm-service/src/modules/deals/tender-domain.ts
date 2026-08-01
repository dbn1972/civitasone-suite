/**
 * Pure bid-stage state machine for tenders / RFPs (KA-003).
 *
 * identified → qualified → bid_prepared → submitted → won | lost
 *
 * `won` and `lost` are terminal: once an award decision is published there is no
 * legitimate way back, and allowing it would corrupt win-rate reporting. A
 * genuinely re-tendered opportunity is a NEW tender_ref, not a reopened row.
 */

export const BID_STAGES = [
  "identified",
  "qualified",
  "bid_prepared",
  "submitted",
  "won",
  "lost",
] as const;

export type BidStage = (typeof BID_STAGES)[number];

/** Minimum characters required in a loss reason before a bid can be marked lost. */
export const LOSS_REASON_MIN_LENGTH = 10;

const TRANSITIONS: Readonly<Record<BidStage, readonly BidStage[]>> = {
  identified: ["qualified"],
  qualified: ["bid_prepared"],
  bid_prepared: ["submitted"],
  submitted: ["won", "lost"],
  won: [],
  lost: [],
};

export function isBidStage(value: string): value is BidStage {
  return (BID_STAGES as readonly string[]).includes(value);
}

/** Stages from which no further transition is permitted. */
export function isTerminalStage(stage: BidStage): boolean {
  return TRANSITIONS[stage].length === 0;
}

export function allowedNextStages(stage: BidStage): readonly BidStage[] {
  return TRANSITIONS[stage];
}

/** True when `from → to` is a legal single step in the bid pipeline. */
export function canTransition(from: BidStage, to: BidStage): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A loss must be explained — win/loss analysis is worthless without a reason. */
export function requiresLossReason(to: BidStage): boolean {
  return to === "lost";
}

export function isValidLossReason(reason: string | undefined | null): boolean {
  return (reason ?? "").trim().length >= LOSS_REASON_MIN_LENGTH;
}
