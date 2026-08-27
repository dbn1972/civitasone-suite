import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ADV_ROLES = ["adv_user", "adv_admin", "super_admin"];

const createBody = z.object({
  advertiserName: z.string().min(1),
  advertiserOrg: z.string().min(1),
  advertisementType: z.enum(["hoarding", "banner", "signage", "kiosk", "digital"]),
  location: z.object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    address: z.string().min(1),
    ward: z.string().optional(),
    zone: z.string().optional(),
  }),
  dimensions: z.object({
    widthFt: z.number().positive(),
    heightFt: z.number().positive(),
    areaInSqFt: z.number().positive(),
  }),
  structuralDetails: z.object({
    material: z.string().optional(),
    foundation: z.string().optional(),
    height: z.number().optional(),
    illumination: z.string().optional(),
  }).optional(),
  creative: z.string().optional(),
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
  app.post("/v1/advertisement/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADV_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createApplication(ctx, body));
  });

  app.get("/v1/advertisement/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADV_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total } });
  });

  app.get("/v1/advertisement/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADV_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = cache.makeKey(ctx.tenantId, "application", id);
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    return reply.send({ data: row });
  });

  app.post("/v1/advertisement/applications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADV_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.status !== "draft") {
      throw new HttpError(422, "INVALID_STATUS", "Cannot submit application in status '" + existing.status + "'");
    }
    return reply.code(202).send(await commands.submitApplication(ctx, id));
  });
}
