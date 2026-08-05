/**
 * Gap 1 — POST /v1/crm/communications/preview
 *
 * Read-only cost estimate for a campaign — no messages are sent.
 * Returns recipient count, consented count, and estimated cost.
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { previewCampaignBody } from "./preview-validators.js";

const PREVIEW_ROLES = ["crm_user", "crm_admin", "super_admin"];

/** Per-message cost in minor units (paise) per channel — configurable via env or tenant settings. */
const CHANNEL_COST_MINOR: Record<string, number> = {
  email: Number(process.env.COST_PER_EMAIL_MINOR ?? 10),
  sms: Number(process.env.COST_PER_SMS_MINOR ?? 25),
  whatsapp: Number(process.env.COST_PER_WHATSAPP_MINOR ?? 50),
};

interface RecipientStats {
  recipientCount: number;
  consentedCount: number;
}

async function countRecipients(
  tenantId: string,
  contactIds: string[] | undefined,
  segment: string | undefined,
): Promise<RecipientStats> {
  if (contactIds && contactIds.length > 0) {
    const placeholders = contactIds.map((id) => sql`${id}`);
    const inClause = sql.join(placeholders, sql`,`);
    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT
        COUNT(*)::int AS "recipientCount",
        COUNT(*) FILTER (WHERE marketing_consent = true)::int AS "consentedCount"
      FROM crm.contacts
      WHERE tenant_id = ${tenantId}
        AND id IN (${inClause})
        AND status = 'active'
    `)) as unknown as RecipientStats[];
    return rows[0] ?? { recipientCount: 0, consentedCount: 0 };
  }

  if (segment) {
    // Segment-based — match contacts by segment tag
    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT
        COUNT(*)::int AS "recipientCount",
        COUNT(*) FILTER (WHERE marketing_consent = true)::int AS "consentedCount"
      FROM crm.contacts
      WHERE tenant_id = ${tenantId}
        AND status = 'active'
        AND segment = ${segment}
    `)) as unknown as RecipientStats[];
    return rows[0] ?? { recipientCount: 0, consentedCount: 0 };
  }

  throw new HttpError(400, "INVALID_FILTER", "must provide contactIds or segment");
}

export async function previewRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/communications/preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PREVIEW_ROLES);
    const body = previewCampaignBody.parse(req.body);

    const stats = await countRecipients(ctx.tenantId, body.contactIds, body.segment);
    const costPerUnit = CHANNEL_COST_MINOR[body.channel] ?? 0;
    const estimatedCostMinor = stats.consentedCount * costPerUnit;

    return reply.code(200).send({
      data: {
        recipientCount: stats.recipientCount,
        consentedCount: stats.consentedCount,
        estimatedCostMinor,
        channel: body.channel,
        currency: "INR",
      },
    });
  });
}
