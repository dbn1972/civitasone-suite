/**
 * LQ-002 — configurable lead scoring rules + score history.
 *   GET /v1/crm/lead-score-rules          — the tenant's rules (admin; seeds defaults)
 *   PUT /v1/crm/lead-score-rules          — upsert rules (admin, audited)
 *   GET /v1/crm/leads/:id/score-history   — score change history for a lead
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./score-rules-repo.js";
import { putScoreRulesBody, scoreHistoryQuery, leadIdParam } from "./score-rules-validators.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

/** F3-03: `?confirmEmpty=true` must be explicit to accept an empty config PUT.
 * (z.coerce.boolean() would read the string "false" as true, so use an enum.) */
const confirmEmptyQuery = z.object({
  confirmEmpty: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export async function leadScoreRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/lead-score-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { rules, meta } = await repo.getRuleViewsList(ctx.tenantId, ctx.actorId);
    void reply.header("ETag", meta.version);
    return reply.send({ data: rules, version: meta.version, meta: { ...meta, total: rules.length } });
  });

  app.put("/v1/crm/lead-score-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = putScoreRulesBody.parse(req.body);
    const { confirmEmpty } = confirmEmptyQuery.parse(req.query ?? {});
    // F3-03: refuse an accidental empty rule-set PUT unless the caller explicitly
    // confirmed clearing all (the web only sends confirmEmpty=true from its "clear
    // all" confirmation). Fails loud rather than silently applying a no-op.
    if (body.rules.length === 0 && !confirmEmpty) {
      throw new HttpError(422, "EMPTY_CONFIG_REJECTED", "an empty score-rules list requires confirmEmpty=true");
    }
    const headerMatch = req.headers["if-match"];
    const ifMatch = typeof headerMatch === "string" ? headerMatch.replace(/^W\//, "").replace(/^"|"$/g, "") : undefined;
    const expectedVersion = ifMatch ?? body.version;
    const { rules, meta } = await repo.upsertRules(
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
      expectedVersion,
    );
    void reply.header("ETag", meta.version);
    return reply.send({ data: rules, version: meta.version, meta });
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
