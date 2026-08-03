import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as productRepo from "../products/repo.js";
import { validateBundleComponents } from "./domain.js";
import * as commands from "./commands.js";

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
  version: z.number().int().positive().optional(),
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
    const { rows, total } = await repo.listBundles({
      tenantId: ctx.tenantId,
      limit: q.limit,
      offset: q.offset,
    });
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows, meta: { page, pageSize: q.limit, total } });
  });

  app.get("/v1/catalogue/bundles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CATALOGUE_ROLES);
    const { id } = idParam.parse(req.params);
    const bundle = await repo.findById(id, ctx.tenantId);
    if (!bundle) throw new HttpError(404, "NOT_FOUND", "Bundle not found");
    const components = await productRepo.findByIds(bundle.componentProductIds, ctx.tenantId);
    return reply.send({ data: { ...bundle, components } });
  });

  app.post("/v1/catalogue/bundles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBundleBody.parse(req.body);

    const componentProducts = await productRepo.findByIds(body.componentProductIds, ctx.tenantId);
    const validation = validateBundleComponents(
      body.componentProductIds,
      componentProducts.map((p) => ({ id: p.id, lifecycleStatus: p.lifecycleStatus })),
    );
    if (!validation.valid) {
      throw new HttpError(
        422,
        "INVALID_COMPONENTS",
        `Bundle has invalid components: ${validation.invalidProducts.map((p) => `${p.id} (${p.reason})`).join(", ")}`,
      );
    }

    return reply.code(202).send(
      await commands.createBundle(ctx, {
        name: body.name,
        description: body.description ?? null,
        componentProductIds: body.componentProductIds,
        pricingApprovalRequired: body.pricingApprovalRequired,
      }),
    );
  });

  app.patch("/v1/catalogue/bundles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBundleBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Bundle not found");

    if (body.componentProductIds) {
      const componentProducts = await productRepo.findByIds(body.componentProductIds, ctx.tenantId);
      const validation = validateBundleComponents(
        body.componentProductIds,
        componentProducts.map((p) => ({ id: p.id, lifecycleStatus: p.lifecycleStatus })),
      );
      if (!validation.valid) {
        throw new HttpError(
          422,
          "INVALID_COMPONENTS",
          `Bundle has invalid components: ${validation.invalidProducts.map((p) => `${p.id} (${p.reason})`).join(", ")}`,
        );
      }
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name !== undefined) patch["name"] = body.name;
    if (body.description !== undefined) patch["description"] = body.description;
    if (body.componentProductIds !== undefined) patch["componentProductIds"] = body.componentProductIds;
    if (body.pricingApprovalRequired !== undefined) patch["pricingApprovalRequired"] = body.pricingApprovalRequired;
    if (body.status !== undefined) patch["status"] = body.status;

    if (body.version !== undefined && body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "Bundle has been modified; retry with current version");
    }
    const expectedVersion = body.version ?? existing.version;
    return reply.code(202).send(await commands.updateBundle(ctx, id, { version: expectedVersion, patch }));
  });

  app.delete("/v1/catalogue/bundles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Bundle not found");
    return reply.code(202).send(await commands.deleteBundle(ctx, id, existing.version));
  });
}
