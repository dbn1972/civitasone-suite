import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const createReferralBody = z.object({
  referrerId: z.string().uuid(),
  referredContactId: z.string().uuid(),
  sourceSystem: z.string().max(64).optional(),
  externalRef: z.string().max(200).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["pending", "converted", "expired", "rejected"]).optional(),
  referrerId: z.string().uuid().optional(),
});

const convertBody = z.object({
  dealId: z.string().uuid(),
});

const reconcileBody = z.object({
  entries: z.array(z.object({
    externalRef: z.string(),
    outcome: z.enum(["converted", "expired", "rejected"]),
  })).min(1).max(500),
});

const idParam = z.object({ id: z.string().uuid() });

export async function referralRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/referrals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createReferralBody.parse(req.body);

    // Dedup check: (tenant_id, referrer_id, referred_contact_id)
    const existing = (await scopedRead((tx) => tx.execute(sql`
      SELECT id FROM crm.referrals
      WHERE tenant_id = ${ctx.tenantId}
        AND referrer_id = ${body.referrerId}
        AND referred_contact_id = ${body.referredContactId}
    `))) as unknown as Array<{ id: string }>;

    if (existing.length > 0) {
      throw new HttpError(409, "DUPLICATE_REFERRAL", "a referral already exists for this referrer/contact combination");
    }

    const rows = (await scopedRead((tx) => tx.execute(sql`
      INSERT INTO crm.referrals (tenant_id, referrer_id, referred_contact_id, source_system, external_ref)
      VALUES (${ctx.tenantId}, ${body.referrerId}, ${body.referredContactId},
              ${body.sourceSystem ?? null}, ${body.externalRef ?? null})
      RETURNING id, tenant_id AS "tenantId", referrer_id AS "referrerId",
                referred_contact_id AS "referredContactId", source_system AS "sourceSystem",
                external_ref AS "externalRef", status, created_at AS "createdAt", credited
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.code(201).send({ data: rows[0] });
  });

  app.get("/v1/crm/referrals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuery.parse(req.query);
    const statusFilter = q.status ? sql`AND status = ${q.status}` : sql``;
    const referrerFilter = q.referrerId ? sql`AND referrer_id = ${q.referrerId}` : sql``;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", referrer_id AS "referrerId",
             referred_contact_id AS "referredContactId", source_system AS "sourceSystem",
             external_ref AS "externalRef", status, conversion_deal_id AS "conversionDealId",
             created_at AS "createdAt", converted_at AS "convertedAt", credited
      FROM crm.referrals
      WHERE tenant_id = ${ctx.tenantId} ${statusFilter} ${referrerFilter}
      ORDER BY created_at DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length } });
  });

  // Convert a referral — mark as converted + optionally credit agent
  app.post("/v1/crm/referrals/:id/convert", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = convertBody.parse(req.body);

    const result = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.referrals
      SET status = 'converted', conversion_deal_id = ${body.dealId},
          converted_at = now(), credited = true
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
      RETURNING id, referrer_id AS "referrerId"
    `))) as unknown as Array<{ id: string; referrerId: string }>;

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "referral not found or not in pending status");
    }

    return reply.send({ data: { id, status: "converted", credited: true } });
  });

  // Bulk reconcile from external system
  app.post("/v1/crm/referrals/reconcile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = reconcileBody.parse(req.body);

    let updated = 0;
    for (const entry of body.entries) {
      const result = (await scopedRead((tx) => tx.execute(sql`
        UPDATE crm.referrals
        SET status = ${entry.outcome},
            converted_at = CASE WHEN ${entry.outcome} = 'converted' THEN now() ELSE converted_at END,
            credited = CASE WHEN ${entry.outcome} = 'converted' THEN true ELSE credited END
        WHERE tenant_id = ${ctx.tenantId}
          AND external_ref = ${entry.externalRef}
          AND status = 'pending'
        RETURNING id
      `))) as unknown as Array<{ id: string }>;
      updated += result.length;
    }

    return reply.send({ data: { reconciled: updated, total: body.entries.length } });
  });
}
