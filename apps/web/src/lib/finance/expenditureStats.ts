/**
 * GAP-FINANCE-EXPENDITURE-* stat-card definitions, as pure functions so each
 * card means exactly what its label says and can be unit-tested.
 *
 * Money fields on these summaries are bigint-safe minor-unit (paise) STRINGs,
 * so all sums accumulate in BigInt -- never "+" on strings.
 */
import { daysUntilIST } from "@/lib/formatters";

/** Statuses an advance can still be recovered from (balance outstanding). */
const ADVANCE_RECOVERED = new Set(["adjusted", "closed"]);

export interface AdvanceStatInput {
  status: string;
  balance: string;
  adjustedAmount: string;
  dueDate?: string | null;
}

function safeBig(v: string | null | undefined): bigint {
  try {
    return BigInt(v ?? "0");
  } catch {
    return 0n;
  }
}

/**
 * - open: status "active"
 * - outstanding: sum of balances
 * - settledAllTime: adjusted amount of advances with status "adjusted". The
 *   API exposes no adjustment date, so this is honestly an all-time figure
 *   (GAP-FINANCE-EXPENDITURE-ADVANCES-01) -- never labelled "MTD".
 * - overdue90: still-recoverable advances (balance > 0, not adjusted/closed)
 *   whose dueDate is MORE than 90 IST calendar days in the past.
 */
export function advanceStats(advances: readonly AdvanceStatInput[]) {
  let open = 0;
  let outstanding = 0n;
  let settledAllTime = 0n;
  let overdue90 = 0;
  for (const a of advances) {
    const status = String(a.status).toLowerCase();
    const balance = safeBig(a.balance);
    if (status === "active") open += 1;
    outstanding += balance;
    if (status === "adjusted") settledAllTime += safeBig(a.adjustedAmount);
    if (!ADVANCE_RECOVERED.has(status) && balance > 0n) {
      const days = daysUntilIST(a.dueDate);
      if (days !== null && days < -90) overdue90 += 1;
    }
  }
  return { open, outstanding, settledAllTime, overdue90 };
}

export interface BillStatInput {
  status: string;
  amount: string;
}

/**
 * - inProcess: every bill still on its way to payment: pending, under_review,
 *   on_hold, and passed-but-unpaid (finance-service emits "passed" for a bill
 *   awaiting payment, the largest real outstanding liability)
 * - pipelineValue: value of those bills (paid and rejected bills are not "in
 *   the pipeline") -- GAP-FINANCE-EXPENDITURE-BILLS-02
 * - paidAllTime: sum of paid bills. BillSummary carries no paid date, so
 *   this is all-time, not month-to-date.
 */
const IN_PIPELINE = new Set(["pending", "under_review", "on_hold", "passed", "approved", "draft"]);

export function billStats(bills: readonly BillStatInput[]) {
  let inProcess = 0;
  let pipelineValue = 0n;
  let paidAllTime = 0n;
  for (const b of bills) {
    const status = String(b.status).toLowerCase();
    if (IN_PIPELINE.has(status)) {
      inProcess += 1;
      pipelineValue += safeBig(b.amount);
    } else if (status === "paid") {
      paidAllTime += safeBig(b.amount);
    }
  }
  return { inProcess, pipelineValue, paidAllTime };
}

/** A guarantee is flagged "expiring" when it lapses within this many days (IST). */
export const GUARANTEE_EXPIRY_WINDOW_DAYS = 30;

export type GuaranteeValidity = "none" | "ok" | "expiring" | "lapsed";

/**
 * Validity of one guarantee from its validity date (IST calendar days):
 *  - released / cancelled guarantees are never flagged (nothing left to renew)
 *  - no validUntil on the row (older data) -> "none": never guessed
 *  - validUntil in the past -> "lapsed"; within the window (today included) -> "expiring"
 */
export function guaranteeValidity(
  g: { status: string; validUntil?: string | null },
  windowDays = GUARANTEE_EXPIRY_WINDOW_DAYS,
): GuaranteeValidity {
  const s = String(g.status).toLowerCase();
  if (s === "fully_released" || s === "released" || s === "cancelled") return "none";
  const days = daysUntilIST(g.validUntil);
  if (days === null) return "none";
  if (days < 0) return "lapsed";
  return days <= windowDays ? "expiring" : "ok";
}

/**
 * Guarantees (GAP-FINANCE-EXPENDITURE-GUARANTEES-01). "Expiring soon" is an
 * ACTIVE guarantee whose validity ends within the window; "lapsed" is one whose
 * validity has already ended without being released. Neither is inferred from
 * status alone, and a row with no validity date counts as neither.
 */
export function guaranteeStats(guarantees: readonly { status: string; validUntil?: string | null }[]) {
  let active = 0;
  let released = 0;
  let expiringSoon = 0;
  let lapsed = 0;
  for (const g of guarantees) {
    const s = String(g.status).toLowerCase();
    if (s === "active") active += 1;
    // finance_guarantees.status CHECK is active | partially_released |
    // fully_released | cancelled -- a bare "released" never occurs, so the
    // Released card was permanently 0 and fully-released guarantees were
    // miscounted as "other". "released" kept for legacy/seeded rows.
    else if (s === "fully_released" || s === "released") released += 1;
    const v = guaranteeValidity(g);
    if (v === "expiring") expiringSoon += 1;
    else if (v === "lapsed") lapsed += 1;
  }
  return { total: guarantees.length, active, released, expiringSoon, lapsed, otherStatus: guarantees.length - active - released };
}

/** Schemes: "other" = neither active nor completed (GAP-...-SCHEME-TRACKING-02). */
export function schemeStats(schemes: readonly { status: string }[]) {
  let active = 0;
  let completed = 0;
  for (const s of schemes) {
    const st = String(s.status).toLowerCase();
    if (st === "active") active += 1;
    else if (st === "completed") completed += 1;
  }
  return { total: schemes.length, active, completed, otherStatus: schemes.length - active - completed };
}

/** UCs: a rejected (returned) UC is NOT "pending submission" (GAP-...-UTILIZATION-CERTIFICATES-01). */
export function ucStats(ucs: readonly { status: string; amount: string }[]) {
  let submittedVerified = 0;
  let pending = 0;
  let rejected = 0;
  let covered = 0n;
  let pendingAmount = 0n;
  for (const u of ucs) {
    const s = String(u.status).toLowerCase();
    // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-03: "covered" counts
    // only UCs that have been submitted or verified; a pending UC is reported
    // separately and a rejected (returned) UC counts toward neither.
    if (s === "submitted" || s === "verified") {
      submittedVerified += 1;
      covered += safeBig(u.amount);
    } else if (s === "pending") {
      pending += 1;
      pendingAmount += safeBig(u.amount);
    } else if (s === "rejected") rejected += 1;
  }
  return { total: ucs.length, submittedVerified, pending, rejected, covered, pendingAmount };
}
