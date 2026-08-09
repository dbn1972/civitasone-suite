export const PROPERTY_TYPES = ["shop", "stall", "kiosk", "godown"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_STATUSES = ["available", "allotted", "reserved", "under_maintenance"] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];
