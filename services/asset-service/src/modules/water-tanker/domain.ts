export const VALID_TRANSITIONS: Record<string, string[]> = {
  requested:  ["scheduled", "cancelled"],
  scheduled:  ["dispatched", "cancelled"],
  dispatched: ["delivered"],
};

export function assertTransition(from: string, to: string): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`);
  }
}

let bookingSeq = 0;
export function generateBookingNumber(): string {
  bookingSeq += 1;
  const ts = Date.now().toString(36).toUpperCase();
  return `WT-${ts}-${String(bookingSeq).padStart(4, "0")}`;
}

const CAPACITY_FEES: Record<number, bigint> = {
  5000:  500_00n,
  10000: 900_00n,
  15000: 1200_00n,
  20000: 1500_00n,
};

export function calculateTankerFee(capacityLitres: number): bigint {
  return CAPACITY_FEES[capacityLitres] ?? 1000_00n;
}
