import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
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
    const id = crypto.randomUUID();
    const { db: database } = await import("../../shared/db.js");
    await repo.insertRate(
      { insert: database.insert, update: database.update, select: database.select },
      {
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
      },
    );
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

    const { db: database } = await import("../../shared/db.js");
    await repo.updateRate(
      { insert: database.insert, update: database.update, select: database.select },
      id,
      ctx.tenantId,
      patch as Partial<typeof existing>,
      existing.version,
    );
    return reply.send({ data: { id, version: existing.version + 1 } });
  });
}

declare const crypto: { randomUUID(): string };
