import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateTriggerConfig, type TriggerType } from "./domain.js";
import * as commands from "./commands.js";

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

    return reply.code(202).send(
      await commands.createTrigger(ctx, {
        journeyId: body.journeyId,
        triggerType: body.triggerType,
        config: body.config,
      }),
    );
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

    if (body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "trigger has been modified; retry with current version");
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

    return reply.code(202).send(await commands.updateTrigger(ctx, id, { version: body.version, patch }));
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

    return reply.code(202).send(await commands.deleteTrigger(ctx, id, existing.version));
  });
}
