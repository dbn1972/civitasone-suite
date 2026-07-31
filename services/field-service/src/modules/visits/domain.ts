/**
 * visits/domain.ts — Pure business logic for visit validation.
 * Geo-fencing check, duration calculation, outcome classification.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * Haversine distance between two points in meters.
 */
export function haversineDistance(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h = sinDLat * sinDLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return R * c;
}

/** Default geo-fence radius in meters. */
const DEFAULT_RADIUS_METERS = 200;

/**
 * Validate that a check-in point is within acceptable radius of the target location.
 * Returns an error string or null if valid.
 */
export function validateGeoFence(
  checkInPoint: GeoPoint,
  targetPoint: GeoPoint,
  radiusMeters: number = DEFAULT_RADIUS_METERS,
): string | null {
  const distance = haversineDistance(checkInPoint, targetPoint);
  if (distance > radiusMeters) {
    return `check-in location is ${Math.round(distance)}m from target (max ${radiusMeters}m)`;
  }
  return null;
}

/**
 * Validate check-in request.
 * - Must have latitude/longitude
 * - checkInAt must be present
 */
export function validateCheckIn(location: Record<string, unknown>): string | null {
  if (typeof location["latitude"] !== "number" || typeof location["longitude"] !== "number") {
    return "location must include numeric latitude and longitude";
  }
  if (location["latitude"] < -90 || location["latitude"] > 90) {
    return "latitude must be between -90 and 90";
  }
  if (location["longitude"] < -180 || location["longitude"] > 180) {
    return "longitude must be between -180 and 180";
  }
  return null;
}

/**
 * Validate check-out request.
 * - checkInAt must exist (cannot check-out without check-in)
 * - checkOutAt must be after checkInAt
 */
export function validateCheckOut(checkInAt: string | null, checkOutAt: string): string | null {
  if (!checkInAt) {
    return "cannot check out: no check-in recorded";
  }
  const inTime = new Date(checkInAt).getTime();
  const outTime = new Date(checkOutAt).getTime();
  if (outTime <= inTime) {
    return "check-out time must be after check-in time";
  }
  return null;
}

/**
 * Calculate visit duration in minutes.
 */
export function calculateDurationMinutes(checkInAt: string, checkOutAt: string): number {
  const inTime = new Date(checkInAt).getTime();
  const outTime = new Date(checkOutAt).getTime();
  return Math.round((outTime - inTime) / (1000 * 60));
}

export type VisitOutcome = "completed" | "short_visit" | "extended_visit" | "no_show";

/**
 * Classify a visit outcome based on duration.
 * - < 5 min = short_visit (possibly a drive-by)
 * - 5–120 min = completed (normal)
 * - > 120 min = extended_visit (may need review)
 */
export function classifyVisitOutcome(durationMinutes: number): VisitOutcome {
  if (durationMinutes < 5) return "short_visit";
  if (durationMinutes <= 120) return "completed";
  return "extended_visit";
}
