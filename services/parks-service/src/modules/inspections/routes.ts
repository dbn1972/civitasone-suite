import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ROLES = ["parks_user", "parks_admin", "super_admin"];
const ADMIN_ROLES = ["parks_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

const createBody = z.object({
  complaintId: z.string().uuid().optional(),
  treeRequestId: z.string().uuid().optional(),
  scheduledDate: z.string().optional(),
});

const completeBody = z.object({
  findings: z.record(z.unknown()),
  photos: z.array(z.string().max(512)).optional(),
  workOrderRequired: z.boolean(),
  version: z.number().int().positive(),
});

export async function inspectionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/parks/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createInspection(ctx, {
      complaintId: body.complaintId ?? null,
      treeRequestId: body.treeRequestId ?? null,
      scheduledDate: body.scheduledDate ?? null,
    }));
  });

  app.get("/v1/parks/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/parks/inspections/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const inspection = await repo.findById(id, ctx.tenantId);
    if (!inspection) throw new HttpError(404, "NOT_FOUND", "inspection not found");
    return reply.send({ data: repo.toView(inspection) });
  });

  app.post("/v1/parks/inspections/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "inspection not found");
    if (existing.status === "completed") throw new HttpError(422, "ALREADY_COMPLETED", "inspection already completed");
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.completeInspection(ctx, id, body.findings, body.photos ?? null, body.workOrderRequired, body.version));
  });
}
