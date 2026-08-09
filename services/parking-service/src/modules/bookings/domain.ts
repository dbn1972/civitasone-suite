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

export function generateBookingNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `PKG-B/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function calculateParkingFee(durationMinutes: number, tariffPerHourMinor: bigint): bigint {
  const hours = Math.ceil(durationMinutes / 60);
  return tariffPerHourMinor * BigInt(hours);
}
