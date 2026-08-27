import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { validateAssetStatusTransition, type AssetStatus } from "./domain.js";

const ROLES = ["parks_user", "parks_admin", "super_admin"];
const ADMIN_ROLES = ["parks_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
  assetType: z.string().optional(),
});

const createBody = z.object({
  assetType: z.enum(["park", "garden", "tree", "playground", "fountain"]),
  name: z.string().max(256).optional(),
  location: z.record(z.unknown()).optional(),
  area: z.string().max(64).optional(),
  areaUnit: z.enum(["sqm", "sqft", "acres", "hectares"]).optional(),
});

const updateBody = z.object({
  name: z.string().max(256).optional(),
  location: z.record(z.unknown()).optional(),
  area: z.string().max(64).optional(),
  areaUnit: z.enum(["sqm", "sqft", "acres", "hectares"]).optional(),
  status: z.enum(["active", "under_maintenance", "closed"]).optional(),
  version: z.number().int().positive(),
});

const maintenanceBody = z.object({
  maintenanceEntry: z.record(z.unknown()),
  version: z.number().int().positive(),
});

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/parks/assets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createAsset(ctx, {
      assetType: body.assetType, name: body.name ?? null,
      location: body.location ?? null, area: body.area ?? null,
      areaUnit: body.areaUnit ?? null,
    }));
  });

  app.get("/v1/parks/assets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.assetType !== undefined ? { assetType: q.assetType } : {}),
    });
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/parks/assets/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const asset = await repo.findById(id, ctx.tenantId);
    if (!asset) throw new HttpError(404, "NOT_FOUND", "asset not found");
    return reply.send({ data: repo.toView(asset) });
  });

  app.patch("/v1/parks/assets/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "asset not found");
    // validateAssetStatusTransition existed in domain.ts but was never
    // imported/called here — any status value in the enum could be PATCHed
    // in regardless of the transition graph (e.g. closed -> under_maintenance
    // directly, when domain rules say closed can only reopen to active).
    // Live-confirmed: a closed asset accepted a PATCH straight to
    // under_maintenance with no error before this fix.
    if (body.status !== undefined) {
      const err = validateAssetStatusTransition(existing.status as AssetStatus, body.status as AssetStatus);
      if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    }
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.location !== undefined) patch.location = body.location;
    if (body.area !== undefined) patch.area = body.area;
    if (body.areaUnit !== undefined) patch.areaUnit = body.areaUnit;
    if (body.status !== undefined) patch.status = body.status;
    return reply.code(202).send(await commands.updateAsset(ctx, id, patch, body.version));
  });

  app.post("/v1/parks/assets/:id/maintenance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = maintenanceBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "asset not found");
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.recordMaintenance(ctx, id, body.maintenanceEntry, body.version));
  });
}
