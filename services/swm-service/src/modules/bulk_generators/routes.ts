import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateGeneratorTransition, type GeneratorStatus } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["swm_user", "swm_admin", "super_admin"];
const ADMIN_ROLES = ["swm_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

const registerBody = z.object({
  generatorName: z.string().min(1).max(128),
  generatorType: z.enum(["hotel", "restaurant", "mall", "hospital", "market"]),
  address: z.record(z.unknown()).optional(),
  estimatedWasteKgPerDay: z.number().int().positive().optional(),
  category: z.enum(["wet", "dry", "mixed"]),
  feeMinor: z.number().int().nonnegative().optional(),
});

const updateBody = z.object({
  generatorName: z.string().min(1).max(128).optional(),
  estimatedWasteKgPerDay: z.number().int().positive().optional(),
  category: z.enum(["wet", "dry", "mixed"]).optional(),
  feeMinor: z.number().int().nonnegative().optional(),
  version: z.number().int().positive(),
});

const suspendBody = z.object({ version: z.number().int().positive() });

export async function bulkGeneratorRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/swm/bulk-generators", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = registerBody.parse(req.body);
    return reply.code(202).send(await commands.registerGenerator(ctx, {
      generatorName: body.generatorName, generatorType: body.generatorType,
      address: body.address ?? null, estimatedWasteKgPerDay: body.estimatedWasteKgPerDay ?? null,
      category: body.category, feeMinor: body.feeMinor ?? null,
    }));
  });

  app.get("/v1/swm/bulk-generators", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/swm/bulk-generators/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const gen = await repo.findById(id, ctx.tenantId);
    if (!gen) throw new HttpError(404, "NOT_FOUND", "bulk generator not found");
    return reply.send({ data: repo.toView(gen) });
  });

  app.patch("/v1/swm/bulk-generators/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "bulk generator not found");
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    const patch: Record<string, unknown> = {};
    if (body.generatorName !== undefined) patch.generatorName = body.generatorName;
    if (body.estimatedWasteKgPerDay !== undefined) patch.estimatedWasteKgPerDay = body.estimatedWasteKgPerDay;
    if (body.category !== undefined) patch.category = body.category;
    if (body.feeMinor !== undefined) patch.feeMinor = body.feeMinor;
    return reply.code(202).send(await commands.updateGenerator(ctx, id, patch, body.version));
  });

  app.post("/v1/swm/bulk-generators/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = suspendBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "bulk generator not found");
    const err = validateGeneratorTransition(existing.status as GeneratorStatus, "suspended");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.suspendGenerator(ctx, id, body.version));
  });
}
