import { sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { insertFileMovement } from "../files/repo.js";

const AUDIT_TOPIC = "audit.event.record";

type HandoverPayload = {
  id: string; tenantId: string; fromOfficerId: string; toOfficerId: string;
  reason: string; remarks?: string;
};

export function registerHandoverConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.handoverCreate, async (msg) => {
    const p = msg.payload as HandoverPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Record the handover request.
      await repo.insertHandover(tx, {
        id: p.id, tenantId: p.tenantId,
        fromOfficerId: p.fromOfficerId, toOfficerId: p.toOfficerId,
        reason: p.reason, remarks: p.remarks ?? null,
        status: "pending", fileCount: 0,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });

      // Find the active files currently held by the outgoing officer.
      const rows = await tx.execute(sql`
        SELECT id FROM files.estab_files
        WHERE tenant_id = ${p.tenantId} AND current_with = ${p.fromOfficerId} AND status = 'active'
      `);
      const fileIds = (rows as unknown as Array<{ id: string }>).map((r) => r.id);

      // Reassign each file and record a movement on its timeline.
      for (const fileId of fileIds) {
        await tx.execute(sql`
          UPDATE files.estab_files
          SET current_with = ${p.toOfficerId}, updated_by = ${msg.actorId}, updated_at = NOW()
          WHERE id = ${fileId} AND tenant_id = ${p.tenantId}
        `);
        await insertFileMovement(tx, {
          tenantId: p.tenantId, fileId,
          fromOfficerId: p.fromOfficerId, toOfficerId: p.toOfficerId,
          action: "charge_handover",
          remarks: `Charge handover (${p.reason})${p.remarks ? `: ${p.remarks}` : ""}`,
        });
      }

      // Complete the handover.
      await repo.updateHandover(tx, p.id, {
        status: "completed", fileCount: fileIds.length, completedAt: new Date(),
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "estab", action: "charge.handover", resourceType: "charge_handover",
          resourceId: p.id, outcome: "success",
          metadata: { from: p.fromOfficerId, to: p.toOfficerId, reason: p.reason, fileCount: fileIds.length },
        },
      });
    });
  });
}
