import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateAppTransition, type ApplicationStatus } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["sewerage_user", "sewerage_admin", "super_admin"];
const ADMIN_ROLES = ["sewerage_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

const applyBody = z.object({
  propertyRef: z.string().max(64).optional(),
  waterConnectionRef: z.string().max(64).optional(),
  connectionClass: z.enum(["domestic", "commercial", "industrial"]),
  siteDetails: z.record(z.unknown()).optional(),
});

const statusBody = z.object({
  status: z.string(),
  version: z.number().int().positive(),
});

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/sewerage/connections/apply", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = applyBody.parse(req.body);
    return reply.code(202).send(await commands.applyConnection(ctx, {
      propertyRef: body.propertyRef ?? null,
      waterConnectionRef: body.waterConnectionRef ?? null,
      connectionClass: body.connectionClass,
      siteDetails: body.siteDetails ?? null,
    }));
  });

  app.get("/v1/sewerage/connections/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listApps(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.appToView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/sewerage/connections/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const app_ = await repo.findAppById(id, ctx.tenantId);
    if (!app_) throw new HttpError(404, "NOT_FOUND", "application not found");
    return reply.send({ data: repo.appToView(app_) });
  });

  app.post("/v1/sewerage/connections/applications/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = statusBody.parse(req.body);
    const existing = await repo.findAppById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "application not found");
    const err = validateAppTransition(existing.status as ApplicationStatus, body.status as ApplicationStatus);
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.updateConnectionStatus(ctx, id, body.status, body.version));
  });

  app.post("/v1/sewerage/connections/applications/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ version: z.number().int().positive() }).parse(req.body);
    const existing = await repo.findAppById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "application not found");
    if (existing.status !== "work_ordered") throw new HttpError(422, "TRANSITION_INVALID", "can only activate from work_ordered");
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.activateConnection(ctx, id, body.version));
  });
}
