import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

type IndexPayload = {
  id: string;
  tenantId: string;
  documentId: string;
  title: string;
  content: string;
  tags: string[];
};

export function registerSearchConsumers(queue: Queue): void {
  // Index a single document
  queue.subscribe<IndexPayload>(COMMANDS.searchIndex, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await emit(tx, msg, EVENTS.searchIndexed, { documentId: msg.payload.documentId }, "index", msg.payload.documentId);
    });
    const p = msg.payload;
    await repo.indexDocument(msg.tenantId, {
      id: p.id,
      documentId: p.documentId,
      title: p.title,
      content: p.content,
      tags: p.tags,
    });
  });

  // Re-index all documents for tenant
  queue.subscribe(COMMANDS.searchReindex, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await emit(tx, msg, EVENTS.searchReindexed, { tenantId: msg.tenantId }, "reindex", msg.tenantId);
    });
    // Full reindex is handled by scheduled job; this just emits the event
  });

  // Remove a document from index
  queue.subscribe(COMMANDS.searchRemoveDocument, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload as { documentId: string };
      await emit(tx, msg, EVENTS.searchDocumentRemoved, { documentId: p.documentId }, "remove", p.documentId);
    });
    const p = msg.payload as { documentId: string };
    await repo.removeDocument(msg.tenantId, p.documentId);
  });

  // Listen for document.created events to auto-index
  queue.subscribe(EVENTS.documentCreated ?? "knowledge.document.created", async (msg) => {
    const p = msg.payload as { documentId?: string; title?: string };
    if (!p.documentId || !p.title) return;
    await repo.indexDocument(msg.tenantId, {
      id: msg.messageId,
      documentId: p.documentId,
      title: p.title,
      content: "",
      tags: [],
    });
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
    payload: { service: "knowledge", action, resourceType: "search-index", resourceId, outcome: "success" },
  });
}
