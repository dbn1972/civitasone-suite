export const VIOLATION_TYPES = ["no_ticket", "expired", "wrong_zone", "obstruction"] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

export const VIOLATION_STATUSES = ["issued", "paid", "contested", "cancelled"] as const;
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];

export function generateViolationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `PKG-V/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function calculateFineMinor(violationType: string): bigint {
  switch (violationType) {
    case "obstruction": return 200000n; // Rs 2000
    case "no_ticket": return 100000n; // Rs 1000
    case "expired": return 50000n; // Rs 500
    case "wrong_zone": return 75000n; // Rs 750
    default: return 50000n;
  }
}
