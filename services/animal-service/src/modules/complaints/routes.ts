import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const USER_ROLES = ["animal_user", "animal_admin", "super_admin"];
const ADMIN_ROLES = ["animal_admin", "super_admin"];

const reportBody = z.object({
  location: z.object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    address: z.string().optional(),
    ward: z.string().optional(),
    landmark: z.string().optional(),
  }),
  animalType: z.enum(["dog", "cattle", "cat", "monkey", "pig", "snake", "other"]),
  complaintType: z.enum(["stray", "injured", "dangerous", "dead", "nuisance", "bite"]),
  description: z.string().optional(),
  photo: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]),
});

const assignBody = z.object({
  assignedTo: z.string().uuid(),
  assignedTeam: z.string().min(1).max(64),
});

const closeBody = z.object({
  resolution: z.string().min(1),
});

const listQuery = z.object({
  status: z.string().optional(),
  severity: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function complaintRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/animal/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = reportBody.parse(req.body);
    return reply.code(202).send(await commands.reportComplaint(ctx, body));
  });

  app.get("/v1/animal/complaints", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/animal/complaints/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `animal:${ctx.tenantId}:complaint:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "COMPLAINT_NOT_FOUND", "Complaint not found");
    return reply.send({ data: row });
  });

  app.post("/v1/animal/complaints/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "COMPLAINT_NOT_FOUND", "Complaint not found");
    if (existing.status !== "reported") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot assign complaint in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.assignComplaint(ctx, id, body.assignedTo, body.assignedTeam));
  });

  app.post("/v1/animal/complaints/:id/dispatch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "COMPLAINT_NOT_FOUND", "Complaint not found");
    if (existing.status !== "assigned") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot dispatch for complaint in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.dispatchTeam(ctx, id));
  });

  app.post("/v1/animal/complaints/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "COMPLAINT_NOT_FOUND", "Complaint not found");
    if (!["dispatched", "action_taken"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot close complaint in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.closeComplaint(ctx, id, body.resolution));
  });
}
