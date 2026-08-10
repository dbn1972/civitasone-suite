export const FACILITY_TYPES = ["surface", "multi_level", "basement", "street"] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const FACILITY_STATUSES = ["active", "full", "closed", "under_maintenance"] as const;
export type FacilityStatus = (typeof FACILITY_STATUSES)[number];
