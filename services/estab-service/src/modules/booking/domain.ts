/**
 * Booking domain logic — pure functions, no IO.
 *
 * Enforces:
 *   - Booking state machine
 *   - Amount calculation (rate x hours + security deposit)
 *   - Availability check (no overlapping confirmed bookings)
 *   - Refund policy (>7d full, 3-7d 50%, <3d 0)
 *   - Operating hours validation
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// ── State Machine ─────────────────────────────────────────────────────────

const BOOKING_TRANSITIONS: Record<string, string[]> = {
  draft:             ["submitted", "cancelled"],
  submitted:         ["approved", "payment_pending", "cancelled"],
  approved:          ["payment_pending", "cancelled"],
  payment_pending:   ["confirmed", "cancelled"],
  confirmed:         ["completed", "cancelled"],
  cancelled:         ["refund_initiated"],
  refund_initiated:  ["refunded"],
};

export { BOOKING_TRANSITIONS };

export function assertValidTransition(current: string, target: string): void {
  const allowed = BOOKING_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new DomainError("INVALID_TRANSITION", `cannot transition from '${current}' to '${target}'`);
  }
}

// ── Booking Number ────────────────────────────────────────────────────────

export function generateBookingNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BK-${ts}-${rand}`;
}

// ── Amount Calculation ────────────────────────────────────────────────────

/**
 * Calculate booking amount: ratePerHour x durationHours + securityDeposit.
 * All amounts in minor units (paise).
 */
export function calculateBookingAmount(
  ratePerHourMinor: bigint,
  durationHours: number,
  securityDepositMinor: bigint,
): { amountMinor: bigint; securityDepositMinor: bigint; totalMinor: bigint } {
  const amountMinor = ratePerHourMinor * BigInt(durationHours);
  const totalMinor = amountMinor + securityDepositMinor;
  return { amountMinor, securityDepositMinor, totalMinor };
}

// ── Availability ──────────────────────────────────────────────────────────

/**
 * Check if a time slot conflicts with existing bookings.
 * Returns true if available (no conflict).
 */
export function checkAvailability(
  existingSlots: Array<{ slotStart: string; slotEnd: string; isBlocked: boolean }>,
  requestedStart: string,
  requestedEnd: string,
): boolean {
  for (const slot of existingSlots) {
    if (slot.isBlocked) return false;
    // Overlap: existing.start < requested.end AND existing.end > requested.start
    if (slot.slotStart < requestedEnd && slot.slotEnd > requestedStart) {
      return false;
    }
  }
  return true;
}

// ── Refund Policy ─────────────────────────────────────────────────────────

/**
 * Calculate refund based on cancellation timing:
 *   - > 7 days before event: 100% refund
 *   - 3-7 days before event: 50% refund
 *   - < 3 days before event: 0% refund
 * Security deposit is always refunded.
 */
export function calculateRefund(
  eventDate: Date,
  cancellationDate: Date,
  amountMinor: bigint,
  securityDepositMinor: bigint,
): bigint {
  const msPerDay = 86_400_000;
  const daysUntilEvent = Math.ceil((eventDate.getTime() - cancellationDate.getTime()) / msPerDay);

  let bookingRefund: bigint;
  if (daysUntilEvent > 7) {
    bookingRefund = amountMinor;
  } else if (daysUntilEvent >= 3) {
    bookingRefund = amountMinor / 2n;
  } else {
    bookingRefund = 0n;
  }

  return bookingRefund + securityDepositMinor;
}

// ── Operating Hours ───────────────────────────────────────────────────────

/**
 * Validate that requested times fall within facility operating hours.
 * operatingHours format: { open: "08:00", close: "22:00" }
 */
export function validateOperatingHours(
  operatingHours: { open: string; close: string } | null | undefined,
  startTime: string,
  endTime: string,
): void {
  if (!operatingHours) return; // no restriction
  if (startTime < operatingHours.open || endTime > operatingHours.close) {
    throw new DomainError(
      "OUTSIDE_OPERATING_HOURS",
      `requested time ${startTime}-${endTime} is outside operating hours ${operatingHours.open}-${operatingHours.close}`,
    );
  }
}
