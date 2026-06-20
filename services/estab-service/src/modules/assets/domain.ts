export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function checkNoOverlap(
  bookings: Array<{ fromDt: Date | string; toDt: Date | string; status: string }>,
  fromDt: Date,
  toDt: Date
): void {
  const conflicting = bookings.filter((b) => {
    if (!["approved", "in_use"].includes(b.status)) return false;
    const bFrom = new Date(b.fromDt);
    const bTo   = new Date(b.toDt);
    return fromDt < bTo && toDt > bFrom;
  });
  if (conflicting.length > 0) {
    throw new DomainError("VEHICLE_CONFLICT", "vehicle already booked for this time window");
  }
}
