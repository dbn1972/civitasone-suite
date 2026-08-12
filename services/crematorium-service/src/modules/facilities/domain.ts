export const FACILITY_TYPES = ["crematorium", "burial_ground", "electric_crematorium"] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const FACILITY_STATUSES = ["active", "under_maintenance", "closed"] as const;
export type FacilityStatus = (typeof FACILITY_STATUSES)[number];
