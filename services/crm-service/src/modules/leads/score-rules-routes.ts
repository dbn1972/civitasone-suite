/**
 * LQ-002 — configurable lead scoring rules + score history.
 *   GET /v1/crm/lead-score-rules          — the tenant's rules (admin; seeds defaults)
 *   PUT /v1/crm/lead-score-rules          — upsert rules (admin, audited)
 *   POST /v1/crm/lead-score-rules/preview — dry-run what a PUT of this rule list would score against the tenant's leads
 *                                           (admin, read-only; the list is overlaid on the stored rules like the PUT)
 *   GET /v1/crm/leads/:id/score-history   — score change history for a lead
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./score-rules-repo.js";
import {
  putScoreRulesBody,
  previewScoreRulesBody,
  scoreHistoryQuery,
  leadIdParam,
  NOT_SCOREABLE_MESSAGE,
} from "./score-rules-validators.js";
import { SCOREABLE_LEAD_ATTRIBUTES, isScoreableAttribute } from "./score-rules-domain.js";

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

/**
 * A rule on a field the scorer does not read gets past the validator only when it is DISABLED (that is
 * how a legacy rule is retired). It must also already be stored for this tenant: otherwise it is a NEW
 * rule on an unscoreable field, refused with the same field error as an enabled one.
 */
async function assertRetiredRulesAreStored(tenantId: string, rules: ReadonlyArray<{ attribute: string }>): Promise<void> {
  const unscoreable = rules
    .map((rule, index) => ({ attribute: rule.attribute, index }))
    .filter((r) => !isScoreableAttribute(r.attribute));
  if (unscoreable.length === 0) return;
  const stored = await repo.storedAttributes(tenantId);
  const unknown = unscoreable.filter((r) => !stored.has(r.attribute));
  if (unknown.length > 0) {
    throw new ZodError(
      unknown.map((r) => ({ code: "custom" as const, path: ["rules", r.index, "attribute"], message: NOT_SCOREABLE_MESSAGE })),
    );
  }
}

export async function leadScoreRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/lead-score-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { rules, meta } = await repo.getRuleViewsList(ctx.tenantId, ctx.actorId);
    void reply.header("ETag", meta.version);
    // GAP-CRM-LEAD-SCORING-03: advertise the lead fields a rule can score on, so the
    // editor offers exactly these (the PUT validator rejects anything else).
    return reply.send({
      data: rules,
      version: meta.version,
      meta: { ...meta, total: rules.length, scoreableAttributes: SCOREABLE_LEAD_ATTRIBUTES },
    });
  });

  // GAP-CRM-LEAD-SCORING-04: score the tenant's leads with the rules a Save of the PROPOSED
  // list would leave behind (PUT is additive, so omitted stored rules still score) and report
  // the resulting distribution against the stored scores. Nothing is persisted.
  app.post(
    "/v1/crm/lead-score-rules/preview",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, ADMIN_ROLES);
      const body = previewScoreRulesBody.parse(req.body);
      await assertRetiredRulesAreStored(ctx.tenantId, body.rules);
      const data = await repo.previewRules(
        ctx.tenantId,
        body.rules.map((r) => ({
          attribute: r.attribute,
          weight: r.weight,
          scoreFnType: r.scoreFnType,
          params: r.params,
          enabled: r.enabled,
        })),
      );
      return reply.send({ data });
    },
  );

  app.put("/v1/crm/lead-score-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = putScoreRulesBody.parse(req.body);
    await assertRetiredRulesAreStored(ctx.tenantId, body.rules);
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
