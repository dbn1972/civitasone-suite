export const VIOLATION_TYPES = ["no_ticket", "expired", "wrong_zone", "obstruction"] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

export const VIOLATION_STATUSES = ["issued", "paid", "contested", "cancelled"] as const;
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];

// Was entirely absent — repo.updateStatus had no current-status guard, so a
// delayed/duplicate pay+contest pair racing on the same violation could both
// succeed, one silently overwriting the other. Modeled around what pay/contest
// already assume in routes.ts today (`existing.status !== "issued"`); no
// disposition command exists yet for a contested violation, so contested/paid
// are terminal here until one is added.
const VALID_TRANSITIONS: Record<string, ViolationStatus[]> = {
  issued: ["paid", "contested"],
  paid: [],
  contested: [],
  cancelled: [],
};

export function canTransition(from: string, to: ViolationStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export function fromStatusesFor(to: ViolationStatus): ViolationStatus[] {
  return (Object.keys(VALID_TRANSITIONS) as ViolationStatus[]).filter((from) =>
    (VALID_TRANSITIONS[from] ?? []).includes(to),
  );
}

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
