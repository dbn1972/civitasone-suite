import type { BusinessHours } from "./schema.js";

export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type DayKey = (typeof DAY_KEYS)[number];

/**
 * Property 28: Capacity Threshold Alerting — true once currentOccupancy
 * reaches or exceeds capacityThreshold (>=, not strictly >, so the
 * check-in that would push occupancy to the threshold is itself rejected).
 */
export function isOverCapacityThreshold(currentOccupancy: number, capacityThreshold: number): boolean {
  return currentOccupancy >= capacityThreshold;
}

/**
 * Property 28: Capacity Threshold Alerting — reject new check-ins while the
 * location is at/over its configured capacity threshold. Maps to
 * CAPACITY_EXCEEDED (422) per the design's error-code table.
 */
export function assertWithinCapacity(currentOccupancy: number, capacityThreshold: number): void {
  if (isOverCapacityThreshold(currentOccupancy, capacityThreshold)) {
    throw new DomainError(
      "CAPACITY_EXCEEDED",
      `location at capacity (occupancy=${currentOccupancy}, threshold=${capacityThreshold}); new check-ins rejected until occupancy drops below threshold`,
    );
  }
}

/**
 * Properties 19 & 26 (zone-boundary check): a null areaId represents a
 * perimeter gate, which is always permitted regardless of the pass's
 * permitted-areas set (perimeter-only passes have an empty permittedAreas
 * array and are still allowed through perimeter gates). A non-null areaId
 * (restricted-area gate) requires the area to be explicitly listed in
 * permittedAreas.
 */
export function isAreaPermitted(areaId: string | null, permittedAreas: string[]): boolean {
  if (areaId === null) return true;
  return permittedAreas.includes(areaId);
}

/**
 * Property 26: Location-Scoped Pass Verification — a pass encoded with
 * location_id L only verifies successfully at gates belonging to L.
 */
export function isLocationScopeValid(passLocationId: string, gateLocationId: string): boolean {
  return passLocationId === gateLocationId;
}

/** Parses an "HH:MM" (24-hour) time string into minutes since midnight. */
function toMinutes(time: string): number {
  const [hoursStr, minutesStr] = time.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  return hours * 60 + minutes;
}

/**
 * Business-hours validation: looks up the day-of-week entry for checkTime
 * (using checkTime's local day/time) and returns true only if the entry
 * exists, is not marked closed, and checkTime falls within [open, close).
 */
export function isWithinBusinessHours(businessHours: BusinessHours, checkTime: Date): boolean {
  const dayKey: DayKey = DAY_KEYS[checkTime.getDay()] as DayKey;
  const entry = businessHours[dayKey];

  if (entry === null || entry === undefined) return false;
  if (entry.closed === true) return false;

  const checkMinutes = checkTime.getHours() * 60 + checkTime.getMinutes();
  const openMinutes = toMinutes(entry.open);
  const closeMinutes = toMinutes(entry.close);

  return checkMinutes >= openMinutes && checkMinutes < closeMinutes;
}
