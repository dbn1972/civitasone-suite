export const COMMITTEE_TYPES = ["town_vending_committee", "zone_committee"] as const;
export type CommitteeType = (typeof COMMITTEE_TYPES)[number];

export const REVIEW_STATUSES = ["pending", "reviewed", "deferred"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const RECOMMENDATIONS = ["approve", "reject", "defer", "allocate_zone"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export function canAllocateZone(recommendation: string): boolean {
  return recommendation === "approve" || recommendation === "allocate_zone";
}
