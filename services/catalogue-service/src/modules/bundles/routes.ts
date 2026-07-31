import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const CATALOGUE_ROLES = ["catalogue_user", "catalogue_admin", "super_admin"];
const ADMIN_ROLES = ["catalogue_admin", "super_admin"];

const createBundleBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  componentProductIds: z.array(z.string().uuid()).min(1),
  pricingApprovalRequired: z.boolean().default(false),
});

const updateBundleBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  componentProductIds: z.array(z.string().uuid()).min(1).optional(),
  pricingApprovalRequired: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.string().uuid() });

export async function bundleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/catalogue/bundles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, total: 0 } });
  });

  app.get("/v1/catalogue/bundles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const { id } = idParam.parse(req.params);
    // Placeholder — fetch bundle by id + tenantId
    return reply.send({ data: null });
  });

  app.post("/v1/catalogue/bundles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBundleBody.parse(req.body);
    // Placeholder — publishes bundle creation command
    return reply.code(202).send({ accepted: true, message: "bundle creation queued" });
  });

  app.patch("/v1/catalogue/bundles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBundleBody.parse(req.body);
    // Placeholder — publishes bundle update command
    return reply.code(202).send({ accepted: true, message: "bundle update queued" });
  });

  app.delete("/v1/catalogue/bundles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    // Placeholder — publishes bundle soft-delete command
    return reply.code(202).send({ accepted: true, message: "bundle deletion queued" });
  });
}
