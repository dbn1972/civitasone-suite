import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUME_TOPICS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;

export function registerExportConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.exportCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      from: string;
      to: string;
      format: "json" | "csv";
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertExport(tx, {
        id: p.id,
        tenantId: p.tenantId,
        periodFrom: new Date(p.from),
        periodTo: new Date(p.to),
        format: p.format,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.exportRequested,
        eventType: EVENTS.exportRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { exportId: p.id, from: p.from, to: p.to, format: p.format },
      });
      await audit(tx, msg, "create", RESOURCE.export, p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.export, p.id));
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "audit", action, resourceType, resourceId, outcome: "success" },
  });
}
