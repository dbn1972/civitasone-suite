/**
 * AC-005 task-escalation scheduler.
 *
 * A worker-side interval (overlap-guarded like the AS-004 lead-escalation
 * scheduler) that every cycle finds open next-actions and open task-type
 * activities whose due date passed by more than the tenant's configured
 * threshold, and escalates each to the manager: a `crm.task.escalated` event
 * carrying ageing details + an audit entry, then stamps escalated_at so a task is
 * escalated exactly once per rule cycle.
 *
 * The overdue decision is the pure `findOverdueTasks` (unit tested); this file is
 * the DB plumbing. Cross-tenant discovery uses `crm.list_task_escalation_tenants()`
 * (SECURITY DEFINER) exactly like the lead-escalation scheduler.
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { findOverdueTasks, type TaskEscalationRuleLike, type OverdueTaskLike } from "./task-escalation-domain.js";

const log = pino({ name: "crm-task-escalation-scheduler" });
const AUDIT = "audit.event.record";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function listRules(tx: Tx, tenantId: string): Promise<TaskEscalationRuleLike[]> {
  const rows = (await tx.execute(sql`
    SELECT id, applies_to AS "appliesTo", threshold_minutes AS "thresholdMinutes", enabled,
           recipient_role AS "recipientRole", recipient_id AS "recipientId"
    FROM crm.task_escalation_rules
    WHERE tenant_id = ${tenantId} AND enabled = true
    ORDER BY threshold_minutes ASC
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    appliesTo: r.appliesTo as TaskEscalationRuleLike["appliesTo"],
    thresholdMinutes: Number(r.thresholdMinutes),
    enabled: r.enabled as boolean,
    recipientRole: (r.recipientRole ?? null) as string | null,
    recipientId: (r.recipientId ?? null) as string | null,
  }));
}

/** Open, not-yet-escalated next-actions + task-type activities as escalation candidates. */
async function overdueCandidates(tx: Tx, tenantId: string): Promise<OverdueTaskLike[]> {
  const nextActions = (await tx.execute(sql`
    SELECT id, subject_type AS "subjectType", subject_id AS "subjectId", due_at AS "dueAt"
    FROM crm.next_actions
    WHERE tenant_id = ${tenantId} AND completed_at IS NULL AND escalated_at IS NULL
  `)) as unknown as Array<Record<string, unknown>>;
  const tasks = (await tx.execute(sql`
    SELECT id, contact_id AS "contactId", deal_id AS "dealId", due_date AS "dueDate"
    FROM crm.activities
    WHERE tenant_id = ${tenantId} AND type = 'task' AND status = 'open'
      AND escalated_at IS NULL AND due_date IS NOT NULL
  `)) as unknown as Array<Record<string, unknown>>;

  const out: OverdueTaskLike[] = [];
  for (const r of nextActions) {
    out.push({
      taskId: r.id as string, kind: "next_action",
      subjectType: (r.subjectType ?? null) as string | null,
      subjectId: (r.subjectId ?? null) as string | null,
      ownerId: null,
      dueAt: (r.dueAt ?? null) as string | null,
    });
  }
  for (const r of tasks) {
    // due_date is a DATE — treat it as end-of-day UTC so a task is not "overdue" the
    // instant its date starts. Coarse by design; next-actions carry a precise timestamp.
    const dd = r.dueDate ? `${String(r.dueDate)}T23:59:59Z` : null;
    out.push({
      taskId: r.id as string, kind: "task",
      subjectType: r.contactId ? "contact" : r.dealId ? "deal" : null,
      subjectId: (r.contactId ?? r.dealId ?? null) as string | null,
      ownerId: null,
      dueAt: dd,
    });
  }
  return out;
}

/** Escalate all overdue tasks for one tenant. Returns how many were escalated. */
export async function runTenantTaskEscalation(tenantId: string, now: Date = new Date()): Promise<number> {
  return (await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      const rules = await listRules(tx, tenantId);
      if (rules.length === 0) return 0;

      const candidates = await overdueCandidates(tx, tenantId);
      const overdue = findOverdueTasks(candidates, rules, now);

      for (const t of overdue) {
        await enqueue(tx, {
          topic: EVENTS.taskEscalated, eventType: EVENTS.taskEscalated,
          tenantId, actorId: t.ownerId ?? tenantId, correlationId: randomUUID(),
          payload: {
            taskId: t.taskId, taskKind: t.kind, subjectType: t.subjectType, subjectId: t.subjectId,
            ruleId: t.ruleId, ageingMinutes: t.ageingMinutes, overdueMinutes: t.overdueMinutes,
            recipientRole: t.recipientRole, recipientId: t.recipientId,
          },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId, actorId: t.ownerId ?? tenantId, correlationId: randomUUID(),
          payload: {
            service: "crm", action: "task_escalated", resourceType: t.kind, resourceId: t.taskId, outcome: "success",
            metadata: { ageingMinutes: t.ageingMinutes, overdueMinutes: t.overdueMinutes, recipientRole: t.recipientRole, recipientId: t.recipientId },
          },
        });
        if (t.kind === "next_action") {
          await tx.execute(sql`UPDATE crm.next_actions SET escalated_at = now() WHERE id = ${t.taskId} AND tenant_id = ${tenantId}`);
        } else {
          await tx.execute(sql`UPDATE crm.activities SET escalated_at = now() WHERE id = ${t.taskId} AND tenant_id = ${tenantId}`);
        }
      }
      return overdue.length;
    }),
  )) as number;
}

/** One full cycle across every tenant with enabled task-escalation rules. */
export async function runTaskEscalationCycle(now: Date = new Date()): Promise<number> {
  const rows = (await sqlClient`SELECT tenant_id FROM crm.list_task_escalation_tenants()`) as unknown as Array<{ tenant_id: string }>;
  let total = 0;
  for (const r of rows) {
    try {
      total += await runTenantTaskEscalation(r.tenant_id, now);
    } catch (err) {
      log.error({ err, tenantId: r.tenant_id }, "tenant task escalation failed");
    }
  }
  return total;
}

/** Start the periodic scheduler, overlap-guarded like the lead-escalation one. */
export function startTaskEscalationScheduler(intervalMs = 60_000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    runTaskEscalationCycle()
      .then((n) => { if (n > 0) log.info({ escalated: n }, "task escalation cycle complete"); })
      .catch((err) => log.error({ err }, "task escalation cycle failed"))
      .finally(() => { running = false; });
  }, intervalMs);
}
