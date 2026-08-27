import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canSuspend, canCancel } from "./domain.js";

const VENDOR_ROLES = ["vendor_user", "vendor_admin", "super_admin"];
const ADMIN_ROLES = ["vendor_admin", "super_admin"];

const issueBody = z.object({
  registrationId: z.string().uuid(),
  zone: z.string().min(1),
  spotNumber: z.string().min(1),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime(),
});

const suspendBody = z.object({ reason: z.string().min(1) });
const cancelBody = z.object({ reason: z.string().min(1) });
const feeBody = z.object({ transactionId: z.string().min(1).max(128) });

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function licenceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/vendor/licences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = issueBody.parse(req.body);
    return reply.code(202).send(
      await commands.issueLicence(ctx, body.registrationId, body.zone, body.spotNumber, body.validFrom, body.validUntil),
    );
  });

  app.get("/v1/vendor/licences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/vendor/licences/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = cache.makeKey(ctx.tenantId, "licence", id);
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    return reply.send({ data: row });
  });

  app.post("/v1/vendor/licences/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = suspendBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    if (!canSuspend(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot suspend licence in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.suspendLicence(ctx, id, body.reason));
  });

  app.post("/v1/vendor/licences/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = cancelBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    if (!canCancel(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot cancel licence in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.cancelLicence(ctx, id, body.reason));
  });

  app.post("/v1/vendor/licences/:id/fee-payment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = feeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    return reply.code(202).send(await commands.recordLicenceFee(ctx, id, body.transactionId));
  });
}
