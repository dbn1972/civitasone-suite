/**
 * Completeness Route — GET /v1/crm/leads/:id/completeness
 *
 * Returns per-record data quality completeness score with missing/filled
 * field breakdown. Supports DQ-004 requirement.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { contacts } from "../contacts/schema.js";
import { computeCompleteness } from "./completeness.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

const leadIdParamSchema = z.object({
  id: z.string().uuid(),
});

export async function completenessRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/leads/:id/completeness", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const params = leadIdParamSchema.parse(req.params);

    const rows = await scopedRead((tx) =>
      tx.select({
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        company: contacts.company,
        designation: contacts.designation,
        city: contacts.city,
        leadSource: contacts.leadSource,
      })
        .from(contacts)
        .where(and(
          eq(contacts.id, params.id),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.status} = 'active'`,
        ))
        .limit(1),
    );

    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "lead not found");
    }

    const row = rows[0]!;
    const attributes: Record<string, unknown> = {
      name: row.name,
      email: row.email,
      phone: row.phone,
      company: row.company,
      designation: row.designation,
      city: row.city,
      leadSource: row.leadSource,
    };

    const result = computeCompleteness(attributes);
    return reply.send({ data: result });
  });
}
