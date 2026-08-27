export const SERVICE_TYPES = ["cremation", "burial", "electric_cremation"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const BOOKING_STATUSES = ["requested", "confirmed", "completed", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, BookingStatus[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: string, to: BookingStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * The set of statuses a booking may currently be in for `to` to be a legal next
 * status, derived from the same VALID_TRANSITIONS table `canTransition` uses (so
 * the two can never drift apart). Pass this to `repo.updateStatus`'s `fromStatuses`
 * argument so the transition guard is enforced atomically in the UPDATE's WHERE
 * clause, not just as a pre-check in the HTTP route handler (which is vulnerable to
 * a TOCTOU race against the async consumer that does the actual write).
 */
export function fromStatusesFor(to: BookingStatus): BookingStatus[] {
  return (Object.keys(VALID_TRANSITIONS) as BookingStatus[]).filter((from) =>
    (VALID_TRANSITIONS[from] ?? []).includes(to),
  );
}

export function generateBookingNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `CREM/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function calculateFeeMinor(serviceType: string): bigint {
  if (serviceType === "electric_cremation") return 150000n; // Rs 1500
  if (serviceType === "cremation") return 50000n; // Rs 500
  return 30000n; // Rs 300 burial
}
