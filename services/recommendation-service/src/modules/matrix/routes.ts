import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { detectDuplicate, validateMatrixEntry, type MatrixEntryInput } from "./domain.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];
const ADMIN_ROLES = ["recommendation_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  triggerProductId: z.string().uuid().optional(),
  segment: z.string().min(1).max(64).optional(),
  channel: z.string().min(1).max(64).optional(),
});

const createMatrixBody = z.object({
  triggerProductId: z.string().uuid(),
  recommendedProductId: z.string().uuid(),
  segment: z.string().min(1).max(64).optional(),
  channel: z.string().min(1).max(64).optional(),
  priority: z.number().int().min(0).default(0),
});

const updateMatrixBody = z.object({
  segment: z.string().min(1).max(64).optional(),
  channel: z.string().min(1).max(64).optional(),
  priority: z.number().int().min(0).optional(),
  version: z.number().int().positive(),
});

export async function matrixRoutes(app: FastifyInstance): Promise<void> {
  /** GET /v1/recommendations/matrix — paginated cross-sell rules. */
  app.get("/v1/recommendations/matrix", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.triggerProductId !== undefined ? { triggerProductId: q.triggerProductId } : {}),
      ...(q.segment !== undefined ? { segment: q.segment } : {}),
      ...(q.channel !== undefined ? { channel: q.channel } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  /** GET /v1/recommendations/matrix/:id — single rule. */
  app.get("/v1/recommendations/matrix/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "matrix", id);
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "NOT_FOUND", "matrix entry not found");

    return reply.send({ data: repo.toView(row) });
  });

  /** POST /v1/recommendations/matrix — create a rule. */
  app.post("/v1/recommendations/matrix", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createMatrixBody.parse(req.body);

    const entry: MatrixEntryInput = {
      triggerProductId: body.triggerProductId,
      recommendedProductId: body.recommendedProductId,
      priority: body.priority,
      ...(body.segment !== undefined ? { segment: body.segment } : {}),
      ...(body.channel !== undefined ? { channel: body.channel } : {}),
    };

    const validationError = validateMatrixEntry(entry);
    if (validationError) throw new HttpError(422, "MATRIX_INVALID", validationError);

    const siblings = await repo.findByProductPair(
      ctx.tenantId,
      body.triggerProductId,
      body.recommendedProductId,
    );
    const duplicate = detectDuplicate(siblings, entry);
    if (duplicate) {
      throw new HttpError(409, "MATRIX_DUPLICATE", "a matrix entry with the same scope already exists");
    }

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        triggerProductId: body.triggerProductId,
        recommendedProductId: body.recommendedProductId,
        segment: body.segment ?? null,
        channel: body.channel ?? null,
        priority: body.priority,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.matrixEntryCreated,
        eventType: EVENTS.matrixEntryCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          matrixId: id,
          triggerProductId: body.triggerProductId,
          recommendedProductId: body.recommendedProductId,
          segment: body.segment ?? null,
          channel: body.channel ?? null,
          priority: body.priority,
        },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "matrix", id));

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        triggerProductId: body.triggerProductId,
        recommendedProductId: body.recommendedProductId,
        segment: body.segment ?? null,
        channel: body.channel ?? null,
        priority: body.priority,
        version: 1,
      },
    });
  });

  /** PATCH /v1/recommendations/matrix/:id — update scope or priority. */
  app.patch("/v1/recommendations/matrix/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateMatrixBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "matrix entry not found");

    const merged: MatrixEntryInput = {
      triggerProductId: existing.triggerProductId,
      recommendedProductId: existing.recommendedProductId,
      priority: body.priority ?? existing.priority,
      segment: body.segment ?? existing.segment,
      channel: body.channel ?? existing.channel,
    };

    const validationError = validateMatrixEntry(merged);
    if (validationError) throw new HttpError(422, "MATRIX_INVALID", validationError);

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.segment !== undefined) patch.segment = body.segment;
    if (body.channel !== undefined) patch.channel = body.channel;
    if (body.priority !== undefined) patch.priority = body.priority;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          "matrix entry has been modified; retry with current version",
        );
      }

      await enqueue(tx, {
        topic: EVENTS.matrixEntryUpdated,
        eventType: EVENTS.matrixEntryUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { matrixId: id, patch },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "matrix", id));

    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  /** DELETE /v1/recommendations/matrix/:id — remove a rule. */
  app.delete("/v1/recommendations/matrix/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "matrix entry not found");

    await db.transaction(async (tx) => {
      const ok = await repo.deleteById(tx, id, ctx.tenantId);
      if (!ok) throw new HttpError(404, "NOT_FOUND", "matrix entry not found");

      await enqueue(tx, {
        topic: EVENTS.matrixEntryDeleted,
        eventType: EVENTS.matrixEntryDeleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { matrixId: id },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "matrix", id));

    return reply.send({ data: { id, deleted: true } });
  });
}
