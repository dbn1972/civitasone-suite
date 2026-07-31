import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const FIELD_ROLES = ["field_admin", "field_agent", "super_admin"];

const optimizeBody = z.object({
  assigneeId: z.string().uuid(),
  date: z.string(),
  waypoints: z.array(z.record(z.unknown())).min(2),
});

export async function routeRoutes(app: FastifyInstance): Promise<void> {
  /** Request route optimization for a set of waypoints. */
  app.post("/v1/field/routes/optimize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const body = optimizeBody.parse(req.body);
    return reply.code(202).send({
      data: { id: crypto.randomUUID(), assigneeId: body.assigneeId, date: body.date, optimizedOrder: [] },
      accepted: true,
    });
  });

  /** Get today's route for the authenticated agent. */
  app.get("/v1/field/routes/today", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    return reply.send({ data: null, assigneeId: ctx.actorId, date: new Date().toISOString().slice(0, 10) });
  });
}
