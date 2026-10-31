/**
 * B9-wf1: converge a domain-side decision with its workflow approval.
 *
 * A procurement plan / PO amendment can be decided directly (the plan page's
 * Approve button calls PATCH /plans/:id/approve) as well as through its
 * workflow task. A direct decision used to leave the task pending in the
 * approvals inbox for good. procurement-service now sends
 * `workflow.instance.close_by_ref` from its approve / reject consumers; this
 * consumer completes every still-open instance bound to that record, and its
 * pending tasks, with the domain's decision.
 *
 * Idempotent and loop-free: when the decision itself came from the workflow
 * task, the instance is already completed by the time procurement answers, so
 * nothing is open and this is a no-op. Scoped to the refTypes whose producer
 * sends it, so a stray message cannot close any other module's approvals.
 */
import type { Queue } from "@civitasone/queue";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, INSTANCE_RESOURCE, TASK_RESOURCE } from "../../topics.js";
import { instances } from "../instances/schema.js";
import { tasks } from "./schema.js";
import * as repo from "./repo.js";
import * as instanceRepo from "../instances/repo.js";
import * as historyRepo from "../history/repo.js";
import { subscribeWithDlq } from "../dlq/wrap.js";

/** refTypes whose domain service sends close_by_ref (procurement-service). */
export const CLOSE_BY_REF_TYPES = ["procurement_plan", "procurement_po_amendment"] as const;

export type CloseByRefPayload = {
  tenantId: string;
  refType: string;
  refId: string;
  decision: "approve" | "reject";
  reason?: string;
};

const AUDIT_TOPIC = "audit.event.record";

/** `queue` must already be tenant-scoped (registerTasksConsumers does that). */
export function registerCloseByRefConsumer(queue: Queue): void {
  subscribeWithDlq<CloseByRefPayload>(queue, COMMANDS.closeInstanceByRef, async (msg) => {
    const p = msg.payload;
    if (!(CLOSE_BY_REF_TYPES as readonly string[]).includes(p.refType)) return;
    if (p.decision !== "approve" && p.decision !== "reject") return;
    let closed = 0;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const open = await tx.select().from(instances).where(and(
        eq(instances.tenantId, p.tenantId),
        eq(instances.refType, p.refType),
        eq(instances.refId, p.refId),
        inArray(instances.status, ["active", "suspended"]),
      )).for("update");
      for (const instance of open) {
        const pending = await tx.select().from(tasks).where(and(
          eq(tasks.instanceId, instance.id), eq(tasks.tenantId, p.tenantId), eq(tasks.status, "pending"),
        ));
        for (const t of pending) {
          await repo.markCompleted(tx, t.id, p.tenantId, msg.actorId, p.decision);
        }
        await instanceRepo.markCompleted(tx, instance.id, msg.actorId);
        await historyRepo.record(tx, {
          tenantId: p.tenantId, instanceId: instance.id, taskId: null,
          fromNode: instance.currentNode ?? null, toNode: null,
          action: "closed_by_domain", decision: p.decision, actorId: msg.actorId,
          detail: { refType: p.refType, refId: p.refId, closedTaskIds: pending.map((t) => t.id), ...(p.reason ? { reason: p.reason } : {}) },
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "workflow", action: "close_by_ref", resourceType: "instance", resourceId: instance.id, outcome: "success" },
        });
        closed++;
      }
    });
    if (closed > 0) {
      await cache.invalidateResource(msg.tenantId, INSTANCE_RESOURCE);
      await cache.invalidateResource(msg.tenantId, TASK_RESOURCE);
    }
  });
}
