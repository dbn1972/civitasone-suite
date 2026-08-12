export const DEPARTMENTS = ["police", "fire", "traffic", "health", "environment"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const NOC_STATUSES = ["requested", "approved", "rejected", "conditional"] as const;
export type NocStatus = (typeof NOC_STATUSES)[number];

export function canRespond(status: string): boolean {
  return status === "requested";
}
