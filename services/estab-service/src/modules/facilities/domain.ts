export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/**
 * Room-booking lifecycle (estab_room_bookings.status, CHECK widened in migration 0062):
 *   pending --approve--> confirmed --checkin--> checked_in --checkout--> checked_out
 *   pending --reject---> rejected
 * "booked" is the legacy pre-approval equivalent of "confirmed" and is treated as such.
 * A room is held by every non-terminal state, so a pending request also blocks the slot.
 */
export const ROOM_HOLDING_STATUSES = ["pending", "booked", "confirmed", "checked_in"];

export type RoomBookingAction = "approve" | "reject" | "checkin" | "checkout";
const ALLOWED_FROM: Record<RoomBookingAction, string[]> = {
  approve:  ["pending"],
  reject:   ["pending"],
  checkin:  ["confirmed", "booked"],
  checkout: ["checked_in"],
};

export function assertRoomBookingTransition(status: string, action: RoomBookingAction): void {
  if (!ALLOWED_FROM[action].includes(status)) {
    throw new DomainError("INVALID_STATE", `cannot ${action} a room booking that is ${status}`);
  }
}

export function checkNoRoomOverlap(
  bookings: Array<{ checkIn: Date | string; checkOut: Date | string; status: string }>,
  checkIn: Date,
  checkOut: Date
): void {
  const conflicting = bookings.filter((b) => {
    if (!ROOM_HOLDING_STATUSES.includes(b.status)) return false;
    const bIn  = new Date(b.checkIn);
    const bOut = new Date(b.checkOut);
    return checkIn < bOut && checkOut > bIn;
  });
  if (conflicting.length > 0) {
    throw new DomainError("ROOM_CONFLICT", "room already booked for this window");
  }
}
