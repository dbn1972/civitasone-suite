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
import { resolveContext, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { mlPredictions } from "./schema.js";

const predictionsQuery = z.object({
  entityId: z.string().uuid(),
  domain: z.enum(["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"]),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export async function predictionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/ml/predictions — Prediction history lookup by entityId + domain
   * Requires: JWT auth (any role, tenant-scoped)
   */
  app.get("/v1/ml/predictions", async (req, reply) => {
    const ctx = resolveContext(req);

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
