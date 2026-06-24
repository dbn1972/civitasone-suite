import { pino } from "pino";
import { and, eq, lte, isNotNull, or, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tasks } from "./schema.js";
import { instances } from "../instances/schema.js";
import * as repo from "./repo.js";
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

// ---------------------------------------------------------------------------
// P1-2 — Timer / wait nodes (deemed approval).
// ---------------------------------------------------------------------------

const timerLog = pino({ name: "workflow-timer-sweeper" });

/**
 * Find pending timer tasks whose fire_at has passed and auto-advance each by
 * publishing a normal completeTask(approve) command attributed to the SYSTEM
 * actor with sodOverride. Reusing completeTask means the instance advances
 * along the timer node's outgoing edge through the same engine path (edge
 * conditions, join gating, domain dispatch) as a human approval — "deemed
 * approved if not acted within N". The instance-active gate in the consumer
 * still applies, so a timer task on a suspended instance is left alone.
 *
 * Idempotency: we stamp fire_at = NULL under the row lock before publishing so
 * overlapping sweeps don't double-fire; the completeTask optimistic lock is the
 * final backstop. Returns the number of timer tasks fired this sweep.
 */
export async function sweepTimerTasks(now: Date = new Date(), batch = 200): Promise<number> {
  const due = await repo.dueTimers(now, batch);
  let fired = 0;
  for (const t of due) {
    // claim this timer under a row lock: clear fire_at only if still pending &
    // still due, so a concurrent sweep can't also pick it up.
    const claimed = await db.transaction(async (tx) => {
      const res = await tx.update(tasks)
        .set({ fireAt: null, updatedAt: now })
        .where(and(
          eq(tasks.id, t.id),
          eq(tasks.status, "pending"),
          isNotNull(tasks.fireAt),
          lte(tasks.fireAt, now),
        ))
        .returning({ id: tasks.id });
      if (res.length === 0) return false;
      await historyRepo.record(tx, {
        tenantId: t.tenantId, instanceId: t.instanceId, taskId: t.id,
        fromNode: t.nodeKey, toNode: t.nodeKey, action: "timer_fire", decision: "approve",
        actorId: SYSTEM_ACTOR_ID,
        detail: { reason: "deemed_approval", fireAt: t.fireAt?.toISOString() ?? null },
      });
      return true;
    });
    if (!claimed) continue;

    // publish completeTask(approve) as the system actor. The payload mirrors the
    // TaskView the HTTP path sends; sodOverride lets the system bypass SoD.
    await queue.publish(COMMANDS.completeTask, {
      messageId: randomUUID(),
      type: COMMANDS.completeTask,
      tenantId: t.tenantId,
      actorId: SYSTEM_ACTOR_ID,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        id: t.id,
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        name: t.name,
        status: "pending",
        roleRef: t.roleRef,
        nodeKey: t.nodeKey,
        refType: t.refType,
        refId: t.refId,
        decision: "approve",
        sodOverride: true,
      },
    });
    fired++;
  }
  if (fired > 0) timerLog.info({ fired }, "timer sweeper auto-advanced timer tasks");
  return fired;
}

/** Run the timer sweeper on an interval. Never throws out of the loop. */
export function startTimerSweeper(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepTimerTasks().catch((err) => timerLog.error({ err }, "timer sweep cycle failed"));
  }, intervalMs);
}
