import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { productAvailability } from "./schema.js";
import * as repo from "./repo.js";
import { validateTransition, isEditable } from "./domain.js";

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
  /** Optional optimistic-lock guard. Falls back to the row's current version. */
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
  // List products with filters
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

  // Full hierarchy tree
  app.get("/v1/catalogue/products/tree", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const all = await repo.listByTenant(ctx.tenantId);
    // Build tree: Product Line → Family → Product → Variant
    const tree = buildHierarchyTree(all);
    return reply.send({ data: tree });
  });

  // Get single product
  app.get("/v1/catalogue/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const { id } = idParam.parse(req.params);
    const product = await repo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");
    return reply.send({ data: product });
  });

  // Create product
  app.post("/v1/catalogue/products", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createProductBody.parse(req.body);
    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insertProduct(tx, {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        description: body.description ?? null,
        lineId: body.lineId ?? null,
        familyId: body.familyId ?? null,
        parentId: body.parentId ?? null,
        lifecycleStatus: body.lifecycleStatus,
        effectiveFrom: body.effectiveFrom ?? null,
        effectiveTo: body.effectiveTo ?? null,
        regulatoryMetadata: body.regulatoryMetadata,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.productCreated,
        eventType: EVENTS.productCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          productId: id,
          name: body.name,
          lifecycleStatus: body.lifecycleStatus,
          ...(body.lineId !== undefined ? { lineId: body.lineId } : {}),
          ...(body.familyId !== undefined ? { familyId: body.familyId } : {}),
          ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        },
      });
    });

    return reply.code(201).send({ data: { id } });
  });

  // Update product (with lifecycle transition validation)
  app.patch("/v1/catalogue/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateProductBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Product not found");

    // Lifecycle transition validation
    if (body.lifecycleStatus && body.lifecycleStatus !== existing.lifecycleStatus) {
      const result = validateTransition(existing.lifecycleStatus, body.lifecycleStatus);
      if (!result.valid) {
        throw new HttpError(422, "INVALID_TRANSITION", result.reason ?? "Invalid lifecycle transition");
      }
    }

    // Can't edit metadata on non-editable products (unless only changing lifecycle)
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

    const expectedVersion = body.version ?? existing.version;

    await db.transaction(async (tx) => {
      const ok = await repo.updateProduct(tx, id, ctx.tenantId, patch as Partial<typeof existing>, expectedVersion);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "Product has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.productUpdated,
        eventType: EVENTS.productUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { productId: id, patch, previousVersion: expectedVersion },
      });
    });

    return reply.send({ data: { id, version: expectedVersion + 1 } });
  });

  // Soft delete (withdraws product)
  app.delete("/v1/catalogue/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Product not found");

    await db.transaction(async (tx) => {
      const ok = await repo.softDelete(tx, id, ctx.tenantId, existing.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "Product has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.productDeleted,
        eventType: EVENTS.productDeleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { productId: id, lifecycleStatus: "withdrawn", previousVersion: existing.version },
      });
    });

    return reply.code(200).send({ data: { id, lifecycleStatus: "withdrawn" } });
  });

  // Set availability for a product (circle/region/office)
  app.post("/v1/catalogue/products/:id/availability", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = availabilityBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Product not found");

    const avId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(productAvailability).values({
        id: avId,
        tenantId: ctx.tenantId,
        productId: id,
        circleId: body.circleId ?? null,
        regionId: body.regionId ?? null,
        officeId: body.officeId ?? null,
        available: body.available ? 1 : 0,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        version: 1,
      });

      // Availability is part of the product's published shape — reuse productUpdated.
      await enqueue(tx, {
        topic: EVENTS.productUpdated,
        eventType: EVENTS.productUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          productId: id,
          availabilityId: avId,
          available: body.available,
          ...(body.circleId !== undefined ? { circleId: body.circleId } : {}),
          ...(body.regionId !== undefined ? { regionId: body.regionId } : {}),
          ...(body.officeId !== undefined ? { officeId: body.officeId } : {}),
        },
      });
    });

    return reply.code(201).send({ data: { id: avId, productId: id } });
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
  // Group: lines (lineId=null, familyId=null, parentId=null → assume top-level),
  // families (parentId refers to line), products (parentId refers to family), variants (parentId refers to product)
  // Simplified: use parentId to build parent→child relationships
  const byId = new Map(products.map((p) => [p.id, p]));
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
