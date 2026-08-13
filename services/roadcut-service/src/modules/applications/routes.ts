import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ROADCUT_ROLES = ["roadcut_user", "roadcut_admin", "super_admin"];

const createBody = z.object({
  applicantName: z.string().min(1).max(256),
  applicantOrg: z.string().max(256).optional(),
  purpose: z.enum(["water_pipe", "sewer_pipe", "gas_pipe", "telecom", "electricity", "other"]),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    address: z.string().min(1),
    ward: z.string().optional(),
    zone: z.string().optional(),
  }),
  roadType: z.enum(["arterial", "sub_arterial", "collector", "local"]),
  cuttingLength: z.string().min(1),
  cuttingWidth: z.string().min(1),
  cuttingDepth: z.string().min(1),
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
  app.post("/v1/roadcut/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createApplication(ctx, body));
  });

  app.get("/v1/roadcut/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/roadcut/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `roadcut:${ctx.tenantId}:application:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    return reply.send({ data: row });
  });

  app.post("/v1/roadcut/applications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.status !== "draft") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot submit application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.submitApplication(ctx, id));
  });

  app.post("/v1/roadcut/applications/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.status !== "draft") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.withdrawApplication(ctx, id));
  });
}
