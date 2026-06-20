export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function checkNoRoomOverlap(
  bookings: Array<{ checkIn: Date | string; checkOut: Date | string; status: string }>,
  checkIn: Date,
  checkOut: Date
): void {
  const conflicting = bookings.filter((b) => {
    if (!["booked", "checked_in"].includes(b.status)) return false;
    const bIn  = new Date(b.checkIn);
    const bOut = new Date(b.checkOut);
    return checkIn < bOut && checkOut > bIn;
  });
  if (conflicting.length > 0) {
    throw new DomainError("ROOM_CONFLICT", "room already booked for this window");
  }
}
