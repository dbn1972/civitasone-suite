/**
 * Gap 2 — Campaign approval consumers.
 *
 * Handles submit_for_approval, approve, and reject commands for bulk campaigns.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { COMMANDS } from "../../topics.js";
import { scopedRead } from "../../shared/db.js";

export function registerCampaignApprovalConsumers(queue: Queue): void {
  // Submit for approval — records are already written at the route level
  // This consumer could trigger notification to admins
  queue.subscribe(COMMANDS.submitCampaignForApproval, async (msg) => {
    const { tenantId, payload } = msg as {
      tenantId: string;
      payload: { campaignId: string };
    };
    // Campaign already inserted at route level. This consumer
    // can optionally notify admins of a pending campaign.
    // No-op for now — the row is already persisted.
  });

  // Approve campaign — update status and trigger bulk send
  queue.subscribe(COMMANDS.approveCampaign, async (msg) => {
    const { tenantId, payload } = msg as {
      tenantId: string;
      payload: { campaignId: string; contactIds: string[]; templateId: string; channel: string };
    };
    await scopedRead(async (tx) => {
      await tx.execute(sql`
        UPDATE crm.pending_campaigns
        SET status = 'approved', updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${payload.campaignId} AND status = 'pending'
      `);
    });
    // In production, this would then publish the actual bulk-send command
    // to notification-service for the eligible contacts.
  });

  // Reject campaign — update status with reason
  queue.subscribe(COMMANDS.rejectCampaign, async (msg) => {
    const { tenantId, payload } = msg as {
      tenantId: string;
      payload: { campaignId: string; reason: string | null };
    };
    await scopedRead(async (tx) => {
      await tx.execute(sql`
        UPDATE crm.pending_campaigns
        SET status = 'rejected', rejection_reason = ${payload.reason ?? null}, updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${payload.campaignId} AND status = 'pending'
      `);
    });
  });
}
