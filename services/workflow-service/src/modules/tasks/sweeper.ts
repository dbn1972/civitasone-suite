import { pino } from "pino";
import { and, eq, lte, isNull, isNotNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { tasks } from "./schema.js";
import * as historyRepo from "../history/repo.js";

const log = pino({ name: "workflow-sla-sweeper" });
const AUDIT_TOPIC = "audit.event.record";
const ESCALATION_TOPIC = "workflow.task.escalated";

/**
 * Find open tasks whose due_at has passed and which have not yet been
 * escalated, then escalate each: mark escalated_at, bump escalation_count,
 * append a transition_history row, and emit a notification + escalation event.
 * Returns the number of tasks escalated this sweep.
 */
export async function sweepOverdueTasks(now: Date = new Date(), batch = 200): Promise<number> {
  const due = await db.select().from(tasks)
    .where(and(
      eq(tasks.status, "pending"),
      isNotNull(tasks.dueAt),
      lte(tasks.dueAt, now),
      isNull(tasks.escalatedAt),
    ))
    .limit(batch);

  let escalated = 0;
  for (const t of due) {
    await db.transaction(async (tx) => {
      // re-check under the row to avoid double escalation across overlapping sweeps
      const res = await tx.update(tasks)
        .set({ escalatedAt: now, escalationCount: sql`${tasks.escalationCount} + 1`, updatedAt: now })
        .where(and(eq(tasks.id, t.id), isNull(tasks.escalatedAt)))
        .returning({ id: tasks.id });
      if (res.length === 0) return; // someone else escalated it

      await historyRepo.record(tx, {
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        taskId: t.id,
        fromNode: t.nodeKey,
        toNode: t.nodeKey,
        action: "escalate",
        decision: null,
        actorId: t.createdBy,
        detail: { reason: "sla_breach", dueAt: t.dueAt?.toISOString() ?? null },
      });

      const t2 = tx as Parameters<typeof enqueue>[0];
      const correlationId = randomUUID();
      await enqueue(t2, {
        topic: ESCALATION_TOPIC, eventType: ESCALATION_TOPIC,
        tenantId: t.tenantId, actorId: t.createdBy, correlationId,
        payload: { taskId: t.id, instanceId: t.instanceId, name: t.name, roleRef: t.roleRef, dueAt: t.dueAt?.toISOString() ?? null },
      });
      await enqueue(t2, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: t.tenantId, actorId: t.createdBy, correlationId,
        payload: buildNotificationPayload({
          eventType: ESCALATION_TOPIC,
          recipient: t.roleRef ?? t.instanceId,
          variables: {
            taskId: t.id,
            instanceId: t.instanceId,
            summary: `SLA breached — task overdue: ${t.name}`,
            link: `/workflow/tasks/${t.id}`,
          },
        }),
      });
      await enqueue(t2, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: t.tenantId, actorId: t.createdBy, correlationId,
        payload: { service: "workflow", action: "escalate", resourceType: "task", resourceId: t.id, outcome: "success" },
      });
      escalated++;
    });
  }
  if (escalated > 0) log.info({ escalated }, "sla sweeper escalated overdue tasks");
  return escalated;
}

/** Run the sweeper on an interval. Never throws out of the loop. */
export function startSlaSweeper(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepOverdueTasks().catch((err) => log.error({ err }, "sla sweep cycle failed"));
  }, intervalMs);
}
