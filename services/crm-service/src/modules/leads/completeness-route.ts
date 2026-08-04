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
import * as fieldRules from "./field-rules-repo.js";

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
        // LM-001: country and ownerId are configurable scoring fields, so they must
        // be read even though the default weight map does not mention them.
        country: contacts.country,
        ownerId: contacts.ownerId,
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
      country: row.country,
      ownerId: row.ownerId,
      leadSource: row.leadSource,
    };

    // Per-tenant weights when configured; the pure scorer falls back to defaults.
    const rules = await fieldRules.listRules(ctx.tenantId);
    const result = computeCompleteness(attributes, rules);
    return reply.send({ data: result });
  });
}
