import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { withTenantConsumer } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cadastralParcelHistory, cadastralSurveys, cadastralDisputes } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export const CADASTRAL_CREATE = "location.cadastral.create";
export const SURVEY_SCHEDULE = "location.survey.schedule";
export const DISPUTE_CREATE = "location.dispute.create";

type ParcelPayload = {
  id: string; tenantId: string; parcelNo: string; village: string; district: string;
  areaSquareMeters: number; boundary: Array<{ lat: number; lng: number }>;
  landUse: string; ownershipType: string;
};
type SurveyPayload = { id: string; parcelIds: string[]; surveyorId: string; scheduledDate: string };
type DisputePayload = { id: string; parcelAId: string; parcelBId: string; description: string };

/** Build a closed GeoJSON Polygon string from a boundary ring (lng/lat order). */
function boundaryToGeoJson(boundary: Array<{ lat: number; lng: number }>): string {
  const ring = boundary.map((p) => [p.lng, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0]!, first[1]!]);
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

/**
 * SVC-113: cadastral registry persistence — parcels (with PostGIS Polygon geom),
 * surveys, and boundary disputes. Idempotent, tenant-GUC transaction.
 */
export function registerCadastralConsumers(queue: Queue): void {
  queue.subscribe<ParcelPayload>(CADASTRAL_CREATE, withTenantConsumer(async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const geojson = boundaryToGeoJson(p.boundary);
      await tx.execute(sql`
        INSERT INTO location.cadastral_parcels
          (id, tenant_id, parcel_no, village, district, area_square_meters, boundary, geom, land_use, ownership_type, status, created_by, version)
        VALUES (
          ${p.id}, ${p.tenantId}, ${p.parcelNo}, ${p.village}, ${p.district}, ${p.areaSquareMeters},
          ${JSON.stringify(p.boundary)}::jsonb,
          ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326),
          ${p.landUse}, ${p.ownershipType}, 'active', ${msg.actorId}, 1
        )
        ON CONFLICT (id) DO NOTHING
      `);
      await tx.insert(cadastralParcelHistory).values({
        tenantId: p.tenantId, parcelId: p.id, eventType: "registered",
        detail: { parcelNo: p.parcelNo, areaSquareMeters: p.areaSquareMeters }, actorId: msg.actorId,
      });
      await emit(tx, msg, "location.cadastral.registered", { parcelId: p.id, parcelNo: p.parcelNo }, "create", "cadastral_parcel", p.id);
    });
  }));

  queue.subscribe<SurveyPayload>(SURVEY_SCHEDULE, withTenantConsumer(async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await tx.insert(cadastralSurveys).values({
        id: p.id, tenantId: msg.tenantId, parcelIds: p.parcelIds, surveyorId: p.surveyorId,
        scheduledDate: new Date(p.scheduledDate), status: "scheduled", createdBy: msg.actorId,
      });
      await emit(tx, msg, "location.survey.scheduled", { surveyId: p.id }, "schedule", "cadastral_survey", p.id);
    });
  }));

  queue.subscribe<DisputePayload>(DISPUTE_CREATE, withTenantConsumer(async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await tx.insert(cadastralDisputes).values({
        id: p.id, tenantId: msg.tenantId, parcelAId: p.parcelAId, parcelBId: p.parcelBId,
        description: p.description, status: "filed", createdBy: msg.actorId,
      });
      await emit(tx, msg, "location.dispute.filed", { disputeId: p.id }, "file", "cadastral_dispute", p.id);
    });
  }));
}

async function emit(
  tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>,
  action: string, resourceType: string, resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "location", action, resourceType, resourceId, outcome: "success" },
  });
}
