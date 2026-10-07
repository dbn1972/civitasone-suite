import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * GAP-PROJECTS-ESCALATIONS-02: escalation action consumer.
 *
 * The escalation list is a synthetic projection; this consumer persists the
 * ACTION STATE for an escalation (one row per tenant+project) and advances its
 * lifecycle. On the FIRST action against a project that has no persisted row,
 * it seeds the row as "open" (from the projection snapshot in the payload)
 * before applying the transition, so acknowledging/clearing a never-before-
 * touched escalation works. Every successful action writes an audit event in
 * the SAME transaction. Idempotent via markProcessed + the (tenant, project)
 * unique index + optimistic version guards.
 */
export function registerEscalationConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  queue.subscribe(COMMANDS.escalationAct, async (msg) => {
    const p = msg.payload as {
      projectId: string; tenantId: string;
      action: "acknowledge" | "reassign" | "clear";
      reason: string | null; escalatedTo: string | null;
      severity: string | null; issue: string | null;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Seed the action-state row on first action (open). Idempotent: a row may
      // already exist (prior action) — then this is a no-op and we read it.
      let row = await repo.findByProjectIdTx(tx, p.tenantId, p.projectId);
      if (!row) {
        await repo.insertIdempotent(tx, {
          id: randomUUID(),
          tenantId: p.tenantId,
          projectId: p.projectId,
          severity: p.severity ?? "pending",
          issue: p.issue ?? null,
          status: "open",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        row = await repo.findByProjectIdTx(tx, p.tenantId, p.projectId);
      }
      if (!row) return; // could not establish a record (should not happen)

      const version = row.version ?? 1;
      let updated = 0;
      let auditAction = "";

      if (p.action === "acknowledge") {
        // open → acknowledged
        if (row.status !== "open") return; // already acknowledged/cleared → no-op
        updated = await repo.transitionTx(
          tx, p.tenantId, p.projectId, "open", "acknowledged", msg.actorId, version,
          { acknowledgedBy: msg.actorId, acknowledgedAt: new Date(), note: p.reason },
        );
        auditAction = "escalation_acknowledge";
      } else if (p.action === "reassign") {
        // side transition: keep status, change escalatedTo. Allowed while not cleared.
        if (row.status === "cleared") return; // terminal → no-op
        updated = await repo.transitionTx(
          tx, p.tenantId, p.projectId, row.status, row.status, msg.actorId, version,
          { escalatedTo: p.escalatedTo, note: p.reason },
        );
        auditAction = "escalation_reassign";
      } else if (p.action === "clear") {
        // open | acknowledged → cleared
        if (row.status !== "open" && row.status !== "acknowledged") return; // already cleared → no-op
        updated = await repo.transitionTx(
          tx, p.tenantId, p.projectId, row.status, "cleared", msg.actorId, version,
          { clearedBy: msg.actorId, clearedAt: new Date(), note: p.reason },
        );
        auditAction = "escalation_clear";
      } else {
        return; // unknown action
      }

      if (updated === 0) return; // lost the optimistic-lock race → no-op, no audit
      await enqueue(tx, {
        topic: EVENTS.escalationActioned, eventType: EVENTS.escalationActioned,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { projectId: p.projectId, action: p.action, ...(p.escalatedTo ? { escalatedTo: p.escalatedTo } : {}) },
      });
      await audit(tx, msg, auditAction, "escalation", p.projectId, p.reason ?? undefined);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "project", "escalations"));
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
  reason?: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "project", action, resourceType, resourceId, outcome: "success", ...(reason ? { reason } : {}) },
  });
}
