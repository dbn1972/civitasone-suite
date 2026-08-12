import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canExtend, canComplete, canCancel } from "./domain.js";

const ROADCUT_ROLES = ["roadcut_user", "roadcut_admin", "super_admin"];
const ADMIN_ROLES = ["roadcut_admin", "super_admin"];

const issueBody = z.object({
  applicationId: z.string().uuid(),
  workStartDate: z.string(),
  workEndDate: z.string(),
  conditions: z.record(z.unknown()).optional(),
});

const extendBody = z.object({ extendedUntil: z.string() });
const cancelBody = z.object({ reason: z.string().min(1) });

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function permitRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/roadcut/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = issueBody.parse(req.body);
    return reply.code(202).send(
      await commands.issuePermit(ctx, body.applicationId, body.workStartDate, body.workEndDate, body.conditions),
    );
  });

  app.get("/v1/roadcut/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/roadcut/permits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROADCUT_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `roadcut:${ctx.tenantId}:permit:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    return reply.send({ data: row });
  });

  app.post("/v1/roadcut/permits/:id/extend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = extendBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canExtend(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot extend permit in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.extendPermit(ctx, id, body.extendedUntil));
  });

  app.post("/v1/roadcut/permits/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canComplete(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot complete permit in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.completePermit(ctx, id));
  });

  app.post("/v1/roadcut/permits/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = cancelBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canCancel(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot cancel permit in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.cancelPermit(ctx, id, body.reason));
  });
}
