import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const CATALOGUE_ROLES = ["catalogue_user", "catalogue_admin", "super_admin"];
const ADMIN_ROLES = ["catalogue_admin", "super_admin"];

const createRateBody = z.object({
  productId: z.string().uuid(),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().optional(),
  rateValueMinor: z.coerce.bigint(),
  source: z.string().min(1).max(128),
});

const updateRateBody = z.object({
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().nullable().optional(),
  rateValueMinor: z.coerce.bigint().optional(),
  source: z.string().min(1).max(128).optional(),
  /** Optional optimistic-lock guard. Falls back to the row's current version. */
  version: z.number().int().positive().optional(),
});

const rateQuery = z.object({
  productId: z.string().uuid(),
  date: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const currentQuery = z.object({
  productId: z.string().uuid(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function rateRoutes(app: FastifyInstance): Promise<void> {
  // List rates for a product with optional date filter
  app.get("/v1/catalogue/rates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = rateQuery.parse(req.query);
    const { rows, total } = await repo.listRates({
      tenantId: ctx.tenantId,
      productId: q.productId,
      limit: q.limit,
      offset: q.offset,
      date: q.date,
    });
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows, meta: { page, pageSize: q.limit, total } });
  });

  // Get currently effective rate for a product
  app.get("/v1/catalogue/rates/current", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = currentQuery.parse(req.query);
    const rate = await repo.findCurrentRate(q.productId, ctx.tenantId);
    if (!rate) throw new HttpError(404, "NOT_FOUND", "No current rate found for this product");
    return reply.send({ data: rate });
  });

  // Create rate entry
  app.post("/v1/catalogue/rates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRateBody.parse(req.body);
    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insertRate(tx, {
        id,
        tenantId: ctx.tenantId,
        productId: body.productId,
        effectiveDate: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
        rateValue: body.rateValueMinor,
        source: body.source,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.rateCreated,
        eventType: EVENTS.rateCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          rateId: id,
          productId: body.productId,
          effectiveFrom: body.effectiveFrom,
          effectiveTo: body.effectiveTo ?? null,
          // bigint paise — serialised as a string so the jsonb payload stays JSON-safe.
          rateValueMinor: body.rateValueMinor.toString(),
          source: body.source,
        },
      });
    });

    return reply.code(201).send({ data: { id } });
  });

  // Update rate (creates new version for audit trail)
  app.patch("/v1/catalogue/rates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Rate not found");

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.effectiveFrom !== undefined) patch["effectiveDate"] = body.effectiveFrom;
    if (body.effectiveTo !== undefined) patch["effectiveTo"] = body.effectiveTo;
    if (body.rateValueMinor !== undefined) patch["rateValue"] = body.rateValueMinor;
    if (body.source !== undefined) patch["source"] = body.source;

    const expectedVersion = body.version ?? existing.version;

    await db.transaction(async (tx) => {
      const ok = await repo.updateRate(tx, id, ctx.tenantId, patch as Partial<typeof existing>, expectedVersion);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "Rate has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.rateUpdated,
        eventType: EVENTS.rateUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          rateId: id,
          productId: existing.productId,
          previousVersion: expectedVersion,
          ...(body.effectiveFrom !== undefined ? { effectiveFrom: body.effectiveFrom } : {}),
          ...(body.effectiveTo !== undefined ? { effectiveTo: body.effectiveTo } : {}),
          // bigint paise — serialised as a string so the jsonb payload stays JSON-safe.
          ...(body.rateValueMinor !== undefined ? { rateValueMinor: body.rateValueMinor.toString() } : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
        },
      });
    });

    return reply.send({ data: { id, version: expectedVersion + 1 } });
  });
}
