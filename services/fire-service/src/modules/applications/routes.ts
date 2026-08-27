import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const FIRE_ROLES = ["fire_user", "fire_admin", "super_admin"];

const createBody = z.object({
  buildingName: z.string().min(1).max(256),
  buildingAddress: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    pin: z.string().min(6).max(6),
    ward: z.string().optional(),
    zone: z.string().optional(),
  }),
  occupancyType: z.enum(["residential", "commercial", "industrial", "assembly", "institutional", "mixed"]),
  buildingHeight: z.string().optional(),
  numberOfFloors: z.number().int().nonnegative().optional(),
  builtUpArea: z.string().optional(),
  fireSafetyMeasures: z.record(z.unknown()).optional(),
  documents: z.array(z.object({
    docType: z.string(),
    fileId: z.string().uuid(),
    uploadedAt: z.string().datetime(),
  })).optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/fire/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createApplication(ctx, body));
  });

  app.get("/v1/fire/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { total, limit: q.limit ?? 25, offset: q.offset ?? 0 } });
  });

  app.get("/v1/fire/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `fire:${ctx.tenantId}:application:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(ctx.tenantId, id));
    if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    return reply.send({ data: row });
  });

  app.post("/v1/fire/applications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.status !== "draft") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot submit application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.submitApplication(ctx, id));
  });

  app.post("/v1/fire/applications/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!["draft", "submitted", "under_review"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.withdrawApplication(ctx, id));
  });
}
