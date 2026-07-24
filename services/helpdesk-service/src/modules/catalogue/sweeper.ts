/**
 * Service Catalogue (SVC-129) — SLA-breach escalation sweeper.
 *
 * Mirrors tickets/sweeper.ts. For each open service request whose resolution
 * deadline has passed and which has NOT yet been escalated, claim a one-shot
 * marker (CAS via markBreachEscalated) and, under the same tx, enqueue:
 *   1. a request breach-escalation event (helpdesk.request.breach_escalated),
 *   2. a notification.send (canonical notification topic),
 *   3. an audit.event.record,
 * all under one correlationId. The marker makes it fire exactly once, so
 * re-running the sweeper (restart-safe) never double-escalates.
 *
 * Returns the number of requests escalated this sweep.
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "helpdesk-catalogue-breach-sweeper" });

const AUDIT_TOPIC = "audit.event.record";
const ESCALATION_TOPIC = EVENTS.requestBreachEscalated;

// System actor for automated escalations (nil-prefixed UUID), distinct from the
// requester, so system action is distinguishable in the audit trail.
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000c9";

export async function sweepRequestBreaches(now: Date = new Date(), batch = 200): Promise<number> {
  const candidates = await repo.findOverdueOpenRequests(now, batch);
  let escalated = 0;

  const byTenant = new Map<string, typeof candidates>();
  for (const r of candidates) {
    const group = byTenant.get(r.tenantId) ?? [];
    group.push(r);
    byTenant.set(r.tenantId, group);
  }

  for (const [tenantId, reqs] of byTenant) {
    // Cross-tenant candidate scan (findOverdueOpenRequests), but per-tenant writes
    // must run with that tenant's GUC — establish it via runWithTenant().
    await runWithTenant(tenantId, async () => {
      for (const r of reqs) {
        const recipient = r.requestedBy;
        await db.transaction(async (txRaw) => {
          const tx = txRaw as unknown as repo.Writer;
          const claimed = await repo.markBreachEscalated(tx, r.id, r.tenantId, now);
          if (!claimed) return; // another sweep/run already escalated this request

          const correlationId = randomUUID();
          const t2 = txRaw as Parameters<typeof enqueue>[0];

          await enqueue(t2, {
            topic: ESCALATION_TOPIC,
            eventType: ESCALATION_TOPIC,
            tenantId: r.tenantId,
            actorId: SYSTEM_ACTOR_ID,
            correlationId,
            payload: {
              requestId: r.id,
              ticketId: r.ticketId,
              offeringId: r.offeringId,
              recipient,
              resolutionDeadline: r.resolutionDeadline,
            },
          });

          await enqueue(t2, {
            topic: NOTIFICATION_SEND,
            eventType: NOTIFICATION_SEND,
            tenantId: r.tenantId,
            actorId: SYSTEM_ACTOR_ID,
            correlationId,
            payload: buildNotificationPayload({
              eventType: ESCALATION_TOPIC,
              recipient,
              variables: {
                requestId: r.id,
                summary: `Service request SLA breached — overdue for fulfilment`,
                link: `/helpdesk/catalogue/my-requests`,
              },
            }),
          });

          await enqueue(t2, {
            topic: AUDIT_TOPIC,
            eventType: AUDIT_TOPIC,
            tenantId: r.tenantId,
            actorId: SYSTEM_ACTOR_ID,
            correlationId,
            payload: {
              service: "helpdesk",
              action: "request_sla_breach",
              resourceType: "service_request",
              resourceId: r.id,
              outcome: "success",
            },
          });

          escalated++;
        });
      }
    });
  }

  if (escalated > 0) log.info({ escalated }, "helpdesk catalogue breach sweeper escalated overdue requests");
  return escalated;
}

/** Run the breach sweeper on an interval. Never throws out of the loop. */
export function startRequestBreachSweeper(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepRequestBreaches().catch((err) => log.error({ err }, "catalogue breach sweep cycle failed"));
  }, intervalMs);
}
