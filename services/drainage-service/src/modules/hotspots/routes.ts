import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateHotspotTransition, type HotspotStatus } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["drainage_user", "drainage_admin", "super_admin"];
const ADMIN_ROLES = ["drainage_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

const identifyBody = z.object({
  location: z.record(z.unknown()).optional(),
  category: z.string().max(32).optional(),
  complaintCount: z.number().int().nonnegative(),
  riskScore: z.number().int().min(0).max(100),
});

const statusBody = z.object({
  status: z.enum(["action_planned", "work_in_progress"]),
  maintenancePlanRef: z.string().max(128).optional(),
  version: z.number().int().positive(),
});

const resolveBody = z.object({ version: z.number().int().positive() });

export async function hotspotRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/drainage/hotspots", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = identifyBody.parse(req.body);
    return reply.code(202).send(await commands.identifyHotspot(ctx, {
      location: body.location ?? null, category: body.category ?? null,
      complaintCount: body.complaintCount, riskScore: body.riskScore,
    }));
  });

  app.get("/v1/drainage/hotspots", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/drainage/hotspots/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const hotspot = await repo.findById(id, ctx.tenantId);
    if (!hotspot) throw new HttpError(404, "NOT_FOUND", "hotspot not found");
    return reply.send({ data: repo.toView(hotspot) });
  });

  app.post("/v1/drainage/hotspots/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = statusBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "hotspot not found");
    const err = validateHotspotTransition(existing.status as HotspotStatus, body.status as HotspotStatus);
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.updateHotspotStatus(ctx, id, body.status, body.maintenancePlanRef ?? null, body.version));
  });

  app.post("/v1/drainage/hotspots/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "hotspot not found");
    const err = validateHotspotTransition(existing.status as HotspotStatus, "resolved");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.resolveHotspot(ctx, id, body.version));
  });
}
