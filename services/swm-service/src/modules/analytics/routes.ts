import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateHotspotTransition, type HotspotStatus } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["swm_user", "swm_admin", "super_admin"];
const ADMIN_ROLES = ["swm_admin", "super_admin"];
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
});

const resolveBody = z.object({ version: z.number().int().positive() });

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/swm/hotspots", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = identifyBody.parse(req.body);
    return reply.code(202).send(await commands.identifyHotspot(ctx, {
      location: body.location ?? null, category: body.category ?? null,
      complaintCount: body.complaintCount,
    }));
  });

  app.get("/v1/swm/hotspots", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/swm/hotspots/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const hotspot = await repo.findById(id, ctx.tenantId);
    if (!hotspot) throw new HttpError(404, "NOT_FOUND", "hotspot not found");
    return reply.send({ data: repo.toView(hotspot) });
  });

  app.post("/v1/swm/hotspots/:id/resolve", async (req, reply) => {
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
