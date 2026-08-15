import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

export function registerAppraisalConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.appraisalCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string;
      appraisalPeriod: string; reviewerId: string | null; status: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // SoD guard: reviewer must differ from appraisee (PASS_WITH_NOTES S9 fix)
      if (p.reviewerId && p.reviewerId === p.employeeId) {
        throw new Error("reviewer and appraisee must be different employees");
      }
      await repo.insertAppraisal(tx, {
        id: p.id,
        tenantId: p.tenantId,
        employeeId: p.employeeId,
        appraisalPeriod: p.appraisalPeriod,
        status: p.status ?? "self_pending",
        reviewerId: p.reviewerId ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "appraisal", p.id);
    });
  });

  queue.subscribe(COMMANDS.appraisalAdvanceStage, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; stage: string; rating: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Re-fetch inside the transaction for the current rating fallback
      const existing = await repo.findById(p.id, p.tenantId);
      if (!existing) throw new Error(`appraisal ${p.id} not found`);
      await repo.updateAppraisal(tx, p.id, {
        status: p.stage,
        rating: p.rating ?? existing.rating,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "advance_stage", "appraisal", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });
}
