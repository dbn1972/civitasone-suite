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
