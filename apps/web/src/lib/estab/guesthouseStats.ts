import { todayIST, istDatePart } from "@/lib/formatters";

export type GuesthouseStatInput = {
  status: string;
  checkInDate: string;
};

export type GuesthouseStats = {
  total: number;
  occupied: number;
  pendingApproval: number;
  upcoming: number;
};

/**
 * GAP-ESTAB-GUESTHOUSE-04: "Upcoming" previously compared `checkInDate > today`
 * as raw strings, with `today` built in UTC — so a same-day datetime check-in
 * counted as Upcoming, and UTC lagged IST by 5.5h. This compares the IST
 * calendar day of the check-in against today's IST calendar day, so a booking
 * checking in today (any time) is NOT upcoming; tomorrow's is.
 *
 * GAP-ESTAB-GUESTHOUSE-01: `pendingApproval` is now "awaiting check-in" — any
 * confirmed/pending booking not yet checked in. The backend auto-confirms
 * bookings (there is no separate approval step today), so counting only
 * `status === "pending"` was always 0.
 */
export function countGuesthouseStats(bookings: readonly GuesthouseStatInput[]): GuesthouseStats {
  const today = todayIST();
  let occupied = 0;
  let pendingApproval = 0;
  let upcoming = 0;
  for (const b of bookings) {
    if (b.status === "checked_in") occupied += 1;
    if (b.status === "pending" || b.status === "confirmed") pendingApproval += 1;
    if (b.status === "confirmed" || b.status === "pending") {
      const day = istDatePart(b.checkInDate);
      if (day && day > today) upcoming += 1;
    }
  }
  return { total: bookings.length, occupied, pendingApproval, upcoming };
}
