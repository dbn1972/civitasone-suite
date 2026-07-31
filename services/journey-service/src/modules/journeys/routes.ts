import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

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
  app.post("/v1/journeys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const body = createJourneyBody.parse(req.body);
    return reply.code(202).send({ data: { id: crypto.randomUUID(), ...body }, accepted: true });
  });

  app.get("/v1/journeys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const _q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: _q.limit, total: 0 } });
  });

  app.get("/v1/journeys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    // placeholder — will query DB
    return reply.send({ data: { id, status: "draft" } });
  });

  app.patch("/v1/journeys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateJourneyBody.parse(req.body);
    return reply.code(202).send({ data: { id, ...body }, accepted: true });
  });

  app.delete("/v1/journeys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send({ data: { id }, accepted: true });
  });

  app.post("/v1/journeys/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send({ data: { id, status: "active" }, accepted: true });
  });

  app.post("/v1/journeys/:id/pause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.code(202).send({ data: { id, status: "paused" }, accepted: true });
  });
}
