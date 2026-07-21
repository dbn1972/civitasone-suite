import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { SlaPolicy } from "../sla/domain.js";

const log = pino({ name: "helpdesk-sla-sweeper" });

const AUDIT_TOPIC = "audit.event.record";
const ESCALATION_TOPIC = EVENTS.ticketEscalated;

// SLA escalations are attributed to a fixed service/system actor (nil-prefixed
// UUID), NOT the ticket creator — keeps system action distinguishable in audit.
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000d1";

/**
 * HD1 — SLA-breach sweeper. Mirrors workflow-service tasks/sweeper.ts.
 *
 * For each still-open ticket whose computed SLA status has reached `at_risk` or
 * `breached` and which has NOT yet been notified for that stage, claim a
 * one-shot marker column (CAS) and, under the same tx, enqueue:
 *   1. an escalation event (helpdesk.ticket.escalated),
 *   2. a notification.send (the canonical notification topic),
 *   3. an audit.event.record,
 * all under one correlationId. The marker makes it fire exactly once per stage,
 * so re-running the sweeper (restart-safe) never double-notifies.
 *
 * Uses per-tenant SLA policies for deadline computation (at-risk at 80% of
 * resolution deadline). Falls back to default policies if none configured.
 *
 * Returns the number of (ticket, stage) notifications emitted this sweep.
 */
export async function sweepSlaBreaches(now: Date = new Date(), batch = 200): Promise<number> {
  const candidates = await repo.findOpenForSla(batch);
  let notified = 0;

  // Group candidates by tenant so we load policies once per tenant
  const byTenant = new Map<string, typeof candidates>();
  for (const t of candidates) {
    const group = byTenant.get(t.tenantId) ?? [];
    group.push(t);
    byTenant.set(t.tenantId, group);
  }

  for (const [tenantId, tenantTickets] of byTenant) {
    // RLS fix: this sweeper polls candidates across ALL tenants (intentional,
    // see repo.findOpenForSla), but the per-tenant claim/enqueue writes below
    // ARE tenant-scoped and must run with that tenant's GUC set. db.transaction()
    // only picks up app.tenant_id from AsyncLocalStorage (wrapWithTenantGuc), so
    // establish the tenant context for this tenant's batch via runWithTenant().
    await runWithTenant(tenantId, async () => {
      const policies = await repo.getEffectivePolicies(tenantId);

      for (const t of tenantTickets) {
        const { slaStatus } = repo.computeSla(t, now, policies);
        if (slaStatus === "within_sla") continue;

        // breached supersedes at_risk: if breached, only fire the breach stage
        // (if not already sent); else fire at_risk.
        const stage: "at_risk" | "breached" = slaStatus === "breached" ? "breached" : "at_risk";
        const alreadySent = stage === "breached" ? t.slaBreachedNotifiedAt : t.slaAtRiskNotifiedAt;
        if (alreadySent) continue;

        // recipient: the assignee where set, else the creator (a real user UUID).
        const recipient = t.assigneeId ?? t.createdBy;

        await db.transaction(async (tx) => {
          const claimed = await repo.markSlaNotified(tx as repo.Writer, t.id, t.tenantId, stage, now);
          if (!claimed) return; // another sweep/run already notified this stage

          const correlationId = randomUUID();
          const tx2 = tx as Parameters<typeof enqueue>[0];

          await enqueue(tx2, {
            topic: ESCALATION_TOPIC, eventType: ESCALATION_TOPIC,
            tenantId: t.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId,
            payload: {
              ticketId: t.id, subject: t.subject, priority: t.priority,
              slaStatus: stage, recipient,
            },
          });

          await enqueue(tx2, {
            topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
            tenantId: t.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId,
            payload: buildNotificationPayload({
              eventType: ESCALATION_TOPIC,
              recipient,
              variables: {
                ticketId: t.id,
                slaStatus: stage,
                summary: stage === "breached"
                  ? `SLA breached — ticket overdue: ${t.subject}`
                  : `SLA at risk — ticket due soon: ${t.subject}`,
                link: `/helpdesk/tickets/${t.id}`,
              },
            }),
          });

          await enqueue(tx2, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: t.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId,
            payload: {
              service: "helpdesk", action: stage === "breached" ? "sla_breach" : "sla_at_risk",
              resourceType: "ticket", resourceId: t.id, outcome: "success",
            },
          });

          notified++;
        });
      }
    });
  }

  if (notified > 0) log.info({ notified }, "helpdesk sla sweeper emitted breach/at-risk notifications");
  return notified;
}

/** Run the SLA sweeper on an interval. Never throws out of the loop. */
export function startSlaSweeper(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepSlaBreaches().catch((err) => log.error({ err }, "helpdesk sla sweep cycle failed"));
  }, intervalMs);
}
