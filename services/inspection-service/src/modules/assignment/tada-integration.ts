/**
 * TA/DA (Travelling Allowance / Dearness Allowance) integration with hrms-service.
 * When an inspector completes a tour day (geo-attendance marked), automatically
 * generates a TA/DA claim in hrms-service via queue event.
 *
 * Contract: publishes to "hrms.claim.create" topic with payload:
 * { employeeId, claimType: "ta_da", amountMinor: 0 (auto-computed by hrms rules),
 *   description, tourPlanId, inspectionIds, travelDate, geoAttendanceId }
 *
 * The actual TA/DA amount is computed by hrms-service based on:
 * - Employee grade/pay band
 * - Distance travelled
 * - City classification (A/B/C tier)
 * - Applicable TA/DA rules (7th CPC or state rules)
 *
 * This module only publishes the claim creation event with the travel context.
 *
 * _Requirements: SVC-109 Field Staff Routing — TA/DA Integration_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input for publishing a TA/DA claim creation event. */
export interface TaDaClaimInput {
  readonly inspectorId: string;
  readonly tourPlanId: string;
  readonly travelDate: string;
  readonly inspectionIds: ReadonlyArray<string>;
  readonly geoAttendanceId: string;
}

/** Payload shape published to hrms.claim.create topic. */
export interface TaDaClaimPayload {
  readonly employeeId: string;
  readonly claimType: "ta_da";
  /** Amount in minor units (paise). Set to 0 — hrms-service auto-computes based on rules. */
  readonly amountMinor: 0;
  readonly description: string;
  readonly tourPlanId: string;
  readonly inspectionIds: ReadonlyArray<string>;
  readonly travelDate: string;
  readonly geoAttendanceId: string;
}

/** Geo-attendance record for travel summary computation. */
export interface GeoAttendanceRecord {
  readonly id: string;
  readonly inspectorId: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly entityLatitude: string;
  readonly entityLongitude: string;
  readonly distanceMeters: number;
  readonly createdAt: string;
  readonly inspectionId: string;
}

/** Travel summary computed from geo-attendance records. */
export interface TravelSummary {
  /** Total distance in meters between all attendance points. */
  readonly totalDistanceMeters: number;
  /** Number of distinct locations visited. */
  readonly locationsVisited: number;
  /** List of location coordinates visited. */
  readonly locations: ReadonlyArray<{ latitude: string; longitude: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Topic for publishing TA/DA claims to hrms-service. */
const HRMS_CLAIM_CREATE_TOPIC = "hrms.claim.create";

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Publish a TA/DA claim creation event to hrms-service.
 *
 * This is called by the assignment consumer after geo-attendance is marked for a tour day.
 * The hrms-service will compute the actual amount based on applicable rules.
 *
 * @param ctx - Request context (tenantId, actorId, correlationId).
 * @param input - Claim input data (inspectorId, tourPlanId, travelDate, etc.).
 * @returns The published message ID.
 */
export async function publishTaDaClaim(
  ctx: RequestContext,
  input: TaDaClaimInput,
): Promise<{ messageId: string }> {
  const payload: TaDaClaimPayload = {
    employeeId: input.inspectorId,
    claimType: "ta_da",
    amountMinor: 0,
    description: `TA/DA claim for inspection tour on ${input.travelDate}. Tour plan: ${input.tourPlanId}. Inspections: ${input.inspectionIds.join(", ")}`,
    tourPlanId: input.tourPlanId,
    inspectionIds: input.inspectionIds,
    travelDate: input.travelDate,
    geoAttendanceId: input.geoAttendanceId,
  };

  const messageId = randomUUID();

  await queue.publish(HRMS_CLAIM_CREATE_TOPIC, {
    messageId,
    type: HRMS_CLAIM_CREATE_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });

  // Also publish internal event for audit tracking
  await queue.publish(COMMANDS.tadaClaimCreate, {
    type: COMMANDS.tadaClaimCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });

  return { messageId };
}

/**
 * Compute a travel summary from geo-attendance records for a given day.
 *
 * Aggregates:
 * - Total distance (sum of distanceMeters from each attendance record)
 * - Number of distinct locations visited (unique entity coordinates)
 * - List of coordinates for mapping
 *
 * @param geoAttendanceRecords - Geo-attendance records for the tour day.
 * @returns TravelSummary with aggregated travel data.
 */
export function computeTravelSummary(
  geoAttendanceRecords: ReadonlyArray<GeoAttendanceRecord>,
): TravelSummary {
  if (geoAttendanceRecords.length === 0) {
    return { totalDistanceMeters: 0, locationsVisited: 0, locations: [] };
  }

  let totalDistanceMeters = 0;
  const uniqueLocations = new Map<string, { latitude: string; longitude: string }>();

  for (const record of geoAttendanceRecords) {
    totalDistanceMeters += record.distanceMeters;

    // Use entity coordinates as the "location visited" (deduplicate by entity position)
    const locationKey = `${record.entityLatitude},${record.entityLongitude}`;
    if (!uniqueLocations.has(locationKey)) {
      uniqueLocations.set(locationKey, {
        latitude: record.entityLatitude,
        longitude: record.entityLongitude,
      });
    }
  }

  return {
    totalDistanceMeters,
    locationsVisited: uniqueLocations.size,
    locations: [...uniqueLocations.values()],
  };
}
