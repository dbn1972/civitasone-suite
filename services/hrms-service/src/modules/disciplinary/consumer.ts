import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { DisciplinaryCaseInsert } from "./schema.js";

const AUDIT = "audit.event.record";

/**
 * Disciplinary command consumer — currently the eOffice submit-for-approval
 * flow. The route validates (state machine + penalty class) and publishes
 * `hrms.disciplinary.submit_approval`; this handler records the proposed
 * penalty on the case and moves it to `pending_approval` (idempotent +
 * tenant/status-guarded). The eFile is raised against the case id
 * (source_ref_type "hr_disciplinary"); the decision arrives on
 * `hrms.disciplinary.file_decided` and is applied by the eoffice-consumer.
 */
export function registerDisciplinaryConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.disciplinarySubmitApproval, async (msg) => {
    const p = msg.payload as {
      caseId: string; tenantId: string;
      penaltyType: string; penaltyClass: "minor" | "major";
      penaltyDate: string; penaltyDetail?: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findCaseTx(tx, p.tenantId, p.caseId);
      const prior = existing?.status ?? null;
      const set: Partial<DisciplinaryCaseInsert> = {
        penaltyClass: p.penaltyClass,
        penaltyType: p.penaltyType,
        penaltyDate: p.penaltyDate,
        ...(p.penaltyDetail ? { penaltyDetail: p.penaltyDetail } : {}),
      };
      // Guarded: only a case still in the pre-penalty inquiry/charge state moves
      // to pending_approval. Mismatched state / wrong tenant → no-op.
      const row = await repo.transitionCase(tx, p.tenantId, p.caseId, msg.actorId, {
        from: ["finding_recorded", "charge_memo_issued"], to: "pending_approval", set,
      });
      if (!row) return;
      await repo.appendEvent(tx, {
        tenantId: p.tenantId, caseId: p.caseId, fromStatus: prior, toStatus: "pending_approval",
        action: "submit_for_approval", notes: p.notes ?? null, actorId: msg.actorId,
      });
      await audit(tx, msg, "submit_for_eoffice_approval", p.caseId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "disciplinary_case", p.caseId));
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType: "disciplinary_case", resourceId, outcome: "success" },
  });
}
