import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { validateTransition, validateActivation, validateEditable, type JourneyStatus } from "./domain.js";

const JOURNEY_ROLES = ["journey_admin", "marketing_admin", "super_admin"];

const createJourneyBody = z.object({
  name: z.string().min(1).max(200),
  triggerConfig: z.record(z.unknown()).optional(),
  steps: z.array(z.record(z.unknown())).default([]),
});

const updateJourneyBody = z.object({
  name: z.string().min(1).max(200).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  steps: z.array(z.record(z.unknown())).optional(),
  version: z.number().int().positive(),
});

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

export async function journeyRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/journeys — create journey
  app.post("/v1/journeys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const body = createJourneyBody.parse(req.body);
    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        status: "draft",
        triggerConfig: body.triggerConfig ?? null,
        steps: body.steps,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.journeyStarted,
        eventType: "journey.journey.created",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { journeyId: id, name: body.name },
      });
    });

    return reply.code(201).send({
      data: { id, tenantId: ctx.tenantId, name: body.name, status: "draft", steps: body.steps, triggerConfig: body.triggerConfig ?? null, version: 1 },
    });
  });

  // GET /v1/journeys — list with pagination
  app.get("/v1/journeys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.status !== undefined ? { status: q.status } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // GET /v1/journeys/:id — get single journey
  app.get("/v1/journeys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "journey", id);
    const journey = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));

    if (!journey) {
      throw new HttpError(404, "NOT_FOUND", "journey not found");
    }

    return reply.send({ data: repo.toView(journey) });
  });

  // PATCH /v1/journeys/:id — update draft journey
  app.patch("/v1/journeys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateJourneyBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "journey not found");
    }

    const editError = validateEditable(existing.status as JourneyStatus);
    if (editError) {
      throw new HttpError(422, "NOT_EDITABLE", editError);
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch["name"] = body.name;
    if (body.triggerConfig !== undefined) patch["triggerConfig"] = body.triggerConfig;
    if (body.steps !== undefined) patch["steps"] = body.steps;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "journey has been modified; retry with current version");
      }
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "journey", id));
    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // DELETE /v1/journeys/:id — archive (soft-delete) a journey
  app.delete("/v1/journeys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "journey not found");
    }

    const transitionError = validateTransition(existing.status as JourneyStatus, "archived");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.softDelete(tx, id, ctx.tenantId, existing.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "journey has been modified; retry with current version");
      }
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "journey", id));
    return reply.send({ data: { id, status: "archived" } });
  });

  // POST /v1/journeys/:id/activate — activate a draft/paused journey
  app.post("/v1/journeys/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "journey not found");
    }

    const transitionError = validateTransition(existing.status as JourneyStatus, "active");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    const activationError = validateActivation(existing.steps);
    if (activationError) {
      throw new HttpError(422, "ACTIVATION_INVALID", activationError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, { status: "active", updatedBy: ctx.actorId }, existing.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "journey has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.journeyStarted,
        eventType: EVENTS.journeyStarted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { journeyId: id },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "journey", id));
    return reply.send({ data: { id, status: "active" } });
  });

  // POST /v1/journeys/:id/pause — pause an active journey
  app.post("/v1/journeys/:id/pause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "journey not found");
    }

    const transitionError = validateTransition(existing.status as JourneyStatus, "paused");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, { status: "paused", updatedBy: ctx.actorId }, existing.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "journey has been modified; retry with current version");
      }
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "journey", id));
    return reply.send({ data: { id, status: "paused" } });
  });
}
