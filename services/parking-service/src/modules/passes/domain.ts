export const VEHICLE_TYPES = ["two_wheeler", "car", "commercial"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const PASS_TYPES = ["monthly", "annual"] as const;
export type PassType = (typeof PASS_TYPES)[number];

export const PASS_STATUSES = ["active", "expired", "cancelled", "suspended"] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];

export function generatePassNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `PKG-P/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
