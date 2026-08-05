/**
 * Gap 2 — Approval workflow on bulk campaigns.
 *
 * When bulk-send exceeds a tenant-configurable threshold (default 50),
 * the campaign goes to pending_approval state instead of sending immediately.
 * Admins can then approve or reject the campaign.
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand } from "../../shared/residual-publish.js";
import { campaignIdParam, rejectCampaignBody } from "./campaign-approval-validators.js";

const ADMIN_ROLES = ["crm_admin", "super_admin"];

const APPROVAL_THRESHOLD = Number(process.env.CAMPAIGN_APPROVAL_THRESHOLD ?? 50);

interface PendingCampaignRow {
  id: string;
  status: string;
  tenantId: string;
  channel: string;
  templateId: string;
  contactIds: string[];
  variables: Record<string, string>;
  scheduledAt: string | null;
}

async function getPendingCampaign(tenantId: string, id: string): Promise<PendingCampaignRow | null> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT id, status, tenant_id AS "tenantId", channel, template_id AS "templateId",
           contact_ids AS "contactIds", variables, scheduled_at AS "scheduledAt"
    FROM crm.pending_campaigns
    WHERE tenant_id = ${tenantId} AND id = ${id}
    LIMIT 1
  `)) as unknown as PendingCampaignRow[];
  return rows[0] ?? null;
}

/**
 * Returns the approval threshold for the tenant.
 * Could be extended to read from a tenant_settings table.
 */
export function getApprovalThreshold(): number {
  return APPROVAL_THRESHOLD;
}

export async function campaignApprovalRoutes(app: FastifyInstance): Promise<void> {
  // Approve a pending campaign → triggers the actual bulk send
  app.post("/v1/crm/communications/campaigns/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = campaignIdParam.parse(req.params);

    const campaign = await getPendingCampaign(ctx.tenantId, id);
    if (!campaign) {
      throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "pending campaign not found");
    }
    if (campaign.status !== "pending") {
      throw new HttpError(422, "INVALID_STATUS", `campaign is already ${campaign.status}`);
    }

    const cmdId = commandId(ctx, `${COMMANDS.approveCampaign}:${id}`);
    const result = await publishCrmCommand(ctx, COMMANDS.approveCampaign, cmdId, {
      campaignId: id,
      contactIds: campaign.contactIds,
      templateId: campaign.templateId,
      channel: campaign.channel,
      variables: campaign.variables ?? {},
      scheduledAt: campaign.scheduledAt,
    });

    return reply.code(202).send(result);
  });

  // Reject a pending campaign
  app.post("/v1/crm/communications/campaigns/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = campaignIdParam.parse(req.params);
    const body = rejectCampaignBody.parse(req.body ?? {});

    const campaign = await getPendingCampaign(ctx.tenantId, id);
    if (!campaign) {
      throw new HttpError(404, "CAMPAIGN_NOT_FOUND", "pending campaign not found");
    }
    if (campaign.status !== "pending") {
      throw new HttpError(422, "INVALID_STATUS", `campaign is already ${campaign.status}`);
    }

    const cmdId = commandId(ctx, `${COMMANDS.rejectCampaign}:${id}`);
    const result = await publishCrmCommand(ctx, COMMANDS.rejectCampaign, cmdId, {
      campaignId: id,
      reason: body.reason ?? null,
    });

    return reply.code(202).send(result);
  });
}
