import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as taskRepo from "../tasks/repo.js";
import { validateCheckIn, validateCheckOut, calculateDurationMinutes, classifyVisitOutcome } from "./domain.js";
import * as commands from "./commands.js";

const FIELD_ROLES = ["field_admin", "field_agent", "super_admin"];

const checkInBody = z.object({
  taskId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const checkOutBody = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().max(2000).optional(),
  photos: z.array(z.string()).max(10).default([]),
});

const idParam = z.object({ id: z.string().uuid() });

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const taskIdParam = z.object({ taskId: z.string().uuid() });
const agentIdParam = z.object({ agentId: z.string().uuid() });

export async function visitRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/field/visits/check-in — record check-in at location
  app.post("/v1/field/visits/check-in", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const body = checkInBody.parse(req.body);

    const locationError = validateCheckIn({ latitude: body.latitude, longitude: body.longitude });
    if (locationError) {
      throw new HttpError(422, "INVALID_LOCATION", locationError);
    }

    const task = await taskRepo.findById(body.taskId, ctx.tenantId);
    if (!task) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }

    return reply.code(202).send(
      await commands.checkIn(ctx, {
        taskId: body.taskId,
        latitude: body.latitude,
        longitude: body.longitude,
        checkInAt: new Date().toISOString(),
      }),
    );
  });

  // POST /v1/field/visits/:id/check-out — record check-out
  app.post("/v1/field/visits/:id/check-out", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);
    const body = checkOutBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "visit not found");
    }

    const checkOutAt = new Date();
    const checkOutError = validateCheckOut(existing.checkInAt?.toISOString() ?? null, checkOutAt.toISOString());
    if (checkOutError) {
      throw new HttpError(422, "INVALID_CHECKOUT", checkOutError);
    }

    const durationMinutes = calculateDurationMinutes(existing.checkInAt!.toISOString(), checkOutAt.toISOString());
    const outcome = classifyVisitOutcome(durationMinutes);

    return reply.code(202).send(
      await commands.checkOut(ctx, id, {
        taskId: existing.taskId,
        checkOutAt: checkOutAt.toISOString(),
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        notes: body.notes ?? null,
        photos: body.photos,
        durationMinutes,
        outcome,
        version: existing.version,
      }),
    );
  });

  // GET /v1/field/visits/by-task/:taskId — history by task
  app.get("/v1/field/visits/by-task/:taskId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { taskId } = taskIdParam.parse(req.params);
    const q = historyQuery.parse(req.query);

    const { rows, total } = await repo.findByTaskId(taskId, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // GET /v1/field/visits/by-agent/:agentId — history by agent
  app.get("/v1/field/visits/by-agent/:agentId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { agentId } = agentIdParam.parse(req.params);
    const q = historyQuery.parse(req.query);

    const { rows, total } = await repo.findByAgent(agentId, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // GET /v1/field/visits/:id — get single visit
  app.get("/v1/field/visits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);

    const visit = await repo.findById(id, ctx.tenantId);
    if (!visit) {
      throw new HttpError(404, "NOT_FOUND", "visit not found");
    }

    return reply.send({ data: repo.toView(visit) });
  });
}
