import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { assessees } from "./schema.js";
import { eq, and } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";

export function registerAssesseeConsumers(queue: Queue): void {
  // ─── assesseeCreate ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.assesseeCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload as {
        assesseeType: string;
        identifierNo: string;
        ownerName: string;
        address: string;
        wardNo?: string | null;
        zoneNo?: string | null;
        connectionSize?: string | null;
        propertyType?: string | null;
        builtUpArea?: bigint | null;
      };

      await tx.insert(assessees).values({
        tenantId: msg.tenantId,
        assesseeType: p.assesseeType,
        identifierNo: p.identifierNo,
        ownerName: p.ownerName,
        address: p.address,
        wardNo: p.wardNo ?? null,
        zoneNo: p.zoneNo ?? null,
        connectionSize: p.connectionSize ?? null,
        propertyType: p.propertyType ?? null,
        builtUpArea: p.builtUpArea ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.assesseeCreated,
        eventType: EVENTS.assesseeCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: msg.payload as Record<string, unknown>,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "assessee.created",
          resourceType: "assessee",
          outcome: "success",
        },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:assessees`);
  });

  // ─── assesseeUpdate ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.assesseeUpdate, async (msg) => {
    const { assesseeId, version, patch } = msg.payload as {
      assesseeId: string;
      version: number;
      patch: Record<string, unknown>;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const result = await tx
        .update(assessees)
        .set({
          ...patch,
          version: version + 1,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(assessees.tenantId, msg.tenantId),
            eq(assessees.id, assesseeId),
            eq(assessees.version, version),
          ),
        )
        .returning({ id: assessees.id });

      if (result.length === 0) {
        throw new NonRetryableError("VERSION_CONFLICT");
      }

      await enqueue(tx, {
        topic: EVENTS.assesseeUpdated,
        eventType: EVENTS.assesseeUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { assesseeId, version: version + 1, changedFields: Object.keys(patch) },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "assessee.updated",
          resourceType: "assessee",
          resourceId: assesseeId,
          outcome: "success",
        },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:assessees`);
    await cache.invalidate(`${SERVICE}:${msg.tenantId}:assessee:${assesseeId}`);
  });
}
