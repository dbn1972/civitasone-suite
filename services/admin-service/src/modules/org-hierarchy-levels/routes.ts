/**
 * org-hierarchy-levels -- HTTP routes (Fastify plugin).
 *
 * COMP-014: a configurable hierarchy-LEVEL TAXONOMY (how many reporting
 * tiers, each tier's label/description/examples/color) for
 * platform-admin/org-config/OrgConfigPage.tsx. Deliberately NOT
 * /v1/admin/org-hierarchy (gap/routes.ts) -- that path is the real, working
 * org-unit-INSTANCE CRUD (tenant-service's flat orgUnits taxonomy, consumed
 * by admin/org/OrgHierarchyManager.tsx). See schema.ts's module comment and
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md#COMP-014 for the full distinction.
 *
 * Both routes are synchronous (direct db.transaction via scopedRead, not a
 * published command applied later by a consumer) -- this is simple,
 * single-actor tenant config with no maker-checker or cross-service side
 * effect, the same shape central-config's routes.ts documents choosing a
 * synchronous db.transaction for. The caller's save button expects to see
 * its own write reflected immediately (including on next page load), so a
 * 200 with the resulting rows is returned directly rather than a 202.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { OrgHierarchyLevelRow } from "./schema.js";

const ROLES = [...TENANT_ADMIN_ROLES];

const levelSchema = z.object({
  id: z.string().min(1).max(64),
  order: z.number().int().min(1).max(50),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  examples: z.string().max(500).default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "color must be a hex value").default("#334155"),
});

const putBody = z.object({
  levels: z.array(levelSchema).min(1).max(50),
}).superRefine((body, ctx) => {
  const ids = body.levels.map((l) => l.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "level ids must be unique" });
  }
});

function serialize(row: OrgHierarchyLevelRow) {
  return {
    id: row.levelKey,
    order: row.sortOrder,
    label: row.label,
    description: row.description,
    examples: row.examples,
    color: row.color,
  };
}

export async function orgHierarchyLevelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/org-hierarchy-levels", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await repo.fetchLevelsForTenant(ctx.tenantId);
    return reply.send({ data: rows.map(serialize) });
  });

  app.put("/v1/admin/org-hierarchy-levels", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const parsed = putBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const rows = await repo.replaceLevelsForTenant(ctx.tenantId, parsed.data.levels, ctx.actorId);
    return reply.send({ data: rows.map(serialize) });
  });
}
