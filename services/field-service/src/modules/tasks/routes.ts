import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { validateTransition, validateAssignment, type TaskStatus } from "./domain.js";

const FIELD_ROLES = ["field_admin", "field_agent", "super_admin"];
const ADMIN_ROLES = ["field_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
});

const createTaskBody = z.object({
  assigneeId: z.string().uuid().optional(),
  taskType: z.string().min(1).max(64),
  title: z.string().min(1).max(256),
  description: z.string().max(4000).optional(),
  priority: z.number().int().min(1).max(5).default(3),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  address: z.string().max(500).optional(),
  dueDate: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateTaskBody = z.object({
  title: z.string().min(1).max(256).optional(),
  description: z.string().max(4000).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  address: z.string().max(500).optional(),
  dueDate: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive(),
});

const assignBody = z.object({
  assigneeId: z.string().uuid(),
  version: z.number().int().positive(),
});

const transitionBody = z.object({
  version: z.number().int().positive(),
});

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/field/tasks — create a new task
  app.post("/v1/field/tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createTaskBody.parse(req.body);
    const id = randomUUID();
    const status: TaskStatus = body.assigneeId ? "assigned" : "unassigned";

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        assigneeId: body.assigneeId ?? null,
        taskType: body.taskType,
        title: body.title,
        description: body.description ?? null,
        status,
        priority: body.priority,
        latitude: body.latitude?.toString() ?? null,
        longitude: body.longitude?.toString() ?? null,
        address: body.address ?? null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        metadata: body.metadata ?? null,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.taskCreated,
        eventType: EVENTS.taskCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { taskId: id, taskType: body.taskType, assigneeId: body.assigneeId ?? null, status },
      });
    });

    return reply.code(201).send({
      data: { id, tenantId: ctx.tenantId, status, taskType: body.taskType, title: body.title, version: 1 },
    });
  });

  // GET /v1/field/tasks — list tasks with filters
  app.get("/v1/field/tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      status: q.status,
      assigneeId: q.assigneeId,
      dueBefore: q.dueBefore,
      dueAfter: q.dueAfter,
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // GET /v1/field/tasks/my — tasks for current user
  app.get("/v1/field/tasks/my", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      assigneeId: ctx.actorId,
      status: q.status,
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // GET /v1/field/tasks/:id — get single task
  app.get("/v1/field/tasks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "task", id);
    const task = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));

    if (!task) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }

    return reply.send({ data: repo.toView(task) });
  });

  // PATCH /v1/field/tasks/:id — update task details
  app.patch("/v1/field/tasks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateTaskBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.latitude !== undefined) patch.latitude = body.latitude.toString();
    if (body.longitude !== undefined) patch.longitude = body.longitude.toString();
    if (body.address !== undefined) patch.address = body.address;
    if (body.dueDate !== undefined) patch.dueDate = new Date(body.dueDate);
    if (body.metadata !== undefined) patch.metadata = body.metadata;

    const updated = await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "task has been modified; retry with current version");
      }
      return true;
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "task", id));
    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // POST /v1/field/tasks/:id/assign — assign a task
  app.post("/v1/field/tasks/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }

    const assignError = validateAssignment(existing.status as TaskStatus, existing.assigneeId, body.assigneeId);
    if (assignError) {
      throw new HttpError(422, "ASSIGNMENT_INVALID", assignError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { assigneeId: body.assigneeId, status: "assigned", updatedBy: ctx.actorId },
        body.version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "task has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.taskCreated,
        eventType: EVENTS.taskCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { taskId: id, assigneeId: body.assigneeId, action: "assigned" },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "task", id));
    return reply.send({ data: { id, assigneeId: body.assigneeId, status: "assigned", version: body.version + 1 } });
  });

  // POST /v1/field/tasks/:id/start — start a task
  app.post("/v1/field/tasks/:id/start", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }

    const transitionError = validateTransition(existing.status as TaskStatus, "in_progress");
    if (transitionError) {
      throw new HttpError(422, "TRANSITION_INVALID", transitionError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, { status: "in_progress", updatedBy: ctx.actorId }, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "task has been modified; retry with current version");
      }
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "task", id));
    return reply.send({ data: { id, status: "in_progress", version: body.version + 1 } });
  });

  // POST /v1/field/tasks/:id/complete — complete a task
  app.post("/v1/field/tasks/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }

    const transitionError = validateTransition(existing.status as TaskStatus, "completed");
    if (transitionError) {
      throw new HttpError(422, "TRANSITION_INVALID", transitionError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { status: "completed", completedAt: new Date(), updatedBy: ctx.actorId },
        body.version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "task has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.taskCompleted,
        eventType: EVENTS.taskCompleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { taskId: id, completedAt: new Date().toISOString() },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "task", id));
    return reply.send({ data: { id, status: "completed", version: body.version + 1 } });
  });

  // POST /v1/field/tasks/:id/cancel — cancel a task
  app.post("/v1/field/tasks/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }

    const transitionError = validateTransition(existing.status as TaskStatus, "cancelled");
    if (transitionError) {
      throw new HttpError(422, "TRANSITION_INVALID", transitionError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { status: "cancelled", cancelledAt: new Date(), updatedBy: ctx.actorId },
        body.version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "task has been modified; retry with current version");
      }
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "task", id));
    return reply.send({ data: { id, status: "cancelled", version: body.version + 1 } });
  });

  // DELETE /v1/field/tasks/:id — soft-cancel a task (same as cancel for field tasks)
  app.delete("/v1/field/tasks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "task not found");
    }

    const transitionError = validateTransition(existing.status as TaskStatus, "cancelled");
    if (transitionError) {
      throw new HttpError(422, "TRANSITION_INVALID", transitionError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { status: "cancelled", cancelledAt: new Date(), updatedBy: ctx.actorId },
        existing.version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "task has been modified; retry with current version");
      }
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "task", id));
    return reply.send({ data: { id, status: "cancelled" } });
  });
}
