/**
 * Data-quality dashboard route (DQ-004).
 *   GET /v1/crm/data-quality?entity=contacts|leads|accounts
 *                            &filter=missing|invalid|stale
 *                            &staleDays=90
 *
 * Returns the completeness-score distribution, counts of records with
 * missing-required / invalid-format / stale attributes, and — when `filter` is
 * given — the ids of the matching records.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import { getDataQuality } from "./data-quality-queries.js";

const ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

const querySchema = z.object({
  entity: z.enum(["contacts", "leads", "accounts"]).default("contacts"),
  filter: z.enum(["missing", "invalid", "stale"]).optional(),
  staleDays: z.coerce.number().int().min(1).max(3650).default(90),
});

export async function dataQualityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/data-quality", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = querySchema.parse(req.query);
    const report = await getDataQuality(ctx.tenantId, q.entity, {
      staleDays: q.staleDays,
      filter: q.filter ?? null,
    });
    return reply.send({ data: report });
  });
}
