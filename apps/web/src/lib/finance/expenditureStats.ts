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

/**
 * Guarantees: the summary has no expiry/validity date, so "Expiring Soon"
 * cannot be computed. What the data supports is the count of guarantees that
 * are neither active nor released (expired, invoked, cancelled...) --
 * GAP-FINANCE-EXPENDITURE-GUARANTEES-01.
 */
export function guaranteeStats(guarantees: readonly { status: string }[]) {
  let active = 0;
  let released = 0;
  for (const g of guarantees) {
    const s = String(g.status).toLowerCase();
    if (s === "active") active += 1;
    else if (s === "released") released += 1;
  }
  return { total: guarantees.length, active, released, otherStatus: guarantees.length - active - released };
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
  for (const u of ucs) {
    const s = String(u.status).toLowerCase();
    if (s === "submitted" || s === "verified") submittedVerified += 1;
    else if (s === "pending") pending += 1;
    else if (s === "rejected") rejected += 1;
    covered += safeBig(u.amount);
  }
  return { total: ucs.length, submittedVerified, pending, rejected, covered };
}
