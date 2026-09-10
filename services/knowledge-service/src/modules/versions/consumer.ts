import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { DocumentVersionView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "document-version";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerVersionsConsumers(queue: Queue): void {
  queue.subscribe<DocumentVersionView>(COMMANDS.versionCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      // TX-016: the producer (versions/commands.ts) precomputes versionNo
      // via getLatestVersionNo() + 1 OUTSIDE any transaction, purely to
      // prime the optimistic cache entry below -- it is never returned to
      // the caller (see the Accepted return type) and is not authoritative.
      // Two versionCreate/versionRestore commands racing on the same
      // document can carry the identical precomputed number. Lock and
      // recompute here, inside the transaction, exactly as versionRestore
      // does, so the persisted number is always correct regardless of what
      // the payload says.
      await repo.lockVersionSeq(tx, p.tenantId, p.documentId);
      const versionNo = (await repo.getLatestVersionNoTx(tx, p.tenantId, p.documentId)) + 1;

      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        documentId: p.documentId,
        versionNo,
        s3Key: p.s3Key,
        sizeBytes: p.sizeBytes,
        changeNote: p.changeNote,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.versionCreated, {
        versionId: p.id,
        documentId: p.documentId,
        versionNo,
      }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.versionRestore, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload as { id: string; documentId: string; versionId: string; changeNote: string; tenantId: string };

      // Get the version being restored -- TX-001: routed through the Tx
      // sibling since we are already inside db.transaction() above.
      const sourceVersion = await repo.getByIdTx(tx, p.tenantId, p.versionId);
      if (!sourceVersion) return;

      // Create a new version that copies the restored version's S3 key.
      // TX-016: lock version-number allocation for this document before
      // reading the latest number -- see repo.lockVersionSeq() for why a
      // row-level lock cannot substitute for this.
      await repo.lockVersionSeq(tx, p.tenantId, p.documentId);
      const nextVersionNo = (await repo.getLatestVersionNoTx(tx, p.tenantId, p.documentId)) + 1;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        documentId: p.documentId,
        versionNo: nextVersionNo,
        s3Key: sourceVersion.s3Key,
        sizeBytes: sourceVersion.sizeBytes,
        changeNote: p.changeNote,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      await emit(tx, msg, EVENTS.versionRestored, {
        versionId: p.id,
        documentId: p.documentId,
        restoredFrom: p.versionId,
        versionNo: nextVersionNo,
      }, "restore", p.id);
    });
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
    payload: { service: "knowledge", action, resourceType: "document-version", resourceId, outcome: "success" },
  });
}
