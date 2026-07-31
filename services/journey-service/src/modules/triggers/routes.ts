import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { validateTriggerConfig, type TriggerType } from "./domain.js";

const JOURNEY_ROLES = ["journey_admin", "marketing_admin", "super_admin"];

const createTriggerBody = z.object({
  journeyId: z.string().uuid(),
  triggerType: z.enum(["event_based", "time_based", "segment_entry"]),
  config: z.record(z.unknown()).default({}),
});

const updateTriggerBody = z.object({
  triggerType: z.enum(["event_based", "time_based", "segment_entry"]).optional(),
  config: z.record(z.unknown()).optional(),
  status: z.enum(["active", "paused"]).optional(),
  version: z.number().int().positive(),
});

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  journeyId: z.string().uuid().optional(),
});

export async function triggerRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/journeys/triggers — create trigger
  app.post("/v1/journeys/triggers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const body = createTriggerBody.parse(req.body);

    // Validate trigger config
    const configError = validateTriggerConfig(body.triggerType as TriggerType, body.config);
    if (configError) {
      throw new HttpError(400, "INVALID_CONFIG", configError);
    }

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        journeyId: body.journeyId,
        triggerType: body.triggerType,
        config: body.config,
        status: "active",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.journeyStarted,
        eventType: "journey.trigger.created",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { triggerId: id, journeyId: body.journeyId, triggerType: body.triggerType },
      });
    });

    return reply.code(201).send({
      data: { id, tenantId: ctx.tenantId, journeyId: body.journeyId, triggerType: body.triggerType, config: body.config, status: "active", version: 1 },
    });
  });

  // GET /v1/journeys/triggers — list triggers
  app.get("/v1/journeys/triggers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.journeyId !== undefined ? { journeyId: q.journeyId } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // GET /v1/journeys/triggers/:id — get single trigger
  app.get("/v1/journeys/triggers/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);

    const trigger = await repo.findById(id, ctx.tenantId);
    if (!trigger) {
      throw new HttpError(404, "NOT_FOUND", "trigger not found");
    }

    return reply.send({ data: repo.toView(trigger) });
  });

  // PATCH /v1/journeys/triggers/:id — update trigger
  app.patch("/v1/journeys/triggers/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateTriggerBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "trigger not found");
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.triggerType !== undefined) patch["triggerType"] = body.triggerType;
    if (body.config !== undefined) patch["config"] = body.config;
    if (body.status !== undefined) patch["status"] = body.status;

    // Validate config if both type and config are being updated
    const triggerType = (body.triggerType ?? existing.triggerType) as TriggerType;
    const config = (body.config ?? existing.config) as Record<string, unknown>;
    const configError = validateTriggerConfig(triggerType, config);
    if (configError) {
      throw new HttpError(400, "INVALID_CONFIG", configError);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "trigger has been modified; retry with current version");
      }
    });

    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // DELETE /v1/journeys/triggers/:id — soft-delete trigger
  app.delete("/v1/journeys/triggers/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "trigger not found");
    }

    await db.transaction(async (tx) => {
      const ok = await repo.softDelete(tx, id, ctx.tenantId, existing.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "trigger has been modified; retry with current version");
      }
    });

    return reply.send({ data: { id, status: "inactive" } });
  });
}
