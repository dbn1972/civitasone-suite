import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateTreeRequestTransition, type TreeRequestStatus } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["parks_user", "parks_admin", "super_admin"];
const ADMIN_ROLES = ["parks_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

const submitBody = z.object({
  requestType: z.enum(["pruning", "removal", "new_planting", "transplant"]),
  location: z.record(z.unknown()).optional(),
  treeSpecies: z.string().max(128).optional(),
  reason: z.string().max(4000).optional(),
  photos: z.array(z.string().max(512)).optional(),
});

const inspectBody = z.object({
  inspectionReport: z.record(z.unknown()),
  version: z.number().int().positive(),
});

const transitionBody = z.object({ version: z.number().int().positive() });

export async function treeRequestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/parks/tree-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = submitBody.parse(req.body);
    return reply.code(202).send(await commands.submitTreeRequest(ctx, {
      requestType: body.requestType, location: body.location ?? null,
      treeSpecies: body.treeSpecies ?? null, reason: body.reason ?? null,
      photos: body.photos ?? null,
    }));
  });

  app.get("/v1/parks/tree-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/parks/tree-requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const request = await repo.findById(id, ctx.tenantId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "tree request not found");
    return reply.send({ data: repo.toView(request) });
  });

  app.post("/v1/parks/tree-requests/:id/inspect", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = inspectBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "tree request not found");
    const err = validateTreeRequestTransition(existing.status as TreeRequestStatus, "inspected");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.inspectTreeRequest(ctx, id, body.inspectionReport, body.version));
  });

  app.post("/v1/parks/tree-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "tree request not found");
    const err = validateTreeRequestTransition(existing.status as TreeRequestStatus, "approved");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.approveTreeRequest(ctx, id, body.version));
  });

  app.post("/v1/parks/tree-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "tree request not found");
    const err = validateTreeRequestTransition(existing.status as TreeRequestStatus, "rejected");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.rejectTreeRequest(ctx, id, body.version));
  });

  app.post("/v1/parks/tree-requests/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "tree request not found");
    const err = validateTreeRequestTransition(existing.status as TreeRequestStatus, "completed");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.completeTreeRequest(ctx, id, body.version));
  });
}
