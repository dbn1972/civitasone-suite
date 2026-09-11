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
import { markProcessed } from "../../shared/outbox.js";
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

  // Approve campaign — update status and leave an audit trail. In production
  // this would then publish the actual bulk-send command to
  // notification-service for the eligible contacts.
  queue.subscribe(COMMANDS.approveCampaign, async (msg) => {
    const p = msg.payload as { campaignId: string; contactIds: string[]; templateId: string; channel: string };
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
