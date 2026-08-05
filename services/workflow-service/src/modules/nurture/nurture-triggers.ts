/**
 * Gap 3 — Nurture trigger consumer.
 *
 * Subscribes to CRM events: crm.lead.score_recalculated, crm.lead.transitioned,
 * crm.activity.created. Evaluates configured nurture rules and publishes
 * notification.send commands when conditions are met.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";

interface NurtureRule {
  id: string;
  tenantId: string;
  triggerType: string;
  threshold: number;
  templateId: string;
  channel: string;
  enabled: boolean;
}

async function getRulesForTenant(tenantId: string, triggerType: string): Promise<NurtureRule[]> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", trigger_type AS "triggerType",
           threshold, template_id AS "templateId", channel, enabled
    FROM workflow.nurture_rules
    WHERE tenant_id = ${tenantId} AND trigger_type = ${triggerType} AND enabled = true
  `)) as unknown as NurtureRule[];
  return rows;
}

async function publishNurtureNotification(
  tenantId: string,
  contactId: string,
  rule: NurtureRule,
  correlationId: string,
): Promise<void> {
  await queue.publish("notification.send", {
    messageId: `nurture:${rule.id}:${contactId}:${Date.now()}`,
    type: "notification.send",
    tenantId,
    actorId: "system",
    correlationId,
    schemaVersion: "1.0",
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
    const { tenantId, payload, correlationId } = msg as {
      tenantId: string;
      correlationId: string;
      payload: { contactId: string; score: number };
    };
    const rules = await getRulesForTenant(tenantId, "score_below");
    for (const rule of rules) {
      if (payload.score < rule.threshold) {
        await publishNurtureNotification(tenantId, payload.contactId, rule, correlationId);
      }
    }
  });

  // Lead transitioned — check "stage_change" rules
  q.subscribe("crm.lead.transitioned", async (msg) => {
    const { tenantId, payload, correlationId } = msg as {
      tenantId: string;
      correlationId: string;
      payload: { contactId: string; fromStatus: string; toStatus: string };
    };
    const rules = await getRulesForTenant(tenantId, "stage_change");
    for (const rule of rules) {
      await publishNurtureNotification(tenantId, payload.contactId, rule, correlationId);
    }
  });

  // Activity created — check "inactive_days" rules (re-engagement on activity)
  q.subscribe("crm.activity.created", async (msg) => {
    const { tenantId, payload, correlationId } = msg as {
      tenantId: string;
      correlationId: string;
      payload: { contactId?: string };
    };
    if (!payload.contactId) return;
    // For inactive_days, the actual inactivity check would typically run on a
    // scheduled basis. This consumer handles the signal that an activity was
    // created, allowing immediate trigger evaluation.
    const rules = await getRulesForTenant(tenantId, "inactive_days");
    for (const rule of rules) {
      // In production, check the last activity date against threshold
      // For now, just evaluate and fire the notification
      await publishNurtureNotification(tenantId, payload.contactId, rule, correlationId);
    }
  });
}
