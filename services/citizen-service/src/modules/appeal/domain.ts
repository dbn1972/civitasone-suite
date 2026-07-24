/**
 * SVC-089 — pure appeal domain helpers (no I/O, unit-tested).
 *
 * Covers: filing-window validation (an appeal must be filed within N days of the
 * decision), the order taxonomy, and the outcome mapping for the appellate order
 * (including the remand path). Maker-checker is enforced in the command layer:
 * prepared_by (maker) drafts the order, decided_by (checker, must differ) issues
 * it.
 */

export const APPEAL_TYPES = ["appeal", "review", "revision"] as const;
export type AppealType = typeof APPEAL_TYPES[number];

export const APPEAL_STATUSES = ["filed", "assigned", "hearing", "decided", "remanded", "closed"] as const;
export type AppealStatus = typeof APPEAL_STATUSES[number];

export const ORDER_TYPES = ["upheld", "overturned", "modified", "remanded"] as const;
export type OrderType = typeof ORDER_TYPES[number];

/** Default statutory filing window (days) when a service does not override it. */
export const DEFAULT_FILING_WINDOW_DAYS = 30;

export function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Validate a filing against the decision date + window. Filing on the deadline
 * day itself is allowed; filing after it is rejected. Returns the computed
 * filing deadline (as a YYYY-MM-DD string) for persistence.
 */
export function assertWithinFilingWindow(
  decisionDate: Date,
  windowDays: number,
  filedAt: Date = new Date(),
): { filingDeadline: string } {
  const deadline = addDays(decisionDate, windowDays);
  // Compare on date granularity so a same-day filing at any time is in-window.
  const deadlineDay = toDateString(deadline);
  const filedDay = toDateString(filedAt);
  if (filedDay > deadlineDay) {
    throw new Error("FILING_WINDOW_EXPIRED");
  }
  return { filingDeadline: deadlineDay };
}

/** Map an order type to the appeal's terminal outcome + resulting status. */
export function orderOutcome(orderType: OrderType): { status: AppealStatus; outcome: string } {
  if (orderType === "remanded") return { status: "remanded", outcome: "remanded" };
  return { status: "decided", outcome: orderType };
}

/** A legal order can only be prepared/issued once the appeal has been heard. */
export function canIssueOrder(status: string): boolean {
  return status === "hearing" || status === "assigned";
}
