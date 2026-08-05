/**
 * Gap 8 — Executive-Sponsor Role Type.
 * Routes to manage executive sponsors via account_relationships (rel_type = 'executive_sponsor').
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const addSponsorBody = z.object({
  contactId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

const accountIdParam = z.object({ id: z.string().uuid() });
const sponsorIdParam = z.object({ id: z.string().uuid(), sponsorId: z.string().uuid() });

export async function sponsorRoutes(app: FastifyInstance): Promise<void> {
  // Add an executive sponsor
  app.post("/v1/crm/accounts/:id/sponsors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: accountId } = accountIdParam.parse(req.params);
    const body = addSponsorBody.parse(req.body);

    // Verify account exists
    const account = (await scopedRead((tx) => tx.execute(sql`
      SELECT id FROM crm.accounts WHERE id = ${accountId} AND tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<{ id: string }>;
    if (account.length === 0) throw new HttpError(404, "NOT_FOUND", "account not found");

    // Insert into account_relationships with rel_type = 'sponsor'
    const rows = (await scopedRead((tx) => tx.execute(sql`
      INSERT INTO crm.account_relationships (tenant_id, from_account_id, to_account_id, rel_type, created_by)
      VALUES (${ctx.tenantId}, ${accountId}, ${body.contactId}, 'sponsor', ${ctx.actorId})
      ON CONFLICT DO NOTHING
      RETURNING id, from_account_id AS "accountId", to_account_id AS "contactId",
                rel_type AS "relType", created_at AS "createdAt"
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      throw new HttpError(409, "ALREADY_EXISTS", "this executive sponsor relationship already exists");
    }

    return reply.code(201).send({ data: rows[0] });
  });

  // List executive sponsors for an account
  app.get("/v1/crm/accounts/:id/sponsors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: accountId } = accountIdParam.parse(req.params);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.id, r.from_account_id AS "accountId", r.to_account_id AS "contactId",
             r.rel_type AS "relType", r.created_at AS "createdAt",
             c.name AS "contactName"
      FROM crm.account_relationships r
      LEFT JOIN crm.contacts c ON c.id = r.to_account_id AND c.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${ctx.tenantId}
        AND r.from_account_id = ${accountId}
        AND r.rel_type = 'sponsor'
      ORDER BY r.created_at DESC
    `))) as unknown as Array<Record<string, unknown>>;

    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  // Remove an executive sponsor
  app.delete("/v1/crm/accounts/:id/sponsors/:sponsorId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: accountId, sponsorId } = sponsorIdParam.parse(req.params);

    const result = (await scopedRead((tx) => tx.execute(sql`
      DELETE FROM crm.account_relationships
      WHERE id = ${sponsorId}
        AND from_account_id = ${accountId}
        AND tenant_id = ${ctx.tenantId}
        AND rel_type = 'sponsor'
      RETURNING id
    `))) as unknown as Array<{ id: string }>;

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "sponsor relationship not found");
    }

    return reply.code(204).send();
  });
}
