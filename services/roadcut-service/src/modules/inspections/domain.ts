export const INSPECTION_TYPES = ["pre_work", "during_work", "post_restoration"] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const INSPECTION_STATUSES = ["scheduled", "completed", "failed"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const RESTORATION_QUALITIES = ["satisfactory", "unsatisfactory", "pending"] as const;

export function canComplete(status: string): boolean {
  return status === "scheduled";
}
