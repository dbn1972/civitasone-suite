/**
 * Quarters domain logic — pure functions, no IO.
 *
 * Enforces:
 *   - Maker-checker: allotment approver ≠ applicant
 *   - State machine: applied→waitlisted→allotted→occupied→vacation_notice→vacated
 *   - Eligibility scoring: pay_level + seniority (configurable weights)
 *   - Overstay calculation from vacation_due_date
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// ── State Machine ─────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  applied:          ["waitlisted", "cancelled"],
  waitlisted:       ["allotted", "cancelled"],
  allotted:         ["occupied", "cancelled"],
  occupied:         ["vacation_notice", "vacated"],
  vacation_notice:  ["vacated"],
};

export function assertValidTransition(current: string, target: string): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new DomainError("INVALID_TRANSITION", `cannot transition from '${current}' to '${target}'`);
  }
}

// ── Maker-Checker ─────────────────────────────────────────────────────────

export function assertMakerChecker(applicantRef: string, approverActorId: string): void {
  if (applicantRef === approverActorId) {
    throw new DomainError("MAKER_CHECKER_VIOLATION", "allotment approver cannot be the applicant");
  }
}

// ── Eligibility ───────────────────────────────────────────────────────────

/**
 * Compute eligibility score based on pay level and seniority months.
 * Higher pay level = higher priority; tie-broken by seniority.
 * Weights are NOT hardcoded — they come from config/master data.
 */
export function computeEligibilityScore(
  payLevel: number,
  seniorityMonths: number,
  weights: { payLevelWeight: number; seniorityWeight: number } = { payLevelWeight: 10, seniorityWeight: 1 },
): number {
  return payLevel * weights.payLevelWeight + seniorityMonths * weights.seniorityWeight;
}

// ── Overstay ──────────────────────────────────────────────────────────────

/**
 * Calculate overstay penalty.
 * @param vacationDueDate - date allottee must vacate
 * @param actualVacateDate - date they actually vacated (or today if still there)
 * @param dailyRateMinor - daily licence-fee in paise
 * @param multiplier - penalty multiplier (default 2x)
 */
export function computeOverstayPenalty(
  vacationDueDate: Date,
  actualVacateDate: Date,
  dailyRateMinor: bigint,
  multiplier: number = 2,
): { penaltyDays: number; totalMinor: bigint } {
  const msPerDay = 86_400_000;
  const diff = actualVacateDate.getTime() - vacationDueDate.getTime();
  const penaltyDays = Math.max(0, Math.ceil(diff / msPerDay));
  if (penaltyDays === 0) return { penaltyDays: 0, totalMinor: 0n };
  // totalMinor = penaltyDays * dailyRateMinor * multiplier
  // Use integer math: multiply first, then apply multiplier as fraction
  const multiplierPaise = BigInt(Math.round(multiplier * 100));
  const totalMinor = (BigInt(penaltyDays) * dailyRateMinor * multiplierPaise) / 100n;
  return { penaltyDays, totalMinor };
}

// ── Licence-Fee Lookup ────────────────────────────────────────────────────

/**
 * Find the applicable licence-fee rate for a given quarter type, pay level, and date.
 * Uses effective-dating: the rate whose effectiveFrom <= date and (effectiveTo is null or >= date).
 */
export function findApplicableRate<T extends { effectiveFrom: string; effectiveTo: string | null }>(
  rates: T[],
  asOfDate: string,
): T | null {
  const d = new Date(asOfDate);
  return rates.find((r) => {
    const from = new Date(r.effectiveFrom);
    if (from > d) return false;
    if (r.effectiveTo) {
      const to = new Date(r.effectiveTo);
      if (to < d) return false;
    }
    return true;
  }) ?? null;
}
