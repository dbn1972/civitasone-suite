import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const USER_ROLES = ["crematorium_user", "crematorium_admin", "super_admin"];
const ADMIN_ROLES = ["crematorium_admin", "super_admin"];

const createBody = z.object({
  facilityName: z.string().min(1).max(256),
  facilityType: z.enum(["crematorium", "burial_ground", "electric_crematorium"]),
  address: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    pin: z.string().min(6).max(6),
    ward: z.string().optional(),
  }),
  ward: z.string().optional(),
  totalSlots: z.number().int().positive(),
  operatingHours: z.object({
    open: z.string(),
    close: z.string(),
    days: z.array(z.string()).optional(),
  }).optional(),
  contactPerson: z.string().optional(),
  contactPhone: z.string().optional(),
});

const updateBody = z.object({
  facilityName: z.string().min(1).max(256).optional(),
  totalSlots: z.number().int().positive().optional(),
  operatingHours: z.object({
    open: z.string(),
    close: z.string(),
    days: z.array(z.string()).optional(),
  }).optional(),
  contactPerson: z.string().optional(),
  contactPhone: z.string().optional(),
  status: z.enum(["active", "under_maintenance", "closed"]).optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function facilityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crematorium/facilities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createFacility(ctx, body));
  });

  app.get("/v1/crematorium/facilities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/crematorium/facilities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `crematorium:${ctx.tenantId}:facility:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "FACILITY_NOT_FOUND", "Facility not found");
    return reply.send({ data: row });
  });

  app.patch("/v1/crematorium/facilities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "FACILITY_NOT_FOUND", "Facility not found");
    return reply.code(202).send(await commands.updateFacility(ctx, id, body));
  });
}
