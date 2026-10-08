/**
 * Prediction History Routes — GET /v1/ml/predictions
 *
 * Provides prediction history lookup by entityId + domain (paginated).
 * Used by the PredictionHistory timeline UI component.
 *
 * Validates: Requirements 5.3, 5.5
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { mlPredictions } from "./schema.js";

// GAP2-ML-PREDICTIONS-01: the prediction-history read must be role-gated like
// every other read in this unit. Prediction factors expose scored, decision-
// sensitive signals, so object-level read is restricted to the ML reader set
// (identical to evaluations/routes.ts EVALUATION_ROLES) rather than any
// authenticated tenant user.
const PREDICTION_READ_ROLES = ["ml_admin", "analytics_admin", "super_admin"];

const predictionsQuery = z.object({
  entityId: z.string().uuid(),
  domain: z.enum(["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"]),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export async function predictionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/ml/predictions — Prediction history lookup by entityId + domain
   * Requires: ml_admin / analytics_admin / super_admin (GAP2-ML-PREDICTIONS-01).
   * Prediction factors expose decision-sensitive signals, so this read is
   * role-gated like GET /v1/ml/evaluations — not open to any tenant user.
   */
  app.get("/v1/ml/predictions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PREDICTION_READ_ROLES);

    const query = predictionsQuery.parse(req.query);
    const { entityId, domain, page, pageSize } = query;
    const offset = (page - 1) * pageSize;

    const whereClause = and(
      eq(mlPredictions.tenantId, ctx.tenantId),
      eq(mlPredictions.entityId, entityId),
      eq(mlPredictions.domain, domain),
    );

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these reads — a bare db.select() runs with no RLS GUC set.
    const { total, rows } = await db.transaction(async (tx) => {
      const [countResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(mlPredictions)
        .where(whereClause);

      const predictionRows = await tx
        .select()
        .from(mlPredictions)
        .where(whereClause)
        .orderBy(desc(mlPredictions.createdAt))
        .limit(pageSize)
        .offset(offset);

      return { total: countResult?.count ?? 0, rows: predictionRows };
    });

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        domain: r.domain,
        entityId: r.entityId,
        modelId: r.modelId,
        experimentId: r.experimentId,
        prediction: r.prediction != null ? Number(r.prediction) : null,
        confidence: Number(r.confidence),
        factors: r.factors,
        isFallback: r.isFallback,
        fallbackReason: r.fallbackReason,
        actualOutcome: r.actualOutcome,
        userDecision: r.userDecision,
        createdAt: r.createdAt,
      })),
      meta: { page, pageSize, total },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "invalid request", correlationId } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, correlationId } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error", correlationId } });
  });
}
