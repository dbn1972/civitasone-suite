import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ROLES = ["drainage_user", "drainage_admin", "super_admin"];
const ADMIN_ROLES = ["drainage_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const createBody = z.object({
  complaintId: z.string().uuid(),
  actionType: z.enum(["cleaning", "repair", "replacement", "desilting"]),
  drainAssetRef: z.string().max(64).optional(),
  notes: z.string().max(4000).optional(),
  beforePhoto: z.string().max(512).optional(),
  afterPhoto: z.string().max(512).optional(),
  durationMinutes: z.number().int().positive().optional(),
});

export async function fieldActionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/drainage/field-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createFieldAction(ctx, {
      complaintId: body.complaintId, actionType: body.actionType,
      drainAssetRef: body.drainAssetRef ?? null, notes: body.notes ?? null,
      beforePhoto: body.beforePhoto ?? null, afterPhoto: body.afterPhoto ?? null,
      durationMinutes: body.durationMinutes ?? null,
    }));
  });

  app.get("/v1/drainage/field-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/drainage/field-actions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const action = await repo.findById(id, ctx.tenantId);
    if (!action) throw new HttpError(404, "NOT_FOUND", "field action not found");
    return reply.send({ data: repo.toView(action) });
  });

  app.get("/v1/drainage/complaints/:id/field-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await repo.listByComplaint(id, ctx.tenantId);
    return reply.send({ data: rows.map(repo.toView) });
  });
}
