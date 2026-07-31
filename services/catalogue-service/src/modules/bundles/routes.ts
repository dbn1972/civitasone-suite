import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as productRepo from "../products/repo.js";
import { validateBundleComponents } from "./domain.js";

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
  /** Optional optimistic-lock guard. Falls back to the row's current version. */
  version: z.number().int().positive().optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.string().uuid() });

export async function bundleRoutes(app: FastifyInstance): Promise<void> {
  // List bundles
  app.get("/v1/catalogue/bundles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listBundles({
      tenantId: ctx.tenantId,
      limit: q.limit,
      offset: q.offset,
    });
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows, meta: { page, pageSize: q.limit, total } });
  });

  // Get single bundle with component details
  app.get("/v1/catalogue/bundles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const { id } = idParam.parse(req.params);
    const bundle = await repo.findById(id, ctx.tenantId);
    if (!bundle) throw new HttpError(404, "NOT_FOUND", "Bundle not found");

    // Fetch component product details
    const components = await productRepo.findByIds(bundle.componentProductIds, ctx.tenantId);
    return reply.send({ data: { ...bundle, components } });
  });

  // Create bundle
  app.post("/v1/catalogue/bundles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBundleBody.parse(req.body);

    // Validate all components are active products
    const componentProducts = await productRepo.findByIds(body.componentProductIds, ctx.tenantId);
    const validation = validateBundleComponents(
      body.componentProductIds,
      componentProducts.map((p) => ({ id: p.id, lifecycleStatus: p.lifecycleStatus })),
    );
    if (!validation.valid) {
      throw new HttpError(422, "INVALID_COMPONENTS", `Bundle has invalid components: ${validation.invalidProducts.map((p) => `${p.id} (${p.reason})`).join(", ")}`);
    }

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insertBundle(tx, {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        description: body.description ?? null,
        componentProductIds: body.componentProductIds,
        pricingApprovalRequired: body.pricingApprovalRequired,
        status: "active",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.bundleCreated,
        eventType: EVENTS.bundleCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          bundleId: id,
          name: body.name,
          componentProductIds: body.componentProductIds,
          pricingApprovalRequired: body.pricingApprovalRequired,
          status: "active",
        },
      });
    });

    return reply.code(201).send({ data: { id } });
  });

  // Update bundle
  app.patch("/v1/catalogue/bundles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBundleBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Bundle not found");

    // If component products are changing, validate them
    if (body.componentProductIds) {
      const componentProducts = await productRepo.findByIds(body.componentProductIds, ctx.tenantId);
      const validation = validateBundleComponents(
        body.componentProductIds,
        componentProducts.map((p) => ({ id: p.id, lifecycleStatus: p.lifecycleStatus })),
      );
      if (!validation.valid) {
        throw new HttpError(422, "INVALID_COMPONENTS", `Bundle has invalid components: ${validation.invalidProducts.map((p) => `${p.id} (${p.reason})`).join(", ")}`);
      }
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch["name"] = body.name;
    if (body.description !== undefined) patch["description"] = body.description;
    if (body.componentProductIds !== undefined) patch["componentProductIds"] = body.componentProductIds;
    if (body.pricingApprovalRequired !== undefined) patch["pricingApprovalRequired"] = body.pricingApprovalRequired;
    if (body.status !== undefined) patch["status"] = body.status;

    const expectedVersion = body.version ?? existing.version;

    await db.transaction(async (tx) => {
      const ok = await repo.updateBundle(tx, id, ctx.tenantId, patch as Partial<typeof existing>, expectedVersion);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "Bundle has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.bundleUpdated,
        eventType: EVENTS.bundleUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { bundleId: id, patch, previousVersion: expectedVersion },
      });
    });

    return reply.send({ data: { id, version: expectedVersion + 1 } });
  });

  // Soft-delete bundle
  app.delete("/v1/catalogue/bundles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Bundle not found");

    await db.transaction(async (tx) => {
      const ok = await repo.softDeleteBundle(tx, id, ctx.tenantId, existing.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "Bundle has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.bundleDeleted,
        eventType: EVENTS.bundleDeleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { bundleId: id, status: "deleted", previousVersion: existing.version },
      });
    });

    return reply.code(200).send({ data: { id, status: "deleted" } });
  });
}
