import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, MODULE_CALLBACK_TOPICS } from "../../topics.js";
import { computeFileDueBy } from "../files/domain.js";
import * as repo from "../files/repo.js";

const AUDIT_TOPIC = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";

/**
 * Linkage consumer — handles cross-module file creation.
 *
 * When a module raises a file via estab.file.from_module:
 * 1. Create the eFile with source_ref_type + source_ref_id + initiated_by
 * 2. Insert the proposal noting (yellow)
 * 3. Submit for approval → trigger workflow with the module's approval chain
 *
 * The decision callback (on approval) is emitted by the files consumer's
 * fileApprove handler, which reads source_ref_type and looks up the callback topic.
 */
export function registerLinkageConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.fileFromModule, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; fileNo: string; subject: string; dept: string;
      classification: string; priority: string; currentWith: string;
      sourceRefType: string; sourceRefId: string; initiatedBy: string;
      approvalChain: string; initialNote: string; sourceContext: Record<string, unknown>;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const dueBy = computeFileDueBy();

      // 1. Create the file with module linkage
      await repo.insertFile(tx, {
        id: p.id, tenantId: p.tenantId, fileNo: p.fileNo, subject: p.subject,
        dept: p.dept, priority: p.priority, classification: p.classification,
        currentWith: p.currentWith, status: "active",
        inwardId: null, dakNo: null, dueBy, parentFileId: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });

      // Store source linkage on the file (raw SQL — columns added in migration 0007)
      await tx.execute(sql`
        UPDATE files.estab_files
        SET source_ref_type = ${p.sourceRefType},
            source_ref_id   = ${p.sourceRefId},
            initiated_by    = ${p.initiatedBy},
            approval_chain  = ${p.approvalChain},
            source_context  = ${JSON.stringify(p.sourceContext)}::jsonb
        WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
      `);

      // 2. Insert the proposal noting (yellow, draft → immediately submitted)
      const notingId = randomUUID();
      await repo.insertNoting(tx, {
        id: notingId, tenantId: p.tenantId, fileId: p.id, seq: 1,
        officerId: p.initiatedBy, body: p.initialNote,
        action: "initiate", noteType: "yellow", noteStatus: "submitted",
        eSigned: false, signedAt: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });

      // 3. Trigger workflow with the module-specific approval chain
      await enqueue(tx, {
        topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: randomUUID(),
          tenantId: msg.tenantId,
          name: `${p.sourceRefType} — ${p.fileNo}`,
          status: "active",
          definitionCode: p.approvalChain,
          startNodeKey: "review",
          initialTaskName: "Review & Recommend",
          version: 1,
          refType: "estab_file",
          refId: p.id,
        },
      });

      await enqueue(tx, {
        topic: EVENTS.fileCreated, eventType: EVENTS.fileCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fileId: p.id, fileNo: p.fileNo, subject: p.subject, sourceRefType: p.sourceRefType, sourceRefId: p.sourceRefId },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "estab", action: "raise_from_module", resourceType: "file", resourceId: p.id, outcome: "success", metadata: { sourceRefType: p.sourceRefType, sourceRefId: p.sourceRefId } },
      });
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.id));
  });
}

/**
 * Emit the decision callback to the source module.
 * Called from the files consumer when an eFile is approved/rejected.
 * Looks up the file's source_ref_type → callback topic, and emits the decision.
 */
export async function emitModuleDecisionCallback(
  tx: Parameters<typeof enqueue>[0],
  opts: {
    tenantId: string; fileId: string; correlationId: string;
    decision: "approved" | "rejected"; decidedBy: string;
    notingId?: string | null; dscHash?: string | null;
  },
): Promise<void> {
  // Read the file's source linkage
  const rows = await tx.execute(sql`
    SELECT source_ref_type, source_ref_id, source_context
    FROM files.estab_files
    WHERE id = ${opts.fileId} AND tenant_id = ${opts.tenantId}
  `);
  const row = (rows as unknown as Array<{ source_ref_type: string | null; source_ref_id: string | null; source_context: unknown }>)[0];
  if (!row?.source_ref_type || !row?.source_ref_id) return; // not a module-linked file

  const callbackTopic = MODULE_CALLBACK_TOPICS[row.source_ref_type];
  if (!callbackTopic) return; // unknown ref type — nothing to call back

  // Emit the decision back to the source module
  await enqueue(tx, {
    topic: callbackTopic, eventType: callbackTopic,
    tenantId: opts.tenantId, actorId: opts.decidedBy, correlationId: opts.correlationId,
    payload: {
      fileId: opts.fileId,
      refType: row.source_ref_type,
      refId: row.source_ref_id,
      decision: opts.decision,
      decidedBy: opts.decidedBy,
      notingId: opts.notingId ?? null,
      dscHash: opts.dscHash ?? null,
      sourceContext: row.source_context ?? {},
      decidedAt: new Date().toISOString(),
    },
  });

  // Log the decision callback for audit + observability
  await tx.execute(sql`
    INSERT INTO files.module_decision_log
      (id, tenant_id, file_id, source_ref_type, source_ref_id, decision, callback_topic, noting_id, dsc_hash, decided_by)
    VALUES
      (${randomUUID()}, ${opts.tenantId}, ${opts.fileId}, ${row.source_ref_type}, ${row.source_ref_id},
       ${opts.decision}, ${callbackTopic}, ${opts.notingId ?? null}, ${opts.dscHash ?? null}, ${opts.decidedBy})
  `);
}
