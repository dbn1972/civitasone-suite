import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canTransition } from "./domain.js";

const EVENT_ROLES = ["event_user", "event_admin", "super_admin"];

const createBody = z.object({
  organiserName: z.string().min(1).max(256),
  organiserOrg: z.string().max(256).optional(),
  organiserPhone: z.string().min(10).max(15),
  eventType: z.enum(["cultural", "religious", "sports", "political", "commercial", "government"]),
  venueName: z.string().min(1).max(256),
  venueAddress: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    pin: z.string().min(6).max(6),
    ward: z.string().optional(),
    zone: z.string().optional(),
  }),
  startDate: z.string(),
  endDate: z.string(),
  expectedAttendance: z.number().int().positive(),
  temporaryStructures: z.array(z.object({
    type: z.string(),
    count: z.number().int().positive(),
    areaSqft: z.number().nonnegative().optional(),
  })).optional(),
  soundPermission: z.boolean().optional(),
  documents: z.array(z.object({
    docType: z.string(),
    fileId: z.string().uuid(),
    uploadedAt: z.string().datetime(),
  })).optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/event/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVENT_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createApplication(ctx, body));
  });

  app.get("/v1/event/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVENT_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/event/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVENT_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `event:${ctx.tenantId}:application:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    return reply.send({ data: row });
  });

  app.post("/v1/event/applications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVENT_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canTransition(existing.status, "submitted")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot submit application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.submitApplication(ctx, id));
  });

  app.post("/v1/event/applications/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVENT_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canTransition(existing.status, "withdrawn")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.withdrawApplication(ctx, id));
  });
}
