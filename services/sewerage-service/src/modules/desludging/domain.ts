export type BookingStatus = "requested" | "scheduled" | "dispatched" | "completed" | "cancelled";

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  requested: ["scheduled", "cancelled"],
  scheduled: ["dispatched", "cancelled"],
  dispatched: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function validateBookingTransition(from: BookingStatus, to: BookingStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

// Format helper for the sequence-reserved booking number (see repo.ts's
// nextBookingNumber and migrations/0003_number_sequences.sql) — replaces
// the old `SEWD-${Date.now()}` scheme.
export function formatBookingNumber(n: number): string {
  return `SEWD-${n}`;
}
