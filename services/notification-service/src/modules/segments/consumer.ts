import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { validateCriteria, type SegmentCriteria } from "./domain.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerSegmentConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  q.subscribe<{
    id: string; tenantId: string; name: string;
    description?: string; criteria: SegmentCriteria;
  }>(COMMANDS.createSegment, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      const validationError = validateCriteria(p.criteria);
      if (validationError) {
        throw new NonRetryableError("INVALID_CRITERIA", validationError);
      }

      await repo.insertSegment(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        description: p.description ?? null,
        criteria: p.criteria,
        cachedCount: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.segmentCreated,
        eventType: EVENTS.segmentCreated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { segmentId: p.id, name: p.name },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "create_segment", resourceType: "segment", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "segments_list", msg.tenantId));
  });

  q.subscribe<{
    id: string; tenantId: string; name?: string;
    description?: string; criteria?: SegmentCriteria;
  }>(COMMANDS.updateSegment, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      if (p.criteria) {
        const validationError = validateCriteria(p.criteria);
        if (validationError) {
          throw new NonRetryableError("INVALID_CRITERIA", validationError);
        }
      }

      await repo.updateSegmentById(tx, p.id, p.tenantId, {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.criteria !== undefined ? { criteria: p.criteria } : {}),
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "update_segment", resourceType: "segment", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "segments_list", msg.tenantId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "segment", msg.payload.id));
  });

  q.subscribe<{ segmentId: string; tenantId: string }>(
    COMMANDS.resolveSegment, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;

        // Reads through the already-open `tx` (not `repo.findSegmentById`'s
        // `scopedRead`) to avoid opening a second, nested transaction on this
        // same connection-pool deadlock shape -- see `findSegmentByIdInTx` in
        // `./repo.ts`.
        const segment = await repo.findSegmentByIdInTx(tx, p.tenantId, p.segmentId);
        if (!segment) {
          throw new NonRetryableError("SEGMENT_NOT_FOUND", `Segment ${p.segmentId} not found`);
        }

        // In production, this would call identity-service to resolve recipients.
        // For now, build and emit the filters as the resolved result.
        const filters = repo.resolveSegmentFilters(segment.criteria as SegmentCriteria);

        await enqueue(tx, {
          topic: EVENTS.segmentResolved,
          eventType: EVENTS.segmentResolved,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { segmentId: p.segmentId, filters, recipientCount: segment.cachedCount ?? 0 },
        });
      });
    },
  );
}
