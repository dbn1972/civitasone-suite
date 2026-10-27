/**
 * Billing domain logic — e-MB finalization sequence, bill finalization,
 * quantity checks, and net payable calculation.
 */
import { calculateBoqAmount } from "../boq/domain.js";

export interface MeasurementLine {
  boqItemId: string;
  quantity: string | number;
}

/**
 * Sum quantity × BoQ rate over a set of measurement lines to get the total
 * value of work actually measured — the ceiling a bill referencing these
 * measurements (via its MB) may not exceed. A boqItemId with no entry in
 * `rateByBoqItem` contributes 0 (defensive; should not happen since every
 * measurement is validated against a real BoQ item at record time).
 */
export function computeMeasuredValueMinor(
  lines: MeasurementLine[],
  rateByBoqItem: Map<string, bigint>,
): bigint {
  return lines.reduce((sum, m) => {
    const rate = rateByBoqItem.get(m.boqItemId);
    if (rate === undefined) return sum;
    return sum + calculateBoqAmount(rate, Number(m.quantity));
  }, 0n);
}

/**
 * e-MB finalization sequence: SO → SDO → Estimator → DO
 */
export function eMbFinalizationSequence(): string[] {
  return ["so_finalized", "sdo_finalized", "estimator_finalized", "do_finalized"];
}

/**
 * Bill finalization sequence: SO → SDO → Auditor → DAO → DO
 */
export function billFinalizationSequence(): string[] {
  return ["so_finalized", "sdo_finalized", "auditor_finalized", "dao_finalized", "do_finalized"];
}

/**
 * GAP-WORKS-BILLING-WORKID-03/07: per-step finalizer authority, keyed by the
 * TARGET status. Each step may only be advanced by the officer it represents
 * (or a tenant admin override). The blanket WRITE_ROLES gate let any role
 * drive the whole chain; this narrows each step.
 * OWNER DECISION 2026-10-14: finalize roles are SO, SDO, estimator, auditor, DAO and DO, with works_admin and
 * super_admin as override; the maker cannot finalize (isSelfFinalization). works_operator holds no finalize step.
 */
const ADMIN_STEP_ROLES = ["works_admin", "super_admin"];
const STEP_OFFICER_ROLE: Record<string, string> = {
  so_finalized: "section_officer",
  sdo_finalized: "sdo",
  estimator_finalized: "estimator",
  auditor_finalized: "auditor",
  dao_finalized: "dao",
  do_finalized: "do",
};

export function finalizeStepRoles(nextStatus: string): string[] {
  const officer = STEP_OFFICER_ROLE[nextStatus];
  return officer ? [officer, ...ADMIN_STEP_ROLES] : [...ADMIN_STEP_ROLES];
}

/**
 * GAP-WORKS-BILLING-WORKID-03: maker-checker. The actor who created/issued a
 * bill or MB must not be the one who finalizes any step of it.
 */
export function isSelfFinalization(
  actorId: string,
  maker: { createdBy?: string | null; issuedBy?: string | null },
): boolean {
  const makers = [maker.createdBy, maker.issuedBy].filter((x): x is string => !!x);
  return makers.includes(actorId);
}

/**
 * Check if a bill can be created from an MB.
 * MB must be fully finalized (do_finalized).
 */
export function canCreateBill(mbStatus: string): boolean {
  return mbStatus === "do_finalized";
}

/**
 * Advisory-lock key that serialises bill creation per (tenant, work): the bill number is unique within a work, and the
 * duplicate check in the billCreate consumer is only race-free if concurrent creates for the same work queue up.
 */
export function billNumberLockKey(tenantId: string, workId: string): string {
  return `works:bill-number:${tenantId}:${workId}`;
}

/**
 * A measurement may only be recorded while the MB is still a draft. Once the finalization chain starts (SO, SDO,
 * estimator, DO) the MB content is what those officers are approving, and once it is do_finalized it is the measured
 * value a bill is checked against; recording into it afterwards would silently change the billing ceiling.
 */
export function canRecordMeasurement(mbStatus: string): boolean {
  return mbStatus === "draft";
}

/**
 * FR-BIL-011: Check if billed quantity exceeds BoQ approved quantity.
 */
export function billedQuantityExceedsBoq(billed: number, boqApproved: number): boolean {
  return billed > boqApproved;
}

/**
 * Bug fix (works-billing-integrity #2): the award cited on a bill must
 * actually belong to the work being billed. Without this, the award-ceiling
 * check (billAmountExceedsAward) can be defeated by citing a different
 * work's award with a higher/unspent ceiling.
 */
export function awardBelongsToWork(award: { workId: string }, workId: string): boolean {
  return award.workId === workId;
}

/**
 * FR-BIL-012: cumulative gross bill amount (prior bills + this bill) must not
 * exceed the accepted award ceiling.
 */
export function billAmountExceedsAward(
  priorBilledGross: bigint,
  newBillGross: bigint,
  awardCeiling: bigint,
): boolean {
  return priorBilledGross + newBillGross > awardCeiling;
}

/**
 * No-3-way-match fix: cumulative gross billed AGAINST THIS MB (prior bills
 * citing the same mbId + this bill) must not exceed the value of the work
 * actually measured and recorded against that MB (sum of quantity × BoQ
 * rate over every measurement line under it — see boq/domain.ts
 * calculateBoqAmount). This is the real "was the work done" check;
 * billAmountExceedsAward only bounds total spend against the award ceiling
 * (sized for many sequential RA bills) and says nothing about whether the
 * SAME measured work was already paid for.
 *
 * Cumulative by design, mirroring billAmountExceedsAward: a single MB may
 * legitimately back more than one bill over time (partial/staged RA
 * billing), so this must not reset per-bill — it must track how much of
 * the MB's measured value has already been billed. Code-review fix
 * (double-billing gap): the original single-arg form compared only this
 * bill's own gross against the full measured value, so a second bill
 * citing an MB already fully billed would recompute the same measured
 * value and pass again.
 */
export function billAmountExceedsMeasuredValue(
  priorBilledAgainstMbMinor: bigint,
  newBillGross: bigint,
  measuredValueMinor: bigint,
): boolean {
  return priorBilledAgainstMbMinor + newBillGross > measuredValueMinor;
}

/**
 * A bill's MB must belong to the same work (and the same award) it is being
 * billed against — otherwise a caller could cite a finalized MB issued for a
 * different work/award to justify an unrelated bill's measured-value check.
 */
export function mbBelongsToBill(
  mb: { workId: string; awardId: string },
  workId: string,
  awardId: string,
): boolean {
  return mb.workId === workId && mb.awardId === awardId;
}

/**
 * Bug fix (works-cross-entity-integrity #1, CRITICAL): the BoQ item cited on
 * a measurement must belong to the same work as the MB it is being recorded
 * against. Without this, the "measured value" ceiling that bills are later
 * checked against (see computeMeasuredValueMinor / billAmountExceedsMeasuredValue
 * above) can be computed from a completely unrelated work's BoQ item/rate —
 * e.g. citing a high-rate BoQ item belonging to Work B while recording the
 * measurement against Work A's MB, then billing Work A up to that borrowed
 * ceiling even though Work A has no real BoQ items of its own. Same family as
 * awardBelongsToWork / mbBelongsToBill above.
 */
export function boqItemBelongsToMbWork(boqItem: { workId: string }, mb: { workId: string }): boolean {
  return boqItem.workId === mb.workId;
}

/** Terminal step in bill finalization — triggers finance hand-off. */
export function isTerminalBillStatus(status: string): boolean {
  return status === "do_finalized";
}

/**
 * Calculate net payable: gross - deductions.
 */
export function calculateNetPayable(gross: bigint, deductions: bigint): bigint {
  return gross - deductions;
}

/**
 * Validate finalization step is the correct next step in sequence.
 */
export function isValidNextStep(currentStatus: string, nextStatus: string, sequence: string[]): boolean {
  if (currentStatus === "draft") {
    return nextStatus === sequence[0];
  }
  const currentIdx = sequence.indexOf(currentStatus);
  if (currentIdx === -1) return false;
  const nextIdx = sequence.indexOf(nextStatus);
  return nextIdx === currentIdx + 1;
}

/**
 * D4c #37 (GAP-WORKS-BILLING-BILLS-NEW-03): the FIXED statutory deduction heads on a contractor bill. The set is not
 * configurable; only the default rate of each head is (per executing division, see works.deduction_rates).
 */
export const DEDUCTION_HEADS = ["security_deposit", "income_tax_tds", "gst_tds", "labour_cess", "retention"] as const;
export type DeductionHead = (typeof DEDUCTION_HEADS)[number];
export type DeductionRates = Record<DeductionHead, number>;

/**
 * Rates (basis points of the bill gross) used when neither the division nor the tenant has set one. They are only a
 * starting point: every one is editable per department by the works admin, and the maker can still adjust each amount.
 */
export const BUILT_IN_RATE_BPS: DeductionRates = {
  security_deposit: 500,
  income_tax_tds: 200,
  gst_tds: 200,
  labour_cess: 100,
  retention: 0,
};

export function isDeductionHead(v: unknown): v is DeductionHead {
  return typeof v === "string" && (DEDUCTION_HEADS as readonly string[]).includes(v);
}

export interface DeductionRateRow {
  divisionId: string | null;
  head: string;
  rateBps: number;
}

/** Per head: the division's own row, else the tenant-wide default row, else the built-in default. */
export function resolveRates(rows: DeductionRateRow[], divisionId: string | null): DeductionRates {
  const out = { ...BUILT_IN_RATE_BPS };
  for (const head of DEDUCTION_HEADS) {
    const tenantWide = rows.find((r) => r.divisionId === null && r.head === head);
    const own = divisionId === null ? undefined : rows.find((r) => r.divisionId === divisionId && r.head === head);
    const chosen = own ?? tenantWide;
    if (chosen) out[head] = chosen.rateBps;
  }
  return out;
}

export interface DeductionLine {
  head: DeductionHead;
  rateBps: number;
  amountMinor: bigint;
}

/** gross x rate, in exact paise (bigint), rounded half-up; one line per fixed head in the fixed order. */
export function computeDeductionLines(grossMinor: bigint, rates: DeductionRates): DeductionLine[] {
  return DEDUCTION_HEADS.map((head) => ({
    head,
    rateBps: rates[head],
    amountMinor: (grossMinor * BigInt(rates[head]) + 5000n) / 10000n,
  }));
}
