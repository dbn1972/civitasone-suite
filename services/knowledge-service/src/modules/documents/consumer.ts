import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { DocumentView } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerDocumentsConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe<DocumentView>(COMMANDS.createDocument, async (msg) => {
    let created = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      // UAT owner decision #15: a duplicate live title is refused here too (the
      // route pre-checks, but two racing creates both pass it). The unique index
      // swallows the loser; markProcessed + the audit row stay in this ONE txn.
      const inserted = await repo.insertUnlessDuplicateTitle(tx, {
        id: p.id,
        tenantId: p.tenantId,
        title: p.title,
        category: p.category,
        status: p.status,
        // GAP-KNOWLEDGE-DOCUMENTS-NEW-01: persist the publisher-chosen access level.
        accessLevel: p.accessLevel ?? "internal",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      if (!inserted) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "knowledge", action: "create", resourceType: "document", resourceId: p.id, outcome: "rejected", reason: "DUPLICATE_TITLE" },
        });
        return;
      }
      created = true;
      await emit(tx, msg, EVENTS.documentCreated, { documentId: p.id, title: p.title }, "create", p.id);
    });
    if (created) await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string
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
    payload: { service: "knowledge", action, resourceType: "document", resourceId, outcome: "success" },
  });
}
