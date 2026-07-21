/**
 * Model Routes — GET /v1/ml/models, GET /v1/ml/models/:id, POST /v1/ml/models/:id/promote, GET /v1/ml/models/:id/card
 *
 * Provides model listing (paginated, tenant-scoped), model detail with metrics,
 * promotion of candidate models, and model card access (bias checks, limitations).
 *
 * Validates: Requirements 2.5, 2.6, 24.5
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { mlModels } from "./schema.js";
import { promote } from "../model-registry/domain.js";

const MODEL_ADMIN_ROLES = ["ml_admin", "tenant_admin", "super_admin"];
const MODEL_CARD_ROLES = ["ml_admin", "analytics_admin", "super_admin"];

const VALID_DOMAINS = ["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"] as const;

const listModelsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  domain: z.enum(VALID_DOMAINS).optional(),
  status: z.enum(["training", "candidate", "active", "deactivated", "archived"]).optional(),
});

const modelIdParams = z.object({
  id: z.string().uuid(),
});

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/ml/models — List models (paginated, tenant-scoped)
   * Requires: ml_admin or tenant_admin
   */
  app.get("/v1/ml/models", async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    const ctx = resolveContext(req);
    requireRole(ctx, MODEL_ADMIN_ROLES);

    const query = listModelsQuery.parse(req.query);
    const { page, pageSize, domain, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(mlModels.tenantId, ctx.tenantId)];
    if (domain) conditions.push(eq(mlModels.domain, domain));
    if (status) conditions.push(eq(mlModels.status, status));

    const whereClause = and(...conditions);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these reads — a bare db.select() runs with no RLS GUC set.
    const { total, rows } = await db.transaction(async (tx) => {
      const [countResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(mlModels)
        .where(whereClause);

      const modelRows = await tx
        .select()
        .from(mlModels)
        .where(whereClause)
        .orderBy(desc(mlModels.updatedAt))
        .limit(pageSize)
        .offset(offset);

      return { total: countResult?.count ?? 0, rows: modelRows };
    });

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        domain: r.domain,
        version: r.version,
        status: r.status,
        trainedAt: r.trainedAt,
        recordCount: r.recordCount,
        metrics: r.metrics,
        featureList: r.featureList,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      meta: { page, pageSize, total },
    });
  });

  /**
   * GET /v1/ml/models/:id — Model detail with metrics
   * Requires: ml_admin or tenant_admin
   */
  app.get("/v1/ml/models/:id", async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    const ctx = resolveContext(req);
    requireRole(ctx, MODEL_ADMIN_ROLES);

    const { id } = modelIdParams.parse(req.params);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const [model] = await db.transaction((tx) =>
      tx
        .select()
        .from(mlModels)
        .where(and(eq(mlModels.id, id), eq(mlModels.tenantId, ctx.tenantId)))
        .limit(1),
    );

    if (!model) {
      throw new HttpError(404, "NOT_FOUND", "model not found");
    }

    return reply.send({
      data: {
        id: model.id,
        tenantId: model.tenantId,
        domain: model.domain,
        version: model.version,
        status: model.status,
        s3Key: model.s3Key,
        trainedAt: model.trainedAt,
        recordCount: model.recordCount,
        metrics: model.metrics,
        featureList: model.featureList,
        modelCard: model.modelCard,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
        createdBy: model.createdBy,
        updatedBy: model.updatedBy,
      },
    });
  });

  /**
   * POST /v1/ml/models/:id/promote — Promote candidate model to active
   * Requires: ml_admin or tenant_admin
   * Emits: ml.model.promoted audit event
   */
  app.post("/v1/ml/models/:id/promote", async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    const ctx = resolveContext(req);
    requireRole(ctx, MODEL_ADMIN_ROLES);

    const { id } = modelIdParams.parse(req.params);

    // Verify model belongs to tenant
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const [model] = await db.transaction((tx) =>
      tx
        .select()
        .from(mlModels)
        .where(and(eq(mlModels.id, id), eq(mlModels.tenantId, ctx.tenantId)))
        .limit(1),
    );

    if (!model) {
      throw new HttpError(404, "NOT_FOUND", "model not found");
    }

    if (model.status !== "candidate") {
      throw new HttpError(422, "INVALID_STATUS", `model is not in candidate status (current: ${model.status})`);
    }

    const promoted = await promote(id, ctx.actorId);

    if (!promoted) {
      throw new HttpError(422, "PROMOTION_FAILED", "candidate metrics do not meet promotion criteria relative to current active model");
    }

    return reply.send({
      data: { id, promoted: true, message: "model promoted to active" },
    });
  });

  /**
   * GET /v1/ml/models/:id/card — Model card (bias checks, limitations)
   * Requires: ml_admin or analytics_admin
   */
  app.get("/v1/ml/models/:id/card", async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    const ctx = resolveContext(req);
    requireRole(ctx, MODEL_CARD_ROLES);

    const { id } = modelIdParams.parse(req.params);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const [model] = await db.transaction((tx) =>
      tx
        .select()
        .from(mlModels)
        .where(and(eq(mlModels.id, id), eq(mlModels.tenantId, ctx.tenantId)))
        .limit(1),
    );

    if (!model) {
      throw new HttpError(404, "NOT_FOUND", "model not found");
    }

    if (!model.modelCard) {
      throw new HttpError(404, "NO_MODEL_CARD", "model card not available for this model");
    }

    return reply.send({
      data: model.modelCard,
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
