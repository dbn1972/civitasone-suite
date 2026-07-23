/**
 * Assignment domain — pure functions for inspector assignment validation and
 * field logistics computations.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.8_
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Earth radius in meters (WGS-84 mean radius). */
const EARTH_RADIUS_METERS = 6_371_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/** A declared conflict of interest between an inspector and an entity. */
export interface ConflictDeclaration {
  entityId: string;
  relationshipType: string;
}

/** Result of a geofence validation check. */
export interface GeofenceResult {
  /** True if the inspector is outside the allowed geofence radius. */
  locationMismatch: boolean;
  /** Actual distance in meters between inspector and entity positions. */
  distanceMeters: number;
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for assignment rule violations.
 * Kept separate from HttpError to maintain pure domain boundary.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Validate that the inspector holds all required competencies for an inspection type.
 *
 * Passes iff `requiredCompetencies` ⊆ `inspectorCompetencies`.
 *
 * @param inspectorCompetencies - Competencies held by the inspector.
 * @param requiredCompetencies - Competencies required by the inspection type.
 * @returns `true` if all required competencies are present.
 * @throws {DomainError} with code `INSUFFICIENT_COMPETENCY` listing missing competencies.
 *
 * _Validates: Requirement 4.1_
 */
export function validateCompetency(
  inspectorCompetencies: string[],
  requiredCompetencies: string[],
): true {
  const inspectorSet = new Set(inspectorCompetencies);
  const missing = requiredCompetencies.filter((c) => !inspectorSet.has(c));

  if (missing.length > 0) {
    throw new DomainError(
      "INSUFFICIENT_COMPETENCY",
      `Inspector lacks required competencies: ${missing.join(", ")}`,
      { missingCompetencies: missing },
    );
  }

  return true;
}

/**
 * Check for conflict of interest between an inspector and a target entity.
 *
 * Passes if the target entity is NOT in the inspector's conflict declarations.
 *
 * @param conflicts - The inspector's declared conflicts of interest.
 * @param targetEntityId - The entity being assigned for inspection.
 * @returns `true` if no conflict exists.
 * @throws {DomainError} with code `CONFLICT_OF_INTEREST` if a matching conflict is found.
 *
 * _Validates: Requirements 4.2, 4.3_
 */
export function checkConflictOfInterest(
  conflicts: ConflictDeclaration[],
  targetEntityId: string,
): true {
  const match = conflicts.find((c) => c.entityId === targetEntityId);

  if (match) {
    throw new DomainError(
      "CONFLICT_OF_INTEREST",
      `Inspector has a declared conflict of interest with entity ${targetEntityId} (relationship: ${match.relationshipType})`,
      { entityId: targetEntityId, relationshipType: match.relationshipType },
    );
  }

  return true;
}

/**
 * Validate that the inspector has not reached their daily assignment capacity.
 *
 * Passes iff `currentAssignments` < `dailyLimit`.
 *
 * @param currentAssignments - Number of inspections already assigned for the day.
 * @param dailyLimit - Maximum inspections allowed per day for this inspector.
 * @returns `true` if capacity is available.
 * @throws {DomainError} with code `DAILY_CAPACITY_EXCEEDED` if at or over the limit.
 *
 * _Validates: Requirement 4.8_
 */
export function validateDailyCapacity(
  currentAssignments: number,
  dailyLimit: number,
): true {
  if (currentAssignments >= dailyLimit) {
    throw new DomainError(
      "DAILY_CAPACITY_EXCEEDED",
      `Inspector has reached daily capacity limit (${currentAssignments}/${dailyLimit})`,
      { currentAssignments, dailyLimit },
    );
  }

  return true;
}

/**
 * Calculate the great-circle distance between two GPS points using the Haversine formula.
 *
 * Formula: 2 * R * asin(sqrt(sin²(Δlat/2) + cos(lat1) * cos(lat2) * sin²(Δlon/2)))
 *
 * @param lat1 - Latitude of point 1 in decimal degrees.
 * @param lon1 - Longitude of point 1 in decimal degrees.
 * @param lat2 - Latitude of point 2 in decimal degrees.
 * @param lon2 - Longitude of point 2 in decimal degrees.
 * @returns Distance in meters between the two points.
 *
 * _Validates: Requirement 4.5_
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.asin(Math.sqrt(a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Validate whether the inspector's GPS position falls within the geofence radius
 * of the entity's registered location.
 *
 * @param inspectorLat - Inspector's latitude in decimal degrees.
 * @param inspectorLon - Inspector's longitude in decimal degrees.
 * @param entityLat - Entity's registered latitude in decimal degrees.
 * @param entityLon - Entity's registered longitude in decimal degrees.
 * @param radius - Geofence radius in meters.
 * @returns An object with the distance in meters and whether the geofence is violated.
 *
 * _Validates: Requirements 4.5, 4.6_
 */
export function validateGeofence(
  inspectorLat: number,
  inspectorLon: number,
  entityLat: number,
  entityLon: number,
  radius: number,
): GeofenceResult {
  const distanceMeters = haversineDistance(inspectorLat, inspectorLon, entityLat, entityLon);

  return {
    locationMismatch: distanceMeters > radius,
    distanceMeters: Math.round(distanceMeters),
  };
}
