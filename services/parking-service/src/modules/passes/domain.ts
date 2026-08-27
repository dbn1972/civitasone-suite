export const VEHICLE_TYPES = ["two_wheeler", "car", "commercial"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const PASS_TYPES = ["monthly", "annual"] as const;
export type PassType = (typeof PASS_TYPES)[number];

export const PASS_STATUSES = ["active", "expired", "cancelled", "suspended"] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];

// Was entirely absent — the only mutation this module implements today
// (cancelPass) had no status-machine concept anywhere, so repo.updateStatus had
// no current-status guard and could "cancel" an already-cancelled/expired pass
// with no rejection. Modeled narrowly around what's actually implemented today
// (active/suspended -> cancelled); expired/suspended transitions can extend this
// table when those commands exist.
const VALID_TRANSITIONS: Record<string, PassStatus[]> = {
  active: ["cancelled", "suspended"],
  suspended: ["active", "cancelled"],
  expired: [],
  cancelled: [],
};

export function canTransition(from: string, to: PassStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export function fromStatusesFor(to: PassStatus): PassStatus[] {
  return (Object.keys(VALID_TRANSITIONS) as PassStatus[]).filter((from) =>
    (VALID_TRANSITIONS[from] ?? []).includes(to),
  );
}

export function generatePassNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `PKG-P/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
