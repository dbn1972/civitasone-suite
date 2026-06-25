import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "../disbursement/repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Integration chain #4: project-service → grant-service.
 *
 * When a physical project milestone completes (`project.milestone.completed`),
 * any grant installment that was GATED on that milestone is released: we emit
 * the existing `grant.disbursement.initiate` command for each linked installment
 * so the standard disbursement pipeline (duplicate / approved-cap / UC-gate /
 * scheme-budget guards + PFMS EFT) runs unchanged. Idempotent via markProcessed
 * (a redelivered milestone event releases each installment exactly once);
 * audited via the outbox.
 */
export function registerIntegrationConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.projectMilestoneCompleted, async (msg) => {
    const p = msg.payload as { milestoneId: string; projectId?: string; name?: string };
    if (!p.milestoneId) return;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const installments = await repo.findReleasableInstallmentsByMilestone(
        tx, p.milestoneId, msg.tenantId,
      );

      for (const inst of installments) {
        // Emit the standard release command; the disbursement consumer owns the
        // installment status transition (pending -> disbursed) and runs every
        // PFMS guard. We do NOT mutate installment status here (the status CHECK
        // only allows pending/disbursed/failed). Idempotency across a redelivered
        // milestone event is enforced by markProcessed above; a second DISTINCT
        // milestone event is a no-op because the installment is no longer pending.
        await enqueue(tx, {
          topic: COMMANDS.disbursementInitiate, eventType: COMMANDS.disbursementInitiate,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            id: randomUUID(),
            tenantId: msg.tenantId,
            installmentId: inst.id,
            mode: "PFMS",
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "grant", action: "milestone_fund_release",
            resourceType: "grant_installment", resourceId: inst.id, outcome: "success",
          },
        });
      }
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "installments_milestone", p.milestoneId));
  });
}
