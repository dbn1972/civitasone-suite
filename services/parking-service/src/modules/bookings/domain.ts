export const BOOKING_STATUSES = ["booked", "active", "completed", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, BookingStatus[]> = {
  booked: ["active", "cancelled"],
  active: ["completed"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: string, to: BookingStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * The set of statuses a booking may currently be in for `to` to be a legal next
 * status, derived from VALID_TRANSITIONS (same table canTransition uses, so they
 * can't drift). Pass to repo.updateStatus's `fromStatuses` so the guard is
 * enforced atomically in the UPDATE's WHERE clause rather than as a pre-check in
 * the route handler, which races against the async consumer doing the real write.
 */
export function fromStatusesFor(to: BookingStatus): BookingStatus[] {
  return (Object.keys(VALID_TRANSITIONS) as BookingStatus[]).filter((from) =>
    (VALID_TRANSITIONS[from] ?? []).includes(to),
  );
}

export function generateBookingNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `PKG-B/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function calculateParkingFee(durationMinutes: number, tariffPerHourMinor: bigint): bigint {
  const hours = Math.ceil(durationMinutes / 60);
  return tariffPerHourMinor * BigInt(hours);
}
