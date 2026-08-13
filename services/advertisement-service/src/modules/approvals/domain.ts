export const SCRUTINY_TYPES = [
  "zone_check",
  "structural_safety",
  "traffic_impact",
] as const;

export type ScrutinyType = (typeof SCRUTINY_TYPES)[number];

export const SCRUTINY_STATUSES = ["pending", "completed"] as const;
export type ScrutinyStatus = (typeof SCRUTINY_STATUSES)[number];

export function canDecide(applicationStatus: string): boolean {
  return applicationStatus === "under_review";
}
