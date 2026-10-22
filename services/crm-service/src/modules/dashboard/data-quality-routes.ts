/**
 * Data-quality dashboard route (DQ-004).
 *   GET /v1/crm/data-quality?entity=contacts|leads|accounts
 *                            &filter=missing|invalid|stale|all
 *                            &staleDays=90
 *
 * Returns the completeness-score distribution, counts of records with
 * missing-required / invalid-format / stale attributes, and — when `filter` is
 * given — the matching records as `{id, name, score (0..1), issues[]}` rows
 * (plus the legacy `filteredIds`). `filter=all` returns the rows of every
 * filter under `recordsByFilter` so the screen can switch tabs without
 * re-fetching the counts (GAP-CRM-DATA-QUALITY-01/03).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole } from "../../shared/context.js";
import { getDataQuality } from "./data-quality-queries.js";
import { withoutNames } from "./data-quality.js";

const ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
/**
 * Roles that may list contacts and accounts (contacts/routes.ts CRM_ROLES). Only
 * they get the display name on a drill-down row; tenant_admin may open this
 * dashboard but not the lists, so its rows carry `name: null`.
 */
const NAME_READ_ROLES = ["crm_user", "crm_admin", "super_admin"];

const querySchema = z.object({
  entity: z.enum(["contacts", "leads", "accounts"]).default("contacts"),
  filter: z.enum(["missing", "invalid", "stale", "all"]).optional(),
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
    return reply.send({ data: hasAnyRole(ctx, NAME_READ_ROLES) ? report : withoutNames(report) });
  });
}
