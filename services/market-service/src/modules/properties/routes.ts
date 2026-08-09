import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const USER_ROLES = ["market_user", "market_admin", "super_admin"];
const ADMIN_ROLES = ["market_admin", "super_admin"];

const createBody = z.object({
  propertyCode: z.string().min(1).max(64),
  marketName: z.string().min(1).max(256),
  propertyType: z.enum(["shop", "stall", "kiosk", "godown"]),
  location: z.object({
    address: z.string().optional(),
    ward: z.string().optional(),
    zone: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }).optional(),
  area: z.string().optional(),
  areaUnit: z.string().default("sqft").optional(),
  floorNumber: z.number().int().optional(),
  monthlyRentMinor: z.number().int().nonnegative().optional(),
});

const updateBody = z.object({
  marketName: z.string().min(1).max(256).optional(),
  monthlyRentMinor: z.number().int().nonnegative().optional(),
  status: z.enum(["available", "allotted", "reserved", "under_maintenance"]).optional(),
  area: z.string().optional(),
  areaUnit: z.string().optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  propertyType: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function propertyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/market/properties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createProperty(ctx, {
      ...body,
      monthlyRentMinor: body.monthlyRentMinor !== undefined ? BigInt(body.monthlyRentMinor) : undefined,
    }));
  });

  app.get("/v1/market/properties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/market/properties/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `market:${ctx.tenantId}:property:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property not found");
    return reply.send({ data: row });
  });

  app.patch("/v1/market/properties/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property not found");
    return reply.code(202).send(await commands.updateProperty(ctx, id, {
      ...body,
      monthlyRentMinor: body.monthlyRentMinor !== undefined ? BigInt(body.monthlyRentMinor) : undefined,
    }));
  });
}
