/**
 * Pure helpers for the Establishment Compliance register KPIs.
 *
 * GAP-ESTAB-COMPLIANCE-01: "Escalated" was `status==='overdue' && dueDate<today`
 * — a near-duplicate of "Overdue" (overdue already implies a past due date),
 * and `today` was computed in UTC (off by up to a day in IST). DECISION
 * (safest, honest; HUMAN REVIEW): the ComplianceSummary payload has NO
 * escalation level/target field, so escalation is defined as "overdue for more
 * than ESCALATION_DAYS days" using the IST calendar date. The tile is relabelled
 * accordingly so the number means something distinct from Overdue.
 *
 * GAP-ESTAB-COMPLIANCE-02: compliance rate is null (→ "—") on an empty register
 * instead of a misleading 0%.
 */

export const ESCALATION_DAYS = 7;

export interface ComplianceItemLike {
  status: "pending" | "complied" | "overdue" | "not_applicable";
  dueDate: string;
}

/** Whole days between two YYYY-MM-DD (or ISO) dates: a - b, floored. */
export function daysBetween(aYmd: string, bYmd: string): number {
  const a = Date.parse(`${aYmd.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${bYmd.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((a - b) / 86_400_000);
}

/** Overdue items whose due date is more than ESCALATION_DAYS days in the past. */
export function countEscalated(items: ComplianceItemLike[], todayYmd: string): number {
  return items.filter(
    (c) => c.status === "overdue" && daysBetween(todayYmd, c.dueDate) > ESCALATION_DAYS,
  ).length;
}

/** Compliance rate as a percentage, or null when there are no items. */
export function complianceRate(items: ComplianceItemLike[]): number | null {
  if (items.length === 0) return null;
  const complied = items.filter((c) => c.status === "complied").length;
  return Math.round((complied / items.length) * 100);
}
