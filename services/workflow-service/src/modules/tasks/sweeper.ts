import { pino } from "pino";
import { and, eq, lte, isNotNull, or, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { tasks } from "./schema.js";
import { instances } from "../instances/schema.js";
import * as historyRepo from "../history/repo.js";

const log = pino({ name: "workflow-sla-sweeper" });
const AUDIT_TOPIC = "audit.event.record";
const ESCALATION_TOPIC = "workflow.task.escalated";

// M2 — escalations are attributed to an explicit service/system actor (a fixed
// nil-prefixed UUID), NOT the task creator. This keeps escalation audit/history
// distinguishable from human action and avoids implying the submitter acted.
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000a1";

// Re-escalate a still-overdue task once it has not been escalated within the
// cooldown window. escalated_at doubles as last_escalated_at.
const DEFAULT_COOLDOWN_MS = Number(process.env.SLA_ESCALATION_COOLDOWN_MS ?? 60 * 60 * 1000);

/**
 * Find open tasks whose due_at has passed and which are due for (re)escalation —
 * either never escalated, or last escalated before now - cooldown — then escalate
 * each: stamp escalated_at = now (last-escalated), bump escalation_count, append
 * a transition_history row, and emit a notification + escalation event. The
 * notification recipient is resolved to a real owner/assignee where possible.
 * Returns the number of tasks escalated this sweep.
 */
export async function sweepOverdueTasks(
  now: Date = new Date(),
  batch = 200,
  cooldownMs = DEFAULT_COOLDOWN_MS,
): Promise<number> {
  const cooldownCutoff = new Date(now.getTime() - cooldownMs);
  const due = await db.select().from(tasks)
    .where(and(
      eq(tasks.status, "pending"),
      isNotNull(tasks.dueAt),
      lte(tasks.dueAt, now),
      or(isNull(tasks.escalatedAt), lte(tasks.escalatedAt, cooldownCutoff)),
    ))
    .limit(batch);

  let escalated = 0;
  for (const t of due) {
    // resolve a real recipient: the instance owner (a user UUID), else the
    // task's role ref (role-resolved owner), else the instance id as last resort.
    let ownerId: string | null = null;
    const inst = await db.select({ createdBy: instances.createdBy }).from(instances)
      .where(eq(instances.id, t.instanceId)).limit(1);
    ownerId = inst[0]?.createdBy ?? null;
    const recipient = ownerId ?? t.roleRef ?? t.instanceId;

    await db.transaction(async (tx) => {
      // re-check the cooldown under the row to avoid double escalation across
      // overlapping sweeps; only escalate if still due (null or past cooldown).
      const res = await tx.update(tasks)
        .set({ escalatedAt: now, escalationCount: sql`${tasks.escalationCount} + 1`, updatedAt: now })
        .where(and(
          eq(tasks.id, t.id),
          eq(tasks.status, "pending"),
          or(isNull(tasks.escalatedAt), lte(tasks.escalatedAt, cooldownCutoff)),
        ))
        .returning({ id: tasks.id, escalationCount: tasks.escalationCount });
      if (res.length === 0) return; // someone else escalated it within the window
      const count = res[0]!.escalationCount;

      await historyRepo.record(tx, {
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        taskId: t.id,
        fromNode: t.nodeKey,
        toNode: t.nodeKey,
        action: "escalate",
        decision: null,
        actorId: SYSTEM_ACTOR_ID,
        detail: {
          reason: "sla_breach",
          dueAt: t.dueAt?.toISOString() ?? null,
          escalationCount: count,
          recipient,
        },
      });

      const t2 = tx as Parameters<typeof enqueue>[0];
      const correlationId = randomUUID();
      await enqueue(t2, {
        topic: ESCALATION_TOPIC, eventType: ESCALATION_TOPIC,
        tenantId: t.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId,
        payload: { taskId: t.id, instanceId: t.instanceId, name: t.name, roleRef: t.roleRef, recipient, escalationCount: count, dueAt: t.dueAt?.toISOString() ?? null },
      });
      await enqueue(t2, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: t.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId,
        payload: buildNotificationPayload({
          eventType: ESCALATION_TOPIC,
          recipient,
          variables: {
            taskId: t.id,
            instanceId: t.instanceId,
            escalationCount: String(count),
            summary: `SLA breached — task overdue: ${t.name}`,
            link: `/workflow/tasks/${t.id}`,
          },
        }),
      });
      await enqueue(t2, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: t.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId,
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
