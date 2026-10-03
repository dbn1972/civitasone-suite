/**
 * GAP-PAYROLL-PAY-GROUPS-03: pure rules for pay-group membership.
 *
 * Govt / PSU practice: payroll is drawn bill by bill (a DDO's gazetted
 * establishment bill, non-gazetted establishment bill, contractual /
 * outsourced-staff bill). A pay group is that bill's schedule master and an
 * employee is in exactly ONE pay group at a time. Membership is
 * effective-dated and a change normally takes effect from the 1st of a
 * month (a tenant may allow other dates).
 *
 * Dates are plain 'YYYY-MM-DD' strings (calendar dates, no timezone).
 * `effectiveTo` is EXCLUSIVE: the first day the employee is no longer a member.
 */

export const PAY_GROUP_BILL_TYPES = ["gazetted", "non_gazetted", "contract", "casual", "other"] as const;
export type PayGroupBillType = (typeof PAY_GROUP_BILL_TYPES)[number];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function isFirstOfMonth(s: string): boolean {
  return isIsoDate(s) && s.endsWith("-01");
}

/** First day of `month` ('YYYY-MM') and the first day of the next month. */
export function monthBounds(month: string): { start: string; endExclusive: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start: `${month}-01`, endExclusive: `${ny}-${String(nm).padStart(2, "0")}-01` };
}

/** 'YYYY-MM' of a calendar date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * A membership change must start on the 1st of a month unless the tenant has
 * switched on mid-month changes (pay_group_settings.allow_mid_month_effective).
 */
export function effectiveDateProblem(date: string, allowMidMonth: boolean): "INVALID_DATE" | "EFFECTIVE_DATE_NOT_MONTH_START" | null {
  if (!isIsoDate(date)) return "INVALID_DATE";
  if (!allowMidMonth && !isFirstOfMonth(date)) return "EFFECTIVE_DATE_NOT_MONTH_START";
  return null;
}

export type MembershipStatus = "current" | "scheduled" | "ended";

export function membershipStatus(from: string, to: string | null, today: string): MembershipStatus {
  if (from > today) return "scheduled";
  if (to !== null && to <= today) return "ended";
  return "current";
}

/** Today's calendar date in the payroll timezone (India). */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Which group pays an employee for a month, given the employee's
 * assignments: of those overlapping the month, the one that starts latest
 * (a mid-month move is paid by the new group; an assignment that ended
 * mid-month with no successor still pays its last month). Pure mirror of the
 * SQL in pay-group-repo.ts resolveMonthMembers.
 */
export function groupForMonth(
  assignments: ReadonlyArray<{ payGroupId: string; effectiveFrom: string; effectiveTo: string | null }>,
  month: string,
): string | null {
  const { start, endExclusive } = monthBounds(month);
  const covering = assignments
    .filter((a) => a.effectiveFrom < endExclusive && (a.effectiveTo ?? "9999-12-31") > start)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return covering[0]?.payGroupId ?? null;
}

export const MEMBERSHIP_REASON_MIN = 10;

export type AssignmentSpan = { id: string; payGroupId: string; effectiveFrom: string; effectiveTo: string | null };

export type AssignmentPlan =
  | { kind: "insert" }
  | { kind: "move"; closeId: string; fromPayGroupId: string }
  | { kind: "unchanged"; code: "ALREADY_MEMBER" }
  | { kind: "reject"; code: "MEMBERSHIP_OVERLAP"; message: string };

/**
 * What putting an employee in `payGroupId` from `effectiveFrom` does to the
 * employee's existing assignments: add the first one, MOVE them (close the
 * assignment covering that date), leave a no-op (already in that group) or
 * refuse (a later assignment already exists, or the covering one starts on the
 * very same day). Pure; the SQL layer applies exactly this plan.
 */
export function planAssignment(existing: readonly AssignmentSpan[], payGroupId: string, effectiveFrom: string): AssignmentPlan {
  const later = existing.find((a) => a.effectiveFrom > effectiveFrom);
  if (later) {
    return { kind: "reject", code: "MEMBERSHIP_OVERLAP", message: `the employee already has an assignment starting ${later.effectiveFrom}, after the requested date` };
  }
  const covering = existing.find((a) => a.effectiveFrom <= effectiveFrom && (a.effectiveTo === null || a.effectiveTo > effectiveFrom));
  if (!covering) return { kind: "insert" };
  if (covering.payGroupId === payGroupId) return { kind: "unchanged", code: "ALREADY_MEMBER" };
  if (covering.effectiveFrom === effectiveFrom) {
    return { kind: "reject", code: "MEMBERSHIP_OVERLAP", message: "the employee's current assignment starts on the same date; choose a later date" };
  }
  return { kind: "move", closeId: covering.id, fromPayGroupId: covering.payGroupId };
}
