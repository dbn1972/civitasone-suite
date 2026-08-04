/**
 * LQ-004 — lifecycle reason code catalog admin.
 *   GET /v1/crm/lead-reason-codes   — the tenant's codes (seeds defaults on first read)
 *   PUT /v1/crm/lead-reason-codes   — upsert codes (admin, audited)
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./reason-codes-repo.js";
import { putReasonCodesBody } from "./reason-codes-validators.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

export async function leadReasonCodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/lead-reason-codes", async (req, reply) => {
    const ctx = resolveContext(req);
    // Readable by any CRM user: the transition form needs the codes to offer them.
    requireRole(ctx, CRM_ROLES);
    const codes = await repo.getCodes(ctx.tenantId, ctx.actorId);
    return reply.send({ data: codes, meta: { total: codes.length } });
  });

  app.put("/v1/crm/lead-reason-codes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = putReasonCodesBody.parse(req.body);
    const codes = await repo.upsertCodes(
      ctx.tenantId,
      body.codes.map((c) => ({ code: c.code, label: c.label, appliesToStatus: c.appliesToStatus, active: c.active })),
      ctx.actorId,
      ctx.correlationId,
    );
    return reply.send({ data: codes });
  });
}
