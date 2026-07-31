import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { optimizeRouteOrder, scoreRoute, type Waypoint } from "./domain.js";

const FIELD_ROLES = ["field_admin", "field_agent", "super_admin"];
const ADMIN_ROLES = ["field_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });

const waypointSchema = z.object({
  taskId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  priority: z.number().int().min(1).max(5).default(3),
  windowStart: z.string().optional(),
  windowEnd: z.string().optional(),
});

const generateBody = z.object({
  assigneeId: z.string().uuid(),
  date: z.string(), // YYYY-MM-DD
  waypoints: z.array(waypointSchema).min(2).max(50),
});

const reorderBody = z.object({
  optimizedOrder: z.array(z.number().int().min(0)),
  version: z.number().int().positive(),
});

const routeQuery = z.object({
  assigneeId: z.string().uuid(),
  date: z.string(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function routeRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/field/routes — generate optimized route
  app.post("/v1/field/routes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = generateBody.parse(req.body);

    const waypoints: Waypoint[] = body.waypoints.map((w) => ({
      taskId: w.taskId,
      latitude: w.latitude,
      longitude: w.longitude,
      priority: w.priority,
      windowStart: w.windowStart,
      windowEnd: w.windowEnd,
    }));

    const optimizedOrder = optimizeRouteOrder(waypoints);
    const score = scoreRoute(waypoints, optimizedOrder);
    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        assigneeId: body.assigneeId,
        routeDate: body.date,
        status: "optimized",
        waypoints: body.waypoints as unknown as Array<Record<string, unknown>>,
        optimizedOrder,
        totalDistanceKm: score.totalDistanceKm.toString(),
        estimatedDurationMinutes: score.estimatedDurationMinutes,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.routeOptimized,
        eventType: EVENTS.routeOptimized,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { routeId: id, assigneeId: body.assigneeId, date: body.date, score },
      });
    });

    return reply.code(201).send({
      data: {
        id,
        assigneeId: body.assigneeId,
        routeDate: body.date,
        status: "optimized",
        optimizedOrder,
        totalDistanceKm: score.totalDistanceKm,
        estimatedDurationMinutes: score.estimatedDurationMinutes,
        version: 1,
      },
    });
  });

  // GET /v1/field/routes — list routes
  app.get("/v1/field/routes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  // GET /v1/field/routes/by-agent — get route for agent+date
  app.get("/v1/field/routes/by-agent", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const q = routeQuery.parse(req.query);

    const route = await repo.findByAssigneeAndDate(q.assigneeId, q.date, ctx.tenantId);
    if (!route) {
      throw new HttpError(404, "NOT_FOUND", "no route found for this agent and date");
    }

    return reply.send({ data: repo.toView(route) });
  });

  // GET /v1/field/routes/today — today's route for authenticated agent
  app.get("/v1/field/routes/today", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const today = new Date().toISOString().slice(0, 10);

    const route = await repo.findByAssigneeAndDate(ctx.actorId, today, ctx.tenantId);
    if (!route) {
      return reply.send({ data: null, assigneeId: ctx.actorId, date: today });
    }

    return reply.send({ data: repo.toView(route) });
  });

  // GET /v1/field/routes/:id — get route by ID
  app.get("/v1/field/routes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);

    const route = await repo.findById(id, ctx.tenantId);
    if (!route) {
      throw new HttpError(404, "NOT_FOUND", "route not found");
    }

    return reply.send({ data: repo.toView(route) });
  });

  // PATCH /v1/field/routes/:id/reorder — manually reorder waypoints
  app.patch("/v1/field/routes/:id/reorder", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reorderBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "route not found");
    }

    // Validate that reorder indices are valid
    const waypointCount = existing.waypoints.length;
    if (body.optimizedOrder.length !== waypointCount) {
      throw new HttpError(422, "INVALID_ORDER", `order must have exactly ${waypointCount} indices`);
    }

    const indices = new Set(body.optimizedOrder);
    if (indices.size !== waypointCount || body.optimizedOrder.some((i) => i >= waypointCount)) {
      throw new HttpError(422, "INVALID_ORDER", "order must contain each index 0..n-1 exactly once");
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { optimizedOrder: body.optimizedOrder, updatedBy: ctx.actorId },
        body.version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "route has been modified; retry with current version");
      }
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "route", id));
    return reply.send({ data: { id, optimizedOrder: body.optimizedOrder, version: body.version + 1 } });
  });
}
