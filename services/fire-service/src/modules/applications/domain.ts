export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "inspection_scheduled",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const VALID_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "withdrawn"],
  under_review: ["inspection_scheduled", "approved", "rejected"],
  inspection_scheduled: ["under_review", "approved", "rejected"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const OCCUPANCY_TYPES = [
  "residential",
  "commercial",
  "industrial",
  "assembly",
  "institutional",
  "mixed",
] as const;

export type OccupancyType = (typeof OCCUPANCY_TYPES)[number];

const BASE_FEE_PAISE: Record<OccupancyType, bigint> = {
  residential: 100000n,
  commercial: 250000n,
  industrial: 500000n,
  assembly: 400000n,
  institutional: 200000n,
  mixed: 350000n,
};

const AREA_SURCHARGE_PER_SQFT_PAISE = 50n;

export function calculateFeeMinor(occupancyType: OccupancyType, builtUpAreaSqft: number): bigint {
  const base = BASE_FEE_PAISE[occupancyType] ?? 100000n;
  const areaSurcharge = BigInt(Math.max(0, builtUpAreaSqft)) * AREA_SURCHARGE_PER_SQFT_PAISE;
  return base + areaSurcharge;
}

export function generateApplicationNumber(
  tenantShortCode: string,
  year: number,
  sequence: number,
): string {
  return `FIRE/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
