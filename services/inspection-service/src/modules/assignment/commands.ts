/**
 * inspection-service: assignment module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * Envelope shape: { messageId, type, tenantId, actorId, correlationId,
 *   schemaVersion, payload }
 *
 * _Requirements: 4.1, 4.2, 4.4, 4.5_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface InspectorAssignPayload {
  inspectionId: string;
  inspectorId: string;
  inspectionTypeId: string;
  entityId: string;
  scheduledDate: string;
  competencies?: string[];
  conflictCheckBypass?: boolean;
}

export interface TourPlanGeneratePayload {
  inspectorId: string;
  periodStart: string;
  periodEnd: string;
  maxDailyInspections?: number;
}

export interface GeoAttendanceMarkPayload {
  inspectionId: string;
  inspectorId: string;
  latitude: string;
  longitude: string;
  entityLatitude: string;
  entityLongitude: string;
  geofenceRadius: number;
  deviceId: string;
  timestamp: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  };
}

// ── Publish functions ─────────────────────────────────────────────────────────

export async function publishInspectorAssign(
  payload: InspectorAssignPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.inspectorAssign, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.inspectorAssign, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishTourPlanGenerate(
  payload: TourPlanGeneratePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.tourPlanGenerate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.tourPlanGenerate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishGeoAttendanceMark(
  payload: GeoAttendanceMarkPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.geoAttendanceMark, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.geoAttendanceMark, msg);
  return { accepted: true, messageId: msg.messageId };
}
