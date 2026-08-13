import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const VENDOR_ROLES = ["vendor_user", "vendor_admin", "super_admin"];

const createBody = z.object({
  vendorName: z.string().min(1).max(256),
  vendorAadhaar: z.string().length(12),
  vendorPhone: z.string().min(10).max(15),
  vendorPhoto: z.string().optional(),
  category: z.enum(["food", "non_food", "service"]),
  preferredZone: z.string().optional(),
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

export async function registrationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/vendor/registrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createRegistration(ctx, body));
  });

  app.get("/v1/vendor/registrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/vendor/registrations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `vendor:${ctx.tenantId}:registration:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    return reply.send({ data: row });
  });

  app.post("/v1/vendor/registrations/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    if (existing.status !== "draft") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot submit registration in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.submitRegistration(ctx, id));
  });

  app.post("/v1/vendor/registrations/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    if (!["draft", "submitted"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw registration in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.withdrawRegistration(ctx, id));
  });
}
