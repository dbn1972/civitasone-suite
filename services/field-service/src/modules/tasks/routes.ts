import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const FIELD_ROLES = ["field_admin", "field_agent", "super_admin"];
const ADMIN_ROLES = ["field_admin", "super_admin"];

const createTaskBody = z.object({
  assigneeId: z.string().uuid(),
  taskType: z.string().min(1).max(64),
  location: z.record(z.unknown()).optional(),
  dueDate: z.string().optional(),
});

const updateTaskBody = z.object({
  assigneeId: z.string().uuid().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  location: z.record(z.unknown()).optional(),
  dueDate: z.string().optional(),
  version: z.number().int().positive(),
});

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
});

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/field/tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createTaskBody.parse(req.body);
    return reply.code(202).send({ data: { id: crypto.randomUUID(), ...body }, accepted: true });
  });

  app.get("/v1/field/tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const _q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: _q.limit, total: 0 } });
  });

  /** Tasks assigned to the current authenticated user. */
  app.get("/v1/field/tasks/my", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    // Filter by ctx.actorId as assignee
    return reply.send({ data: [], meta: { page: 1, pageSize: 20, total: 0 }, assigneeId: ctx.actorId });
  });

  app.get("/v1/field/tasks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: { id, status: "pending" } });
  });

  app.patch("/v1/field/tasks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateTaskBody.parse(req.body);
    return reply.code(202).send({ data: { id, ...body }, accepted: true });
  });

  app.delete("/v1/field/tasks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send({ data: { id }, accepted: true });
  });
}
