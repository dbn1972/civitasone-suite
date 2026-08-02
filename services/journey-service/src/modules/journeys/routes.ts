import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { validateTransition, validateActivation, validateEditable, type JourneyStatus } from "./domain.js";
import * as commands from "./commands.js";

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

    return reply.code(202).send(
      await commands.createJourney(ctx, {
        name: body.name,
        triggerConfig: body.triggerConfig ?? null,
        steps: body.steps,
      }),
    );
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

    if (body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "journey has been modified; retry with current version");
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch["name"] = body.name;
    if (body.triggerConfig !== undefined) patch["triggerConfig"] = body.triggerConfig;
    if (body.steps !== undefined) patch["steps"] = body.steps;

    return reply.code(202).send(await commands.updateJourney(ctx, id, { version: body.version, patch }));
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

    return reply.code(202).send(await commands.deleteJourney(ctx, id, existing.version));
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

    return reply.code(202).send(await commands.activateJourney(ctx, id, existing.version));
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

    return reply.code(202).send(await commands.pauseJourney(ctx, id, existing.version));
  });
}
