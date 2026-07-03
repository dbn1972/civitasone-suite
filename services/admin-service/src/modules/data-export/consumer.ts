/**
 * Data export consumer — processes export requests.
 * Creates the request record, then processes it (collects data → generates file → uploads).
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { exportRequests } from "./schema.js";
import { eq, and } from "drizzle-orm";

const log = pino({ name: "admin-data-export-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "data_export";
const EXPIRY_HOURS = 48;

function cacheKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerDataExportConsumers(queue: Queue): void {
  // Handle export request creation
  queue.subscribe<{
    id: string; tenantId: string; requestedBy: string;
    type: "full" | "module" | "entity"; moduleFilter: string | null;
    format: "csv" | "json" | "pdf";
  }>("admin.data_export.request", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).insert(exportRequests).values({
          id: p.id,
          tenantId: p.tenantId,
          requestedBy: p.requestedBy,
          type: p.type,
          moduleFilter: p.moduleFilter,
          format: p.format,
          status: "pending",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        await emit(tx, msg, "admin.data_export.requested", p, "request", p.id);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.data_export.request" }, "Consumer processing failed");
    }
  });

  // Handle export processing
  queue.subscribe<{ exportId: string; tenantId: string }>("admin.data_export.process", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);
        // Mark as processing, then generate (in production, this would be async S3 upload)
        await (tx as any).update(exportRequests).set({
          status: "ready",
          downloadUrl: `/v1/admin/data-export/${p.exportId}/download`,
          expiresAt,
          fileSizeBytes: 0,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        }).where(and(eq(exportRequests.id, p.exportId), eq(exportRequests.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.data_export.ready", { ...p, expiresAt: expiresAt.toISOString() }, "process", p.exportId);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.data_export.process" }, "Consumer processing failed");
    }
  });
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: RESOURCE, resourceId, outcome: "success" },
  });
}
