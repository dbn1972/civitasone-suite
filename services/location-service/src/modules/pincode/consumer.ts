import { randomUUID } from "node:crypto";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCES } from "../../topics.js";
import * as repo from "./repo.js";
import type { BulkImportBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerPincodeConsumers(queue: Queue): void {
  queue.subscribe<{ batchId: string; records: BulkImportBody["records"] }>(COMMANDS.pincodeBulkImport, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rows = msg.payload.records.map((r) => ({
        id: randomUUID(),
        pincode: r.pincode,
        postOffice: r.postOffice,
        district: r.district,
        state: r.state,
        latitude: r.latitude ?? null,
        longitude: r.longitude ?? null,
        version: 1,
      }));
      await repo.insertBatch(tx, rows);
      await emit(tx, msg, EVENTS.pincodeBulkImported, { batchId: msg.payload.batchId, count: rows.length }, "bulkImport", msg.payload.batchId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCES.pincode);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "location", action, resourceType: "pincode", resourceId, outcome: "success" },
  });
}
