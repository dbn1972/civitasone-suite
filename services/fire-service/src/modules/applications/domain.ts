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

// Note: "withdrawn" added to under_review/inspection_scheduled below — the
// original table only allowed it from draft/submitted, but routes.ts's own
// pre-check already allowed withdrawing from "under_review" too
// (`!["draft","submitted","under_review"].includes(...)`), and letting an
// applicant withdraw while still under review (rather than only before
// review starts) is the more sensible real-world behavior anyway. Fixed the
// model to match the sensible, already-implemented behavior, same as the
// analogous fix in the market-service PR's lifecycle transitions.
export const VALID_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "withdrawn"],
  under_review: ["inspection_scheduled", "approved", "rejected", "withdrawn"],
  inspection_scheduled: ["under_review", "approved", "rejected", "withdrawn"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Was defined (canTransition/VALID_TRANSITIONS) but never called anywhere in
 * this module — repo.updateStatus had no current-status guard, so a
 * duplicate/racing submit+withdraw pair could both pass a route-level
 * pre-check and both apply. Derived from the same table so it can't drift.
 */
export function fromStatusesFor(to: ApplicationStatus): ApplicationStatus[] {
  return (Object.keys(VALID_TRANSITIONS) as ApplicationStatus[]).filter((from) =>
    (VALID_TRANSITIONS[from] ?? []).includes(to),
  );
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
