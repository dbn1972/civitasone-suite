/**
 * Gap 2 / TX-004 — Campaign approval consumers.
 *
 * Handles submit_for_approval, approve, and reject commands for bulk campaigns.
 *
 * Mirrors the established consumer convention (see quotation-approval-consumer.ts):
 * every write runs inside `db.transaction`, guarded by `markProcessed` so a
 * redelivered message is a no-op, and every state change leaves a domain +
 * audit event via `emitWithAudit` in the SAME transaction as the business row.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-campaign-approval-consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as Parameters<typeof emitWithAudit>[1];
}

export function registerCampaignApprovalConsumers(queue: Queue): void {
  // Submit for approval — the campaign row is already inserted at the route
  // level (bulk-send threshold check); this consumer's job is to leave the
  // audit trail for the submission and emit the domain event admins/
  // notification-service can react to. Idempotent on redelivery.
  queue.subscribe(COMMANDS.submitCampaignForApproval, async (msg) => {
    const p = msg.payload as { campaignId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.campaignSubmittedForApproval,
          action: "submit_for_approval",
          resourceType: "pending_campaign",
          resourceId: p.campaignId,
          payload: { campaignId: p.campaignId },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "submitCampaignForApproval failed");
      throw err;
    }
  });

  // Approve campaign — update status, leave an audit trail, and DISPATCH the
  // campaign by enqueueing the existing bulkSendCommunication command (consumed by
  // send-consumer.ts, which re-checks consent per contact and calls
  // notification-service). The enqueue is in the same transaction as the status
  // flip, so a campaign is dispatched exactly once: the flip is guarded by
  // status='pending' and the message by markProcessed.
  queue.subscribe(COMMANDS.approveCampaign, async (msg) => {
    const p = msg.payload as {
      campaignId: string; contactIds: string[]; templateId: string; channel: string;
      variables?: Record<string, string>; scheduledAt?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const updated = (await tx.execute(sql`
          UPDATE crm.pending_campaigns
          SET status = 'approved', approved_by = ${msg.actorId}, updated_at = now(), version = version + 1
          WHERE tenant_id = ${msg.tenantId} AND id = ${p.campaignId} AND status = 'pending'
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (updated.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.campaignApproved,
          action: "approve",
          resourceType: "pending_campaign",
          resourceId: p.campaignId,
          payload: {
            campaignId: p.campaignId,
            channel: p.channel,
            templateId: p.templateId,
            contactCount: p.contactIds?.length ?? 0,
          },
        });
        await enqueue(tx, {
          topic: COMMANDS.bulkSendCommunication,
          eventType: COMMANDS.bulkSendCommunication,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            id: p.campaignId,
            tenantId: msg.tenantId,
            contactIds: p.contactIds ?? [],
            templateId: p.templateId,
            channel: p.channel,
            variables: p.variables ?? {},
            scheduledAt: p.scheduledAt ?? null,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "approveCampaign failed");
      throw err;
    }
  });

  // Reject campaign — update status with reason and leave an audit trail.
  queue.subscribe(COMMANDS.rejectCampaign, async (msg) => {
    const p = msg.payload as { campaignId: string; reason: string | null };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const updated = (await tx.execute(sql`
          UPDATE crm.pending_campaigns
          SET status = 'rejected', rejected_by = ${msg.actorId}, rejection_reason = ${p.reason ?? null},
              updated_at = now(), version = version + 1
          WHERE tenant_id = ${msg.tenantId} AND id = ${p.campaignId} AND status = 'pending'
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (updated.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.campaignRejected,
          action: "reject",
          resourceType: "pending_campaign",
          resourceId: p.campaignId,
          payload: { campaignId: p.campaignId, reason: p.reason ?? null },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "rejectCampaign failed");
      throw err;
    }
  });
}
