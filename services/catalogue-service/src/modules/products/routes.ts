import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateTransition, isEditable } from "./domain.js";
import * as commands from "./commands.js";

const CATALOGUE_ROLES = ["catalogue_user", "catalogue_admin", "super_admin"];
const ADMIN_ROLES = ["catalogue_admin", "super_admin"];

const createProductBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  lineId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  lifecycleStatus: z.enum(["draft", "active", "suspended", "withdrawn", "closed_to_new_business"]).default("draft"),
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
  lifecycleStatus: z.enum(["draft", "active", "suspended", "withdrawn", "closed_to_new_business"]).optional(),
  effectiveFrom: z.string().date().nullable().optional(),
  effectiveTo: z.string().date().nullable().optional(),
  regulatoryMetadata: z.record(z.unknown()).optional(),
  version: z.number().int().positive().optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  lifecycleStatus: z.string().optional(),
  lineId: z.string().uuid().optional(),
  search: z.string().optional(),
});

const availabilityBody = z.object({
  circleId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  officeId: z.string().uuid().optional(),
  available: z.boolean().default(true),
});

const idParam = z.object({ id: z.string().uuid() });

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/catalogue/products", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listProducts({
      tenantId: ctx.tenantId,
      limit: q.limit,
      offset: q.offset,
      lifecycleStatus: q.lifecycleStatus,
      lineId: q.lineId,
      search: q.search,
    });
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows, meta: { page, pageSize: q.limit, total } });
  });

  app.get("/v1/catalogue/products/tree", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const all = await repo.listByTenant(ctx.tenantId);
    return reply.send({ data: buildHierarchyTree(all) });
  });

  app.get("/v1/catalogue/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const { id } = idParam.parse(req.params);
    const product = await repo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");
    return reply.send({ data: product });
  });

  app.post("/v1/catalogue/products", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createProductBody.parse(req.body);
    return reply.code(202).send(
      await commands.createProduct(ctx, {
        name: body.name,
        description: body.description ?? null,
        lineId: body.lineId ?? null,
        familyId: body.familyId ?? null,
        parentId: body.parentId ?? null,
        lifecycleStatus: body.lifecycleStatus,
        effectiveFrom: body.effectiveFrom ?? null,
        effectiveTo: body.effectiveTo ?? null,
        regulatoryMetadata: body.regulatoryMetadata,
      }),
    );
  });

  app.patch("/v1/catalogue/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateProductBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Product not found");

    if (body.lifecycleStatus && body.lifecycleStatus !== existing.lifecycleStatus) {
      const result = validateTransition(existing.lifecycleStatus, body.lifecycleStatus);
      if (!result.valid) {
        throw new HttpError(422, "INVALID_TRANSITION", result.reason ?? "Invalid lifecycle transition");
      }
    }

    const metadataChange = body.name ?? body.description ?? body.lineId ?? body.familyId ?? body.parentId ?? body.regulatoryMetadata;
    if (metadataChange !== undefined && !isEditable(existing.lifecycleStatus)) {
      throw new HttpError(422, "NOT_EDITABLE", `Cannot modify product in '${existing.lifecycleStatus}' status`);
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch["name"] = body.name;
    if (body.description !== undefined) patch["description"] = body.description;
    if (body.lineId !== undefined) patch["lineId"] = body.lineId;
    if (body.familyId !== undefined) patch["familyId"] = body.familyId;
    if (body.parentId !== undefined) patch["parentId"] = body.parentId;
    if (body.lifecycleStatus !== undefined) patch["lifecycleStatus"] = body.lifecycleStatus;
    if (body.effectiveFrom !== undefined) patch["effectiveFrom"] = body.effectiveFrom;
    if (body.effectiveTo !== undefined) patch["effectiveTo"] = body.effectiveTo;
    if (body.regulatoryMetadata !== undefined) patch["regulatoryMetadata"] = body.regulatoryMetadata;

    if (body.version !== undefined && body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "Product has been modified; retry with current version");
    }
    const expectedVersion = body.version ?? existing.version;
    return reply.code(202).send(await commands.updateProduct(ctx, id, { version: expectedVersion, patch }));
  });

  app.delete("/v1/catalogue/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Product not found");
    return reply.code(202).send(await commands.deleteProduct(ctx, id, existing.version));
  });

  app.post("/v1/catalogue/products/:id/availability", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = availabilityBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Product not found");
    return reply.code(202).send(
      await commands.recordProductAvailability(ctx, id, {
        circleId: body.circleId ?? null,
        regionId: body.regionId ?? null,
        officeId: body.officeId ?? null,
        available: body.available,
      }),
    );
  });
}

/** Build 4-level hierarchy tree from flat product list. */
interface TreeNode {
  id: string;
  name: string;
  lifecycleStatus: string;
  level: "line" | "family" | "product" | "variant";
  children: TreeNode[];
}

type FlatProduct = Awaited<ReturnType<typeof repo.listByTenant>>[number];

function buildHierarchyTree(products: FlatProduct[]): TreeNode[] {
  const childrenMap = new Map<string, typeof products>();

  for (const p of products) {
    const parentKey = p.parentId ?? "__root__";
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
    childrenMap.get(parentKey)!.push(p);
  }

  function buildNode(p: (typeof products)[number], depth: number): TreeNode {
    const level = depth === 0 ? "line" : depth === 1 ? "family" : depth === 2 ? "product" : "variant";
    const children = (childrenMap.get(p.id) ?? []).map((c) => buildNode(c, depth + 1));
    return { id: p.id, name: p.name, lifecycleStatus: p.lifecycleStatus, level, children };
  }

  const roots = childrenMap.get("__root__") ?? [];
  return roots.map((r) => buildNode(r, 0));
}
