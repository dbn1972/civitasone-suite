import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

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

  app.get("/v1/catalogue/rates/current", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = currentQuery.parse(req.query);
    const rate = await repo.findCurrentRate(q.productId, ctx.tenantId);
    if (!rate) throw new HttpError(404, "NOT_FOUND", "No current rate found for this product");
    return reply.send({ data: rate });
  });

  app.post("/v1/catalogue/rates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRateBody.parse(req.body);
    return reply.code(202).send(
      await commands.createRate(ctx, {
        productId: body.productId,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
        rateValueMinor: body.rateValueMinor.toString(),
        source: body.source,
      }),
    );
  });

  app.patch("/v1/catalogue/rates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Rate not found");

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    const eventPatch: Record<string, unknown> = {};
    if (body.effectiveFrom !== undefined) {
      patch["effectiveDate"] = body.effectiveFrom;
      eventPatch["effectiveFrom"] = body.effectiveFrom;
    }
    if (body.effectiveTo !== undefined) {
      patch["effectiveTo"] = body.effectiveTo;
      eventPatch["effectiveTo"] = body.effectiveTo;
    }
    if (body.rateValueMinor !== undefined) {
      patch["rateValue"] = body.rateValueMinor.toString();
      eventPatch["rateValueMinor"] = body.rateValueMinor.toString();
    }
    if (body.source !== undefined) {
      patch["source"] = body.source;
      eventPatch["source"] = body.source;
    }

    if (body.version !== undefined && body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "Rate has been modified; retry with current version");
    }
    const expectedVersion = body.version ?? existing.version;
    return reply.code(202).send(
      await commands.updateRate(ctx, id, {
        version: expectedVersion,
        productId: existing.productId,
        patch,
        eventPatch,
      }),
    );
  });
}
