/**
 * LQ-002 — configurable lead scoring rules + score history.
 *   GET /v1/crm/lead-score-rules          — the tenant's rules (admin; seeds defaults)
 *   PUT /v1/crm/lead-score-rules          — upsert rules (admin, audited)
 *   GET /v1/crm/leads/:id/score-history   — score change history for a lead
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as repo from "./score-rules-repo.js";
import { putScoreRulesBody, scoreHistoryQuery, leadIdParam } from "./score-rules-validators.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

export async function leadScoreRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/lead-score-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const rules = await repo.getRuleViews(ctx.tenantId, ctx.actorId);
    return reply.send({ data: rules, meta: { total: rules.length } });
  });

  app.put("/v1/crm/lead-score-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = putScoreRulesBody.parse(req.body);
    const rules = await repo.upsertRules(
      ctx.tenantId,
      body.rules.map((r) => ({
        attribute: r.attribute,
        weight: r.weight,
        scoreFnType: r.scoreFnType,
        params: r.params,
        enabled: r.enabled,
      })),
      ctx.actorId,
      ctx.correlationId,
    );
    return reply.send({ data: rules });
  });

  app.get("/v1/crm/leads/:id/score-history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = leadIdParam.parse(req.params);
    const q = scoreHistoryQuery.parse(req.query);
    const data = await repo.listHistory(ctx.tenantId, id, q.limit);
    return reply.send({ data, meta: { total: data.length } });
  });
}
