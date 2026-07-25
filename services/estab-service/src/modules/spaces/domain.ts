/**
 * Spaces domain logic — pure functions, no IO.
 *
 * Enforces:
 *   - Maker-checker: allotment approver != requester
 *   - Allotment state machine: requested->allotted->occupied->released / cancelled
 *   - No double-allot: a seat may hold at most one active (allotted/occupied) allotment
 *   - Occupancy & availability computation
 *   - Prorated licence-fee (integer paise math)
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Allotment state machine ────────────────────────────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  requested: ["allotted", "cancelled"],
  allotted:  ["occupied", "released", "cancelled"],
  occupied:  ["released"],
};

export function assertValidAllotmentTransition(current: string, target: string): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new DomainError("INVALID_TRANSITION", `cannot transition allotment from '${current}' to '${target}'`);
  }
}

// ── Maker-checker ──────────────────────────────────────────────────────────
/** The actor approving/allotting must differ from the actor who raised the request. */
export function assertMakerChecker(requestedBy: string, approverActorId: string): void {
  if (requestedBy === approverActorId) {
    throw new DomainError("MAKER_CHECKER_VIOLATION", "allotment approver cannot be the requester");
  }
}

// ── No double-allot ────────────────────────────────────────────────────────
export const ACTIVE_ALLOTMENT_STATUSES = ["allotted", "occupied"] as const;

/** A seat is allottable only when it has no existing active allotment. */
export function assertSeatAllottable(existing: Array<{ status: string }>): void {
  const active = existing.filter((a) => (ACTIVE_ALLOTMENT_STATUSES as readonly string[]).includes(a.status));
  if (active.length > 0) {
    throw new DomainError("SEAT_ALREADY_ALLOTTED", "seat already has an active allotment");
  }
}

/**
 * A room may hold at most `capacity` concurrent active (allotted/occupied)
 * allotments. Rejects the (capacity+1)-th allotment. `activeCount` is the
 * number of *other* active room allotments already in place.
 */
export function assertRoomHasCapacity(activeCount: number, capacity: number): void {
  if (activeCount >= capacity) {
    throw new DomainError("ROOM_AT_CAPACITY", `room is at capacity (${activeCount}/${capacity} allotted)`);
  }
}

/**
 * A versioned UPDATE that matched zero rows means a concurrent writer bumped
 * the row's version between our read and our write (lost update). Reject before
 * any dependent side-effect runs.
 */
export function assertRowUpdated(rowCount: number): void {
  if (rowCount === 0) {
    throw new DomainError("VERSION_CONFLICT", "stale version — the record was modified concurrently");
  }
}

/** Seat status transition helpers — releasing a seat always frees it. */
export function seatStatusOnAllot(): string { return "allotted"; }
export function seatStatusOnRelease(): string { return "available"; }

// ── Occupancy & availability ───────────────────────────────────────────────
export interface Occupancy {
  total: number;
  available: number;
  allotted: number;
  blocked: number;
  occupancyRate: number; // 0..1, allotted / total
}

export function computeOccupancy(seats: Array<{ status: string }>): Occupancy {
  const total = seats.length;
  const available = seats.filter((s) => s.status === "available").length;
  const allotted = seats.filter((s) => s.status === "allotted").length;
  const blocked = seats.filter((s) => s.status === "blocked").length;
  const occupancyRate = total === 0 ? 0 : allotted / total;
  return { total, available, allotted, blocked, occupancyRate };
}

export function availableSeats<T extends { status: string }>(seats: T[]): T[] {
  return seats.filter((s) => s.status === "available");
}

// ── Licence-fee proration ──────────────────────────────────────────────────
/**
 * Prorate a monthly licence-fee (paise) for a number of occupied days.
 * Pure integer arithmetic — no floating point money.
 */
export function computeProratedLicenceFee(
  monthlyMinor: bigint,
  occupiedDays: number,
  daysInMonth = 30,
): bigint {
  if (occupiedDays <= 0 || monthlyMinor <= 0n) return 0n;
  const days = BigInt(Math.min(occupiedDays, daysInMonth));
  return (monthlyMinor * days) / BigInt(daysInMonth);
}
