import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canRevoke } from "./domain.js";

const EVENT_ROLES = ["event_user", "event_admin", "super_admin"];
const ADMIN_ROLES = ["event_admin", "super_admin"];

const issueBody = z.object({
  applicationId: z.string().uuid(),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime(),
  conditions: z.record(z.unknown()).optional(),
});

const revokeBody = z.object({ reason: z.string().min(1) });

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function permitRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/event/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = issueBody.parse(req.body);
    return reply.code(202).send(
      await commands.issuePermit(ctx, body.applicationId, body.validFrom, body.validUntil, body.conditions),
    );
  });

  app.get("/v1/event/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVENT_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/event/permits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVENT_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `event:${ctx.tenantId}:permit:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    return reply.send({ data: row });
  });

  app.post("/v1/event/permits/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = revokeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canRevoke(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot revoke permit in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.revokePermit(ctx, id, body.reason));
  });
}
