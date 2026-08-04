/**
 * Escalation scheduler (AS-004).
 *
 * A worker-side `setInterval` (guarded against overlap, like the outbox relay)
 * that every cycle finds leads assigned but not accepted (`unaccepted`) or not
 * touched since their last activity (`unattended`) past the tenant's configured
 * threshold, and escalates them: a `crm.lead.escalated` event carrying ageing
 * details to the configured recipient, an audit entry, and an optional reassign.
 *
 * The overdue decision is the pure `findOverdue` from escalation-domain (unit
 * tested); this file is only the DB plumbing around it.
 *
 * Cross-tenant discovery: escalation_rules is FORCE-RLS, so a background job
 * running as the (non-superuser) service role sees nothing without a tenant GUC.
 * `crm.list_escalation_tenants()` is SECURITY DEFINER (owned by the superuser that
 * ran the migration) so it can enumerate the tenants that have enabled rules;
 * each tenant's data is then read under its own RLS scope via `runWithTenant`.
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { findOverdue } from "./escalation-domain.js";
import * as repo from "./repo.js";

const log = pino({ name: "crm-escalation-scheduler" });
const AUDIT = "audit.event.record";

/** Escalate all overdue leads for one tenant. Returns how many were escalated. */
export async function runTenantEscalation(tenantId: string, now: Date = new Date()): Promise<number> {
  return (await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      const rules = await repo.listEscalationRules(tx, tenantId);
      if (rules.length === 0) return 0;

      const leads = await repo.overdueCandidates(tx, tenantId);
      const overdue = findOverdue(leads, rules, now);

      for (const od of overdue) {
        // The escalation notice — carries the ageing details to the recipient.
        await enqueue(tx, {
          topic: EVENTS.leadEscalated,
          eventType: EVENTS.leadEscalated,
          tenantId,
          actorId: od.ownerId ?? tenantId,
          correlationId: randomUUID(),
          payload: {
            leadId: od.leadId,
            ownerId: od.ownerId,
            ruleId: od.ruleId,
            trigger: od.trigger,
            ageingMinutes: od.ageingMinutes,
            overdueMinutes: od.overdueMinutes,
            recipientRole: od.recipientRole,
            recipientId: od.recipientId,
          },
        });
        await enqueue(tx, {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId,
          actorId: od.ownerId ?? tenantId,
          correlationId: randomUUID(),
          payload: {
            service: "crm",
            action: "lead_escalated",
            resourceType: "contact",
            resourceId: od.leadId,
            outcome: "success",
            metadata: {
              trigger: od.trigger,
              ageingMinutes: od.ageingMinutes,
              overdueMinutes: od.overdueMinutes,
              recipientRole: od.recipientRole,
              recipientId: od.recipientId,
            },
          },
        });

        // Optional reassign to a dedicated owner. applyOwner clears escalated_at
        // and resets assigned_at, so the new owner starts a fresh acceptance
        // clock; otherwise we set escalated_at so the lead is not re-escalated
        // every cycle.
        let reassigned = false;
        if (od.reassign) {
          const newOwner = await repo.reassignOwnerFor(tx, tenantId, od.ruleId);
          if (newOwner) {
            await repo.applyOwner(tx, tenantId, od.leadId, newOwner, od.ownerId ?? newOwner);
            await repo.insertAssignmentLog(tx, {
              tenantId, leadId: od.leadId, ownerId: newOwner,
              ruleId: null, method: "auto", assignedBy: od.ownerId ?? newOwner,
            });
            reassigned = true;
          }
        }
        if (!reassigned) {
          await repo.markEscalated(tx, tenantId, od.leadId);
        }
      }
      return overdue.length;
    }),
  )) as number;
}

/** One full cycle across every tenant with enabled escalation rules. */
export async function runEscalationCycle(now: Date = new Date()): Promise<number> {
  const rows = (await sqlClient`SELECT tenant_id FROM crm.list_escalation_tenants()`) as unknown as Array<{ tenant_id: string }>;
  let total = 0;
  for (const r of rows) {
    try {
      total += await runTenantEscalation(r.tenant_id, now);
    } catch (err) {
      log.error({ err, tenantId: r.tenant_id }, "tenant escalation failed");
    }
  }
  return total;
}

/**
 * Start the periodic scheduler. Overlap-guarded like startRelay: a slow cycle
 * never stacks a second concurrent scan.
 */
export function startEscalationScheduler(intervalMs = 60_000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    runEscalationCycle()
      .then((n) => { if (n > 0) log.info({ escalated: n }, "escalation cycle complete"); })
      .catch((err) => log.error({ err }, "escalation cycle failed"))
      .finally(() => { running = false; });
  }, intervalMs);
}
