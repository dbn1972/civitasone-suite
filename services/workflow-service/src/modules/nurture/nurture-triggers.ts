/**
 * Gap 3 — Nurture trigger consumer.
 *
 * Subscribes to CRM events: crm.lead.score_recalculated, crm.lead.transitioned,
 * crm.activity.created. Evaluates configured nurture rules and publishes
 * notification.send commands when conditions are met.
 *
 * TX-005: this consumer used to publish notification.send directly
 * (`queue.publish`) with no redelivery guard, so a redelivered CRM event
 * (e.g. after a crash/retry — same messageId's *effects* reapplied, since
 * queue redelivery is a transport-level retry, not a new decision) fired the
 * same nurture notification again. Fixed to match this codebase's standard
 * consumer shape: `markProcessed` (inbox dedup, keyed by the message's own
 * messageId) gates a DB transaction, and the actual send is queued via the
 * transactional outbox `enqueue` (see sla/consumer.ts, audit-service's
 * observation/consumer.ts) instead of a direct `queue.publish` — so a
 * redelivery short-circuits before any notification is enqueued a second
 * time, and enqueue-then-relay keeps "rule matched" and "notification will
 * be sent" atomic with the message being marked processed.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

// Enqueue actor for system-initiated notifications — matches the
// SYSTEM_ACTOR convention used across the codebase for outbox rows with
// no human actor (e.g. admin-service/config/repo.ts, audit-service/
// compliance/jobs.ts). outbox.messages.actor_id is uuid NOT NULL, so the
// literal string "system" (the old queue.publish envelope value, which
// never hit a typed column) cannot be reused here.
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

interface NurtureRule {
  id: string;
  tenantId: string;
  triggerType: string;
  threshold: number;
  templateId: string;
  channel: string;
  enabled: boolean;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getRulesForTenant(tenantId: string, triggerType: string): Promise<NurtureRule[]> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", trigger_type AS "triggerType",
           threshold, template_id AS "templateId", channel, enabled
    FROM workflow.nurture_rules
    WHERE tenant_id = ${tenantId} AND trigger_type = ${triggerType} AND enabled = true
  `)) as unknown as NurtureRule[];
  return rows;
}

async function enqueueNurtureNotification(
  tx: Tx,
  tenantId: string,
  contactId: string,
  rule: NurtureRule,
  correlationId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "notification.send",
    eventType: "notification.send",
    tenantId,
    actorId: SYSTEM_ACTOR,
    correlationId,
    payload: {
      recipientId: contactId,
      channel: rule.channel,
      templateId: rule.templateId,
      source: "nurture_workflow",
      ruleId: rule.id,
    },
  });
}

export function registerNurtureConsumers(q: Queue): void {
  // Lead score recalculated — check "score_below" rules
  q.subscribe("crm.lead.score_recalculated", async (msg) => {
    const { messageId, tenantId, payload, correlationId } = msg as {
      messageId: string;
      tenantId: string;
      correlationId: string;
      payload: { contactId: string; score: number };
    };
    const rules = await getRulesForTenant(tenantId, "score_below");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, messageId))) return;
      for (const rule of rules) {
        if (payload.score < rule.threshold) {
          await enqueueNurtureNotification(tx, tenantId, payload.contactId, rule, correlationId);
        }
      }
    });
  });

  // Lead transitioned — check "stage_change" rules
  q.subscribe("crm.lead.transitioned", async (msg) => {
    const { messageId, tenantId, payload, correlationId } = msg as {
      messageId: string;
      tenantId: string;
      correlationId: string;
      payload: { contactId: string; fromStatus: string; toStatus: string };
    };
    const rules = await getRulesForTenant(tenantId, "stage_change");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, messageId))) return;
      for (const rule of rules) {
        await enqueueNurtureNotification(tx, tenantId, payload.contactId, rule, correlationId);
      }
    });
  });

  // Activity created — check "inactive_days" rules (re-engagement on activity)
  q.subscribe("crm.activity.created", async (msg) => {
    const { messageId, tenantId, payload, correlationId } = msg as {
      messageId: string;
      tenantId: string;
      correlationId: string;
      payload: { contactId?: string };
    };
    if (!payload.contactId) return;
    // For inactive_days, the actual inactivity check would typically run on a
    // scheduled basis. This consumer handles the signal that an activity was
    // created, allowing immediate trigger evaluation.
    const rules = await getRulesForTenant(tenantId, "inactive_days");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, messageId))) return;
      for (const rule of rules) {
        // In production, check the last activity date against threshold
        // For now, just evaluate and fire the notification
        await enqueueNurtureNotification(tx, tenantId, payload.contactId as string, rule, correlationId);
      }
    });
  });
}
