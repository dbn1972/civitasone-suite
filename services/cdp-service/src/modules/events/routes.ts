import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin"];

const ingestBody = z.object({
  profileId: z.string().uuid(),
  eventType: z.string().min(1).max(128),
  payload: z.record(z.unknown()).default({}),
  occurredAt: z.string().datetime(),
});

const profileEventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  eventType: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/cdp/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = ingestBody.parse(req.body);
    // Placeholder — publishes event ingestion command to queue
    return reply.code(202).send({ accepted: true, message: "event ingestion queued" });
  });

  app.get("/v1/cdp/profiles/:id/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);
    const q = profileEventsQuery.parse(req.query);
    // Placeholder — returns events for a specific profile
    return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, total: 0 } });
  });
}
