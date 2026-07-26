import { pino } from "pino";
import { and, eq, lte, gt, isNotNull, or, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
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
 * RLS (#146): workflow_svc is NOBYPASSRLS and every workflow table is
 * fail-closed, so a GUC-less cross-tenant scan sees ZERO rows. The sweepers
 * therefore enumerate the tenants that currently have pending tasks via the
 * SECURITY DEFINER helper `workflow.sweep_task_tenants()` (migration 0029 —
 * discloses tenant ids only, never row data) and run each tenant's sweep
 * inside runWithTenant(tenantId, ...) so every read AND write is scoped to
 * exactly that tenant. Never wrap the whole sweep in a single tenant.
 */
async function sweepTaskTenants(): Promise<string[]> {
  const rows = (await db.execute(
    sql`SELECT workflow.sweep_task_tenants() AS tenant_id`,
  )) as unknown as Array<{ tenant_id: string }>;
  return rows.map((r) => r.tenant_id);
}

/** Run `perTenant` once per tenant with pending tasks, summing the counts. */
async function forEachTaskTenant(perTenant: () => Promise<number>): Promise<number> {
  let total = 0;
  for (const tenantId of await sweepTaskTenants()) {
    total += await runWithTenant(tenantId, perTenant);
  }
  return total;
}

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
  return forEachTaskTenant(() => sweepOverdueTasksForTenant(now, batch, cooldownMs));
}

/** Per-tenant SLA escalation sweep — MUST run inside runWithTenant(tenantId). */
async function sweepOverdueTasksForTenant(
  now: Date,
  batch: number,
  cooldownMs: number,
): Promise<number> {
  const cooldownCutoff = new Date(now.getTime() - cooldownMs);
  const due = await scopedRead((tx) => tx.select().from(tasks)
    .where(and(
      eq(tasks.status, "pending"),
      isNotNull(tasks.dueAt),
      lte(tasks.dueAt, now),
      or(isNull(tasks.escalatedAt), lte(tasks.escalatedAt, cooldownCutoff)),
    ))
    .limit(batch));

  let escalated = 0;
  for (const t of due) {
    // resolve a real recipient: the instance owner (a user UUID), else the
    // task's role ref (role-resolved owner), else the instance id as last resort.
    let ownerId: string | null = null;
    const inst = await scopedRead((tx) => tx.select({ createdBy: instances.createdBy }).from(instances)
      .where(eq(instances.id, t.instanceId)).limit(1));
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
// Gap 5 — Pre-breach SLA reminders. DISTINCT from escalation: at configurable
// elapsed-fraction thresholds (default 50% & 80% of the SLA window) we emit a
// reminder notification, WITHOUT touching escalation_count. reminder_count
// tracks how many thresholds have already fired so a threshold never re-sends.
// ---------------------------------------------------------------------------
const reminderLog = pino({ name: "workflow-reminder-sweeper" });
const REMINDER_TOPIC = "workflow.task.reminder";

/** Parse REMINDER_THRESHOLDS (CSV of fractions, e.g. "0.5,0.8"). */
function reminderThresholds(): number[] {
  const raw = process.env.REMINDER_THRESHOLDS ?? "0.5,0.8";
  const xs = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0 && n < 1);
  return xs.length ? xs.sort((a, b) => a - b) : [0.5, 0.8];
}

/**
 * For each pending task that is NOT yet overdue but has crossed a reminder
 * threshold it hasn't been reminded for, emit a reminder notification + event
 * and bump reminder_count (NOT escalation_count). Returns the number of
 * reminders emitted this sweep.
 *
 * A threshold k (k = reminder_count+1) has fired when the elapsed fraction
 * (now - created_at)/(due_at - created_at) >= thresholds[k-1]. We only send one
 * reminder per sweep per task (the next unsent threshold), so reminders are
 * paced and never double-sent for the same threshold.
 */
export async function sweepReminders(now: Date = new Date(), batch = 200): Promise<number> {
  return forEachTaskTenant(() => sweepRemindersForTenant(now, batch));
}

/** Per-tenant reminder sweep — MUST run inside runWithTenant(tenantId). */
async function sweepRemindersForTenant(now: Date, batch: number): Promise<number> {
  const thresholds = reminderThresholds();
  // candidate tasks: pending, have an SLA (due_at), NOT yet overdue, and still
  // have an un-fired threshold (reminder_count < thresholds.length).
  const due = await scopedRead((tx) => tx.select().from(tasks)
    .where(and(
      eq(tasks.status, "pending"),
      eq(tasks.isCall, false),
      isNotNull(tasks.dueAt),
      gt(tasks.dueAt, now),                                  // not yet breached
      lte(tasks.reminderCount, sql`${thresholds.length - 1}`),
    ))
    .limit(batch));

  let sent = 0;
  for (const t of due) {
    if (!t.dueAt) continue;
    const created = t.createdAt?.getTime() ?? t.dueAt.getTime();
    const span = t.dueAt.getTime() - created;
    if (span <= 0) continue;
    const elapsed = (now.getTime() - created) / span;
    const nextIdx = t.reminderCount; // 0-based index of the next un-fired threshold
    if (nextIdx >= thresholds.length) continue;
    const threshold = thresholds[nextIdx]!;
    if (elapsed < threshold) continue; // not yet at the next threshold

    // resolve recipient (instance owner, else role, else instance id).
    const inst = await scopedRead((tx) => tx.select({ createdBy: instances.createdBy }).from(instances)
      .where(eq(instances.id, t.instanceId)).limit(1));
    const recipient = inst[0]?.createdBy ?? t.roleRef ?? t.instanceId;

    await db.transaction(async (tx) => {
      // CAS on reminder_count so overlapping sweeps don't double-send a threshold.
      const res = await tx.update(tasks)
        .set({ reminderCount: nextIdx + 1, lastReminderAt: now, updatedAt: now })
        .where(and(eq(tasks.id, t.id), eq(tasks.status, "pending"), eq(tasks.reminderCount, nextIdx)))
        .returning({ id: tasks.id });
      if (res.length === 0) return;

      await historyRepo.record(tx, {
        tenantId: t.tenantId, instanceId: t.instanceId, taskId: t.id,
        fromNode: t.nodeKey, toNode: t.nodeKey, action: "reminder", decision: null,
        actorId: SYSTEM_ACTOR_ID,
        detail: { thresholdPct: Math.round(threshold * 100), reminderCount: nextIdx + 1, recipient, dueAt: t.dueAt?.toISOString() ?? null },
      });

      const t2 = tx as Parameters<typeof enqueue>[0];
      const correlationId = randomUUID();
      await enqueue(t2, {
        topic: REMINDER_TOPIC, eventType: REMINDER_TOPIC,
        tenantId: t.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId,
        payload: { taskId: t.id, instanceId: t.instanceId, name: t.name, roleRef: t.roleRef, recipient, thresholdPct: Math.round(threshold * 100), dueAt: t.dueAt?.toISOString() ?? null },
      });
      await enqueue(t2, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: t.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId,
        payload: buildNotificationPayload({
          eventType: REMINDER_TOPIC,
          recipient,
          variables: {
            taskId: t.id,
            instanceId: t.instanceId,
            thresholdPct: String(Math.round(threshold * 100)),
            summary: `Reminder — task ${Math.round(threshold * 100)}% through its SLA: ${t.name}`,
            link: `/workflow/tasks/${t.id}`,
          },
        }),
      });
      await enqueue(t2, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: t.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId,
        payload: { service: "workflow", action: "reminder", resourceType: "task", resourceId: t.id, outcome: "success" },
      });
      sent++;
    });
  }
  if (sent > 0) reminderLog.info({ sent }, "reminder sweeper emitted pre-breach reminders");
  return sent;
}

/** Run the reminder sweeper on an interval. Never throws out of the loop. */
export function startReminderSweeper(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepReminders().catch((err) => reminderLog.error({ err }, "reminder sweep cycle failed"));
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
  return forEachTaskTenant(() => sweepTimerTasksForTenant(now, batch));
}

/** Per-tenant timer sweep — MUST run inside runWithTenant(tenantId). */
async function sweepTimerTasksForTenant(now: Date, batch: number): Promise<number> {
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
