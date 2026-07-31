import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const CATALOGUE_ROLES = ["catalogue_user", "catalogue_admin", "super_admin"];
const ADMIN_ROLES = ["catalogue_admin", "super_admin"];

const createProductBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  lineId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  lifecycleStatus: z.enum(["draft", "active", "sunset", "retired"]).default("draft"),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional(),
  regulatoryMetadata: z.record(z.unknown()).default({}),
});

const updateProductBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  lineId: z.string().uuid().nullable().optional(),
  familyId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  lifecycleStatus: z.enum(["draft", "active", "sunset", "retired"]).optional(),
  effectiveFrom: z.string().date().nullable().optional(),
  effectiveTo: z.string().date().nullable().optional(),
  regulatoryMetadata: z.record(z.unknown()).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  lifecycleStatus: z.string().optional(),
  lineId: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/catalogue/products", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = listQuery.parse(req.query);
    return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, total: 0 } });
  });

  app.get("/v1/catalogue/products/tree", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    // Placeholder — returns full product hierarchy as a tree structure
    return reply.send({ data: [] });
  });

  app.get("/v1/catalogue/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const { id } = idParam.parse(req.params);
    // Placeholder — fetch product by id + tenantId
    return reply.send({ data: null });
  });

  app.post("/v1/catalogue/products", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createProductBody.parse(req.body);
    // Placeholder — publishes product creation command
    return reply.code(202).send({ accepted: true, message: "product creation queued" });
  });

  app.patch("/v1/catalogue/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateProductBody.parse(req.body);
    // Placeholder — publishes product update command
    return reply.code(202).send({ accepted: true, message: "product update queued" });
  });

  app.delete("/v1/catalogue/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    // Placeholder — publishes product soft-delete command
    return reply.code(202).send({ accepted: true, message: "product deletion queued" });
  });
}
