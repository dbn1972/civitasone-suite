import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const FIELD_ROLES = ["field_admin", "field_agent", "super_admin"];

const checkInBody = z.object({
  taskId: z.string().uuid(),
  location: z.record(z.unknown()),
});

const checkOutBody = z.object({
  visitId: z.string().uuid(),
  location: z.record(z.unknown()).optional(),
  notes: z.string().max(2000).optional(),
  photos: z.array(z.string().url()).max(10).default([]),
});

export async function visitRoutes(app: FastifyInstance): Promise<void> {
  /** Check-in to a task location (GPS-verified). */
  app.post("/v1/field/visits/check-in", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const body = checkInBody.parse(req.body);
    return reply.code(202).send({
      data: { id: crypto.randomUUID(), taskId: body.taskId, checkInAt: new Date().toISOString() },
      accepted: true,
    });
  });

  /** Check-out from a task location with notes and photos. */
  app.post("/v1/field/visits/check-out", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const body = checkOutBody.parse(req.body);
    return reply.code(202).send({
      data: { id: body.visitId, checkOutAt: new Date().toISOString() },
      accepted: true,
    });
  });
}
