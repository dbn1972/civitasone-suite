/**
 * Assignment domain — pure functions for inspector assignment validation and
 * field logistics computations.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.8, SVC-109 (tour plan approval)_
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


// ── Tour Plan States (SVC-109) ────────────────────────────────────────────────

/**
 * Tour plan lifecycle states.
 * - draft: initially created, editable by inspector
 * - submitted: inspector submits for supervisory approval
 * - approved: supervising officer approves
 * - rejected: supervising officer rejects (can be revised back to draft)
 */
export const TOUR_PLAN_STATES = ["draft", "submitted", "approved", "rejected"] as const;
export type TourPlanState = typeof TOUR_PLAN_STATES[number];

/**
 * Allowed state transitions for tour plans.
 * - draft → submitted (inspector submits)
 * - submitted → approved (supervisor approves) or rejected (supervisor rejects)
 * - rejected → draft (inspector revises)
 * - approved → (terminal state, no further transitions)
 */
export const TOUR_PLAN_TRANSITIONS: Record<TourPlanState, readonly TourPlanState[]> = {
  draft: ["submitted"],
  submitted: ["approved", "rejected"],
  approved: [],
  rejected: ["draft"],
};

/**
 * Assert that a tour plan state transition is valid per the state machine.
 *
 * @param current - The current state of the tour plan.
 * @param target - The desired target state.
 * @returns `true` if the transition is allowed.
 * @throws {DomainError} with code `INVALID_TOUR_PLAN_TRANSITION` if disallowed.
 *
 * _Validates: SVC-109 Tour Plan Approval Workflow_
 */
export function assertValidTourPlanTransition(current: TourPlanState, target: TourPlanState): true {
  const allowedTargets = TOUR_PLAN_TRANSITIONS[current];

  if (!allowedTargets.includes(target)) {
    throw new DomainError(
      "INVALID_TOUR_PLAN_TRANSITION",
      `Cannot transition tour plan from '${current}' to '${target}'. Allowed transitions from '${current}': ${allowedTargets.length > 0 ? allowedTargets.join(", ") : "none (terminal state)"}`,
      { current, target, allowed: [...allowedTargets] },
    );
  }

  return true;
}

/**
 * Enforce maker-checker on tour plan approval: the approver must not be the creator.
 *
 * @param creatorId - The user who created/submitted the tour plan.
 * @param approverId - The user attempting to approve.
 * @returns `true` if maker ≠ checker.
 * @throws {DomainError} with code `MAKER_CHECKER_VIOLATION` if same person.
 *
 * _Validates: SVC-109 Maker-Checker on Approval_
 */
export function assertMakerCheckerApproval(creatorId: string, approverId: string): true {
  if (creatorId === approverId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "Tour plan cannot be approved by the same person who created/submitted it",
      { creatorId, approverId },
    );
  }

  return true;
}


// ── Field Route Optimization (SVC-109) ───────────────────────────────────────

/** A geo-located inspection site to be visited during a tour. */
export interface TourSite {
  entityId: string;
  inspectionId: string;
  latitude: number;
  longitude: number;
}

/** A geographic start point for route sequencing (e.g. the inspector's depot). */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** A single sequenced visit within an optimized day route. */
export interface RoutedSite extends TourSite {
  /** Zero-based visit order within the day. */
  seq: number;
  /** Great-circle distance in metres from the previous stop (start point for seq 0). */
  legMeters: number;
}

/** One day of the tour plan: a date plus its proximity-ordered sequence of sites. */
export interface RoutedDay {
  date: string;
  sites: RoutedSite[];
}

/**
 * Order a set of inspection sites into an efficient visit sequence using the
 * nearest-neighbour heuristic seeded from a start point.
 *
 * Greedy nearest-neighbour: from the current position, repeatedly pick the closest
 * unvisited site (by {@link haversineDistance}), append it, and move there. This is
 * deterministic and typically far shorter than the arbitrary input order. Ties are
 * broken by input order, keeping the result stable.
 *
 * PURE — no I/O, no mutation of the input array.
 *
 * @param start - The starting position (inspector depot / first-of-day origin).
 * @param sites - Candidate sites to sequence.
 * @returns The sites in visit order, each annotated with its `seq` and `legMeters`.
 *
 * _Validates: SVC-109 (geo-proximity route optimization)_
 */
export function sequenceByNearestNeighbour(
  start: GeoPoint,
  sites: TourSite[],
): RoutedSite[] {
  const remaining = sites.slice();
  const ordered: RoutedSite[] = [];
  let cursor: GeoPoint = { latitude: start.latitude, longitude: start.longitude };

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const site = remaining[i]!;
      const d = haversineDistance(cursor.latitude, cursor.longitude, site.latitude, site.longitude);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push({ ...next!, seq: ordered.length, legMeters: Math.round(bestDist) });
    cursor = { latitude: next!.latitude, longitude: next!.longitude };
  }

  return ordered;
}

/**
 * Total great-circle travel distance (in metres) of visiting `sites` in the given
 * order, starting from `start`. Used to compare route quality (and by tests to
 * prove the optimized order beats the naive input order).
 *
 * PURE.
 *
 * @param start - Starting position.
 * @param sites - Sites in the order they will be visited.
 * @returns Sum of consecutive leg distances, rounded to whole metres.
 */
export function routeDistanceMeters(start: GeoPoint, sites: TourSite[]): number {
  let total = 0;
  let cursor: GeoPoint = { latitude: start.latitude, longitude: start.longitude };
  for (const site of sites) {
    total += haversineDistance(cursor.latitude, cursor.longitude, site.latitude, site.longitude);
    cursor = { latitude: site.latitude, longitude: site.longitude };
  }
  return Math.round(total);
}

/**
 * Build a sequenced multi-day tour plan from a pool of inspection sites.
 *
 * The whole pool is first ordered by nearest-neighbour from `start`, then packed
 * into the available dates `maxDailyInspections` at a time, preserving the
 * proximity order within each day. The result is a real, sequenced visit plan —
 * not one arbitrary slot per date.
 *
 * PURE.
 *
 * @param start - Starting position for the sweep.
 * @param sites - All inspection sites to schedule.
 * @param availableDates - Working dates (already leave-filtered), in order.
 * @param maxDailyInspections - Max visits packed into a single day.
 * @returns One {@link RoutedDay} per date that received sites (empty tail days omitted).
 *
 * _Validates: SVC-109 (geo-proximity route optimization across a tour period)_
 */
export function planTourRoute(
  start: GeoPoint,
  sites: TourSite[],
  availableDates: string[],
  maxDailyInspections: number,
): RoutedDay[] {
  const perDay = Math.max(1, Math.floor(maxDailyInspections));
  const sequenced = sequenceByNearestNeighbour(start, sites);
  const days: RoutedDay[] = [];

  let idx = 0;
  for (const date of availableDates) {
    if (idx >= sequenced.length) break;
    const daySites = sequenced.slice(idx, idx + perDay).map((site, i) => ({
      ...site,
      seq: i, // re-index sequence within the day
    }));
    days.push({ date, sites: daySites });
    idx += perDay;
  }

  return days;
}
