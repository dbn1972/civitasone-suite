import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

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
  app.post("/v1/journeys/triggers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const body = createTriggerBody.parse(req.body);
    return reply.code(202).send({ data: { id: crypto.randomUUID(), ...body }, accepted: true });
  });

  app.get("/v1/journeys/triggers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const _q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: _q.limit, total: 0 } });
  });

  app.get("/v1/journeys/triggers/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: { id, triggerType: "event_based", status: "active" } });
  });

  app.patch("/v1/journeys/triggers/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateTriggerBody.parse(req.body);
    return reply.code(202).send({ data: { id, ...body }, accepted: true });
  });

  app.delete("/v1/journeys/triggers/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send({ data: { id }, accepted: true });
  });
}
