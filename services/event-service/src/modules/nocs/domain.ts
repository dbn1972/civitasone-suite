export const DEPARTMENTS = ["police", "fire", "traffic", "health", "environment"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const NOC_STATUSES = ["requested", "approved", "rejected", "conditional"] as const;
export type NocStatus = (typeof NOC_STATUSES)[number];

export function canRespond(status: string): boolean {
  return status === "requested";
}

/**
 * Statuses a NOC request may currently be in for a "respond" action to be legal
 * — mirrors canRespond as an array, for repo.respondNoc's atomic WHERE-clause
 * guard (see bookings/domain.ts in crematorium-service for the fuller pattern;
 * this module only has one transition rule so it's inlined rather than a full
 * VALID_TRANSITIONS table).
 */
export const RESPONDABLE_FROM_STATUSES: NocStatus[] = ["requested"];
