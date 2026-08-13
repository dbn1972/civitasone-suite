export const DEMAND_STATUSES = ["generated", "sent", "paid", "overdue", "waived"] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];
