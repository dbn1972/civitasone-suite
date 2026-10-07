/**
 * Evaluation Routes — GET /v1/ml/evaluations
 *
 * Returns aggregated prediction metrics over configurable time windows (7d, 30d, 90d).
 * Metrics include: total predictions, average confidence, fallback rate, and domain breakdown.
 *
 * Validates: Requirements 5.3, 5.5
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql, gte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { mlPredictions } from "../predictions/schema.js";

const EVALUATION_ROLES = ["ml_admin", "analytics_admin", "super_admin"];

const evaluationsQuery = z.object({
  window: z.enum(["7d", "30d", "90d"]).default("30d"),
  domain: z.enum(["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"]).optional(),
});

const exportAuditBody = z.object({
  domain: z.enum(["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"]),
  rowCount: z.number().int().min(0),
  filtered: z.boolean().default(false),
});

function windowToDays(window: string): number {
  switch (window) {
    case "7d": return 7;
    case "30d": return 30;
    case "90d": return 90;
    default: return 30;
  }
}

export async function evaluationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/ml/evaluations — Aggregated metrics over time windows
   * Requires: ml_admin or analytics_admin
   */
  app.get("/v1/ml/evaluations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVALUATION_ROLES);

    const query = evaluationsQuery.parse(req.query);
    const days = windowToDays(query.window);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const conditions = [
      eq(mlPredictions.tenantId, ctx.tenantId),
      gte(mlPredictions.createdAt, since),
    ];
    if (query.domain) {
      conditions.push(eq(mlPredictions.domain, query.domain));
    }

    const whereClause = and(...conditions);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these reads — bare db.select() runs with no RLS GUC set and
    // would silently return zero rows under FORCE ROW LEVEL SECURITY.
    const { metrics, domainBreakdown } = await db.transaction(async (tx) => {
      // Aggregate metrics
      const [aggMetrics] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          avgConfidence: sql<number>`coalesce(avg(${mlPredictions.confidence}::numeric), 0)::float`,
          fallbackCount: sql<number>`count(*) filter (where ${mlPredictions.isFallback} = true)::int`,
        })
        .from(mlPredictions)
        .where(whereClause);

      // Per-domain breakdown
      const domains = await tx
        .select({
          domain: mlPredictions.domain,
          total: sql<number>`count(*)::int`,
          avgConfidence: sql<number>`coalesce(avg(${mlPredictions.confidence}::numeric), 0)::float`,
          fallbackCount: sql<number>`count(*) filter (where ${mlPredictions.isFallback} = true)::int`,
        })
        .from(mlPredictions)
        .where(whereClause)
        .groupBy(mlPredictions.domain);

      return { metrics: aggMetrics, domainBreakdown: domains };
    });

    const total = metrics?.total ?? 0;
    const fallbackCount = metrics?.fallbackCount ?? 0;

    return reply.send({
      data: {
        window: query.window,
        totalPredictions: total,
        avgConfidence: Math.round((metrics?.avgConfidence ?? 0) * 10000) / 10000,
        fallbackRate: total > 0 ? Math.round((fallbackCount / total) * 10000) / 10000 : 0,
        fallbackCount,
        domains: domainBreakdown.map((d) => ({
          domain: d.domain,
          totalPredictions: d.total,
          avgConfidence: Math.round((d.avgConfidence ?? 0) * 10000) / 10000,
          fallbackRate: d.total > 0 ? Math.round((d.fallbackCount / d.total) * 10000) / 10000 : 0,
        })),
      },
    });
  });

  /**
   * POST /v1/ml/predictions/export-audit — record that a user exported the
   * ML predictions CSV from the ML Insights UI. The CSV carries scored entity
   * ids and model scores, so each export is recorded in the audit trail. The
   * raw search text is never sent (only whether a filter was active), and the
   * same role gate as the evaluations read applies. The audit write is in a
   * transaction with the outbox enqueue (exactly-once via the transactional
   * outbox). GAP-ANALYTICS-ML-INSIGHTS-*-07/08.
   */
  app.post("/v1/ml/predictions/export-audit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVALUATION_ROLES);

    const body = exportAuditBody.parse(req.body);

    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "ml.predictions.export",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: randomUUID(),
        payload: {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          action: "ml.predictions.export",
          domain: body.domain,
          rowCount: body.rowCount,
          filtered: body.filtered,
          timestamp: new Date().toISOString(),
        },
      });
    });

    return reply.code(202).send({ data: { recorded: true } });
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
