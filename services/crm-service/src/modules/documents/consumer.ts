/**
 * DM-001/002 documents consumer. Idempotent (markProcessed), tenant-scoped.
 *
 *  • confirmDocument  — create a metadata row (scan_status='pending'). When it
 *    supersedes a prior document, the new row inherits that document's lineage,
 *    takes version = prior.max + 1, and the prior current row is flipped
 *    is_current=false — the versioning invariant, computed atomically here.
 *  • deleteDocument   — soft-delete (deleted_at set, is_current=false so the
 *    partial unique index frees the lineage). The S3 object is retained by policy.
 *  • verifyDocument   — record a verified/rejected decision + verifier + timestamp.
 *  • recordDocumentScan — set scan_status from the platform scanner callback.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-documents-consumer" });
const AUDIT = "audit.event.record";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface ConfirmPayload {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  docType: string | null;
  title: string;
  filename: string;
  storageKey: string;
  storageProvider: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  supersedesId: string | null;
  expiryDate: string | null;
}

async function audit(
  tx: Tx,
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  id: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: "crm",
      action,
      resourceType: "document",
      resourceId: id,
      outcome: "success",
      ...(metadata ? { metadata } : {}),
    },
  });
}

export function registerDocumentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.confirmDocument, async (msg) => {
    const p = msg.payload as ConfirmPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        let lineageId = p.id;
        let version = 1;

        if (p.supersedesId) {
          const prior = (await tx.execute(sql`
            SELECT lineage_id AS "lineageId", version FROM crm.documents
            WHERE id = ${p.supersedesId} AND tenant_id = ${p.tenantId}
          `)) as unknown as Array<{ lineageId: string; version: number }>;
          if (prior[0]) {
            lineageId = prior[0].lineageId;
            // Highest version in the lineage wins the next number (race-safe under tx).
            const maxRow = (await tx.execute(sql`
              SELECT COALESCE(MAX(version), 0) AS "maxv" FROM crm.documents
              WHERE tenant_id = ${p.tenantId} AND lineage_id = ${lineageId}
            `)) as unknown as Array<{ maxv: number }>;
            version = Number(maxRow[0]?.maxv ?? 0) + 1;
            // Demote every current row in the lineage so the new row is the only current.
            await tx.execute(sql`
              UPDATE crm.documents SET is_current = false
              WHERE tenant_id = ${p.tenantId} AND lineage_id = ${lineageId} AND is_current = true
            `);
          }
        }

        await tx.execute(sql`
          INSERT INTO crm.documents
            (id, tenant_id, subject_type, subject_id, doc_type, title, filename, storage_key,
             storage_provider, mime_type, size_bytes, checksum, lineage_id, version, is_current,
             scan_status, expiry_date, uploaded_by)
          VALUES
            (${p.id}, ${p.tenantId}, ${p.subjectType}, ${p.subjectId}, ${p.docType}, ${p.title},
             ${p.filename}, ${p.storageKey}, ${p.storageProvider}, ${p.mimeType}, ${p.sizeBytes},
             ${p.checksum}, ${lineageId}, ${version}, true, 'pending', ${p.expiryDate}, ${msg.actorId})
        `);

        await enqueue(tx, {
          topic: EVENTS.documentUploaded,
          eventType: EVENTS.documentUploaded,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { documentId: p.id, subjectType: p.subjectType, subjectId: p.subjectId, version },
        });
        await audit(tx, msg, "document_upload", p.id, { subjectType: p.subjectType, version });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "confirmDocument failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.deleteDocument, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          UPDATE crm.documents SET deleted_at = now(), is_current = false
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND deleted_at IS NULL
        `);
        await enqueue(tx, {
          topic: EVENTS.documentDeleted,
          eventType: EVENTS.documentDeleted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { documentId: p.id },
        });
        await audit(tx, msg, "document_delete", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteDocument failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.verifyDocument, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; status: string; reason: string | null };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          UPDATE crm.documents
          SET verification_status = ${p.status}, verified_by = ${msg.actorId}, verified_at = now()
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND deleted_at IS NULL
        `);
        await enqueue(tx, {
          topic: EVENTS.documentVerified,
          eventType: EVENTS.documentVerified,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { documentId: p.id, status: p.status },
        });
        await audit(tx, msg, "document_verify", p.id, { status: p.status });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "verifyDocument failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.recordDocumentScan, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; scanStatus: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          UPDATE crm.documents SET scan_status = ${p.scanStatus}
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
        `);
        await enqueue(tx, {
          topic: EVENTS.documentScanned,
          eventType: EVENTS.documentScanned,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { documentId: p.id, scanStatus: p.scanStatus },
        });
        await audit(tx, msg, "document_scan_result", p.id, { scanStatus: p.scanStatus });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "recordDocumentScan failed");
      throw err;
    }
  });
}
