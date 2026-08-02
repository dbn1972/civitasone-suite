import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  MAX_WEIGHT_BPS,
  detectDuplicate,
  resolveCompanions,
  validateEffectiveWindow,
  validateMatrixEntry,
  validateWeightBps,
  type MatrixCell,
  type MatrixEntryInput,
} from "./domain.js";

const REC_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];
const ADMIN_ROLES = ["recommendation_admin", "super_admin"];

/** Upper bound on holdings accepted by /matrix/resolve — bounds the SQL IN list. */
const MAX_HELD_PRODUCTS = 100;
/** Upper bound on matrix cells pulled in for one resolution. */
const MAX_RESOLVE_CELLS = 1000;

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
  /** XS-001 — per-cell weight in basis points (10000 = 100%). */
  weightBps: z.number().int().min(0).max(MAX_WEIGHT_BPS).default(0),
  effectiveFrom: z.string().datetime({ offset: true }).optional(),
  effectiveTo: z.string().datetime({ offset: true }).optional(),
});

const updateMatrixBody = z.object({
  segment: z.string().min(1).max(64).optional(),
  channel: z.string().min(1).max(64).optional(),
  priority: z.number().int().min(0).optional(),
  weightBps: z.number().int().min(0).max(MAX_WEIGHT_BPS).optional(),
  effectiveFrom: z.string().datetime({ offset: true }).nullable().optional(),
  effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
  version: z.number().int().positive(),
});

/** XS-001 — resolve companion products for a customer's current holdings. */
const resolveBody = z.object({
  heldProductIds: z.array(z.string().uuid()).min(1).max(MAX_HELD_PRODUCTS),
  segment: z.string().min(1).max(64).optional(),
  channel: z.string().min(1).max(64).optional(),
  /** Point in time to resolve at. Defaults to now. */
  asOf: z.string().datetime({ offset: true }).optional(),
  /** Suppress companions the customer already holds. Defaults true. */
  excludeHeld: z.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(200).default(20),
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

    const weightError = validateWeightBps(body.weightBps);
    if (weightError) throw new HttpError(422, "MATRIX_INVALID", weightError);

    const windowError = validateEffectiveWindow({
      effectiveFrom: body.effectiveFrom ?? null,
      effectiveTo: body.effectiveTo ?? null,
    });
    if (windowError) throw new HttpError(422, "MATRIX_INVALID", windowError);

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
    const effectiveFrom = body.effectiveFrom === undefined ? null : new Date(body.effectiveFrom);
    const effectiveTo = body.effectiveTo === undefined ? null : new Date(body.effectiveTo);

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        triggerProductId: body.triggerProductId,
        recommendedProductId: body.recommendedProductId,
        segment: body.segment ?? null,
        channel: body.channel ?? null,
        priority: body.priority,
        weightBps: body.weightBps,
        effectiveFrom,
        effectiveTo,
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
          weightBps: body.weightBps,
          effectiveFrom: body.effectiveFrom ?? null,
          effectiveTo: body.effectiveTo ?? null,
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
        weightBps: body.weightBps,
        effectiveFrom: body.effectiveFrom ?? null,
        effectiveTo: body.effectiveTo ?? null,
        version: 1,
      },
    });
  });

  /**
   * POST /v1/recommendations/matrix/resolve — XS-001 resolution surface.
   *
   * Read-only: it resolves configuration, it does not record anything as served.
   * POST rather than GET because the holdings list is a body-shaped input, in line
   * with the "POST /search for complex queries" convention.
   */
  app.post("/v1/recommendations/matrix/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REC_ROLES);
    const body = resolveBody.parse(req.body);

    const asOf = body.asOf === undefined ? new Date() : new Date(body.asOf);

    const rows = await repo.listEffectiveForTriggers(
      ctx.tenantId,
      body.heldProductIds,
      asOf,
      MAX_RESOLVE_CELLS,
      {
        ...(body.segment !== undefined ? { segment: body.segment } : {}),
        ...(body.channel !== undefined ? { channel: body.channel } : {}),
      },
    );

    const cells: MatrixCell[] = rows.map((row) => ({
      id: row.id,
      triggerProductId: row.triggerProductId,
      recommendedProductId: row.recommendedProductId,
      segment: row.segment,
      channel: row.channel,
      priority: row.priority,
      weightBps: row.weightBps,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    }));

    const companions = resolveCompanions({
      heldProductIds: body.heldProductIds,
      cells,
      asOf,
      excludeHeld: body.excludeHeld,
    });

    const page = companions.slice(0, body.limit);

    return reply.send({
      data: page,
      meta: {
        page: 1,
        pageSize: body.limit,
        total: companions.length,
        asOf: asOf.toISOString(),
        cellCount: cells.length,
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

    if (body.weightBps !== undefined) {
      const weightError = validateWeightBps(body.weightBps);
      if (weightError) throw new HttpError(422, "MATRIX_INVALID", weightError);
    }

    // The window is validated on the MERGED value: patching only `effectiveTo`
    // must still be checked against the stored `effectiveFrom`, otherwise a
    // partial update could leave an inverted window behind.
    const mergedWindow = {
      effectiveFrom: body.effectiveFrom === undefined ? existing.effectiveFrom : body.effectiveFrom,
      effectiveTo: body.effectiveTo === undefined ? existing.effectiveTo : body.effectiveTo,
    };
    const windowError = validateEffectiveWindow(mergedWindow);
    if (windowError) throw new HttpError(422, "MATRIX_INVALID", windowError);

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.segment !== undefined) patch.segment = body.segment;
    if (body.channel !== undefined) patch.channel = body.channel;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.weightBps !== undefined) patch.weightBps = body.weightBps;
    if (body.effectiveFrom !== undefined) {
      patch.effectiveFrom = body.effectiveFrom === null ? null : new Date(body.effectiveFrom);
    }
    if (body.effectiveTo !== undefined) {
      patch.effectiveTo = body.effectiveTo === null ? null : new Date(body.effectiveTo);
    }

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
