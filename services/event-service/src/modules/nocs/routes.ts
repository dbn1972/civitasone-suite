import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canRespond } from "./domain.js";

const ADMIN_ROLES = ["event_admin", "super_admin"];

const requestBody = z.object({
  applicationId: z.string().uuid(),
  department: z.enum(["police", "fire", "traffic", "health", "environment"]),
});

const respondBody = z.object({
  status: z.enum(["approved", "rejected", "conditional"]),
  conditions: z.record(z.unknown()).optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const applicationIdQuery = z.object({ applicationId: z.string().uuid() });

export async function nocRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/event/nocs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = requestBody.parse(req.body);
    return reply.code(202).send(await commands.requestNoc(ctx, body.applicationId, body.department));
  });

  app.get("/v1/event/nocs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = applicationIdQuery.parse(req.query);
    const records = await repo.listByApplication(q.applicationId, ctx.tenantId);
    return reply.send({
      data: records,
      meta: { page: 1, pageSize: records.length, total: records.length },
    });
  });

  app.post("/v1/event/nocs/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = respondBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOC_NOT_FOUND", "NOC request not found");
    if (!canRespond(existing.status)) {
      throw new HttpError(422, "ALREADY_RESPONDED", "NOC already responded");
    }
    return reply.code(202).send(await commands.respondNoc(ctx, id, body.status, body.conditions));
  });
}
