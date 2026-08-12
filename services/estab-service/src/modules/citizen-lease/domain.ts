/**
 * Citizen-lease domain logic — pure functions, no IO.
 *
 * Enforces:
 *   - Lease and request state machines
 *   - Late fee calculation (2% per month overdue)
 *   - Renewal eligibility (no outstanding dues, within 90 days of expiry)
 *   - Pro-rata rent calculation
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// ── State Machines ────────────────────────────────────────────────────────

const LEASE_TRANSITIONS: Record<string, string[]> = {
  active:      ["expired", "renewed", "transferred", "surrendered", "terminated"],
  expired:     ["renewed"],
  renewed:     ["expired", "transferred", "surrendered", "terminated"],
  transferred: [],
  surrendered: [],
  terminated:  [],
};

const REQUEST_TRANSITIONS: Record<string, string[]> = {
  submitted:    ["under_review", "rejected"],
  under_review: ["approved", "rejected"],
  approved:     ["completed"],
  rejected:     [],
  completed:    [],
};

export { LEASE_TRANSITIONS, REQUEST_TRANSITIONS };

export function assertLeaseTransition(current: string, target: string): void {
  const allowed = LEASE_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new DomainError("INVALID_TRANSITION", `cannot transition lease from '${current}' to '${target}'`);
  }
}

export function assertRequestTransition(current: string, target: string): void {
  const allowed = REQUEST_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new DomainError("INVALID_TRANSITION", `cannot transition request from '${current}' to '${target}'`);
  }
}

// ── Number Generators ─────────────────────────────────────────────────────

export function generateLeaseNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `LS-${ts}-${rand}`;
}

export function generateRequestNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `LR-${ts}-${rand}`;
}

// ── Late Fee ──────────────────────────────────────────────────────────────

/**
 * Calculate late fee: 2% of rent per month overdue.
 * @param rentMinor - monthly rent in paise
 * @param monthsOverdue - number of months past due date
 */
export function calculateLateFee(rentMinor: bigint, monthsOverdue: number): bigint {
  if (monthsOverdue <= 0) return 0n;
  // 2% per month = rentMinor * 2 * monthsOverdue / 100
  return (rentMinor * BigInt(monthsOverdue) * 2n) / 100n;
}

// ── Renewal Eligibility ───────────────────────────────────────────────────

/**
 * Check if a lease is eligible for renewal:
 *   - No outstanding (unpaid) dues
 *   - Within 90 days of lease expiry
 */
export function isRenewalEligible(
  leaseEndDate: Date,
  currentDate: Date,
  hasOutstandingDues: boolean,
): { eligible: boolean; reason: string | undefined } {
  if (hasOutstandingDues) {
    return { eligible: false, reason: "outstanding dues must be cleared before renewal" };
  }
  const msPerDay = 86_400_000;
  const daysUntilExpiry = Math.ceil((leaseEndDate.getTime() - currentDate.getTime()) / msPerDay);
  if (daysUntilExpiry > 90) {
    return { eligible: false, reason: `renewal window opens 90 days before expiry (${daysUntilExpiry} days remaining)` };
  }
  return { eligible: true, reason: undefined };
}

// ── Pro-Rata Rent ─────────────────────────────────────────────────────────

/**
 * Calculate pro-rata rent for a partial month.
 * @param monthlyRentMinor - full month rent in paise
 * @param daysInMonth - total days in the month
 * @param occupiedDays - days the property was occupied
 */
export function calculateProRataRent(
  monthlyRentMinor: bigint,
  daysInMonth: number,
  occupiedDays: number,
): bigint {
  if (occupiedDays >= daysInMonth) return monthlyRentMinor;
  return (monthlyRentMinor * BigInt(occupiedDays)) / BigInt(daysInMonth);
}
