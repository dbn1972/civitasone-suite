import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache, queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  computeOpportunityScore,
  padOpportunityString,
  validateIntelligenceInput,
  worstSeverity,
} from "./domain.js";
import type { RiskSignal, WhiteSpaceEntry } from "./schema.js";

const READ_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];
const WRITE_ROLES = ["recommendation_admin", "sales_user", "super_admin"];

const MAX_LIMIT = 200;

const accountParam = z.object({ accountId: z.string().uuid() });

const whiteSpaceSchema = z.array(
  z.object({
    productId: z.string().uuid(),
    label: z.string().trim().min(1).max(128).optional(),
    /** Decimal string so an estimated value never round-trips through a float. */
    estimatedValue: z.string().trim().regex(/^\d{1,15}(\.\d{1,4})?$/).optional(),
  }),
).max(200);

const riskSignalsSchema = z.array(
  z.object({
    code: z.string().trim().min(1).max(64),
    severity: z.enum(["low", "medium", "high", "critical"]),
    note: z.string().trim().min(1).max(500).optional(),
  }),
).max(200);

const computeBody = z.object({
  whiteSpace: whiteSpaceSchema.default([]),
  riskSignals: riskSignalsSchema.default([]),
});

const rankedQuery = z.object({
  minOpportunityScore: z
    .string()
    .trim()
    .regex(/^\d(\.\d{1,4})?$/, "minOpportunityScore must be a decimal between 0 and 1")
    .optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function intelligenceRoutes(app: FastifyInstance): Promise<void> {
  /** GET /v1/recommendations/accounts/intelligence — ranked accounts by opportunity. */
  app.get("/v1/recommendations/accounts/intelligence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = rankedQuery.parse(req.query);

    const { rows, total } = await repo.listRanked(ctx.tenantId, q.limit, q.offset, {
      ...(q.minOpportunityScore !== undefined
        ? { minOpportunityScore: padOpportunityString(q.minOpportunityScore) }
        : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map((r) => {
        const view = repo.toView(r);
        return { ...view, worstRiskSeverity: worstSeverity(view.riskSignals) };
      }),
      meta: { page, pageSize: q.limit, total },
    });
  });

  /** GET /v1/recommendations/accounts/:accountId/intelligence — one account's record. */
  app.get("/v1/recommendations/accounts/:accountId/intelligence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { accountId } = accountParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "intelligence", accountId);
    const row = await cache.getOrLoad(cacheKey, () => repo.findByAccount(accountId, ctx.tenantId));
    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "no intelligence computed for this account");
    }

    const view = repo.toView(row);
    return reply.send({
      data: { ...view, worstRiskSeverity: worstSeverity(view.riskSignals) },
    });
  });

  /**
   * POST /v1/recommendations/accounts/:accountId/intelligence/compute
   * CQRS write: publish the command, answer 202. The consumer recomputes the
   * score, upserts and emits the audit event.
   */
  app.post("/v1/recommendations/accounts/:accountId/intelligence/compute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { accountId } = accountParam.parse(req.params);
    const body = computeBody.parse(req.body ?? {});

    const whiteSpace: WhiteSpaceEntry[] = body.whiteSpace.map((e) => ({
      productId: e.productId,
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.estimatedValue !== undefined ? { estimatedValue: e.estimatedValue } : {}),
    }));
    const riskSignals: RiskSignal[] = body.riskSignals.map((s) => ({
      code: s.code,
      severity: s.severity,
      ...(s.note !== undefined ? { note: s.note } : {}),
    }));

    const validationError = validateIntelligenceInput({ whiteSpace, riskSignals });
    if (validationError) throw new HttpError(422, "INTELLIGENCE_INVALID", validationError);

    const intelligenceId = randomUUID();
    // Previewed on the read side so the caller sees the score it will get; the
    // consumer recomputes it from the same pure function before persisting.
    const opportunityScore = computeOpportunityScore(whiteSpace, riskSignals);

    await queue.publish(COMMANDS.intelligenceCompute, {
      type: COMMANDS.intelligenceCompute,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { intelligenceId, accountId, whiteSpace, riskSignals },
    });

    return reply.code(202).send({
      data: { intelligenceId, accountId, opportunityScore, status: "queued" },
    });
  });
}
