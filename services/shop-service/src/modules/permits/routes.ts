import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canPerformAction } from "./domain.js";
import * as appRepo from "../registrations/repo.js";

const SHOP_ROLES = ["shop_user", "shop_admin", "super_admin"];
const OFFICER_ROLES = ["shop_admin", "shop_officer", "super_admin"];

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const issueBody = z.object({
  applicationId: z.string().uuid(),
  establishmentName: z.string().min(1).max(256),
  validityMonths: z.number().int().positive().max(120).optional(),
});

const actionBody = z.object({
  reason: z.string().min(1).max(1000),
});

const noticeBody = z.object({
  permitId: z.string().uuid(),
  noticeDetails: z.record(z.unknown()),
});

const verifyQuery = z.object({ code: z.string().min(1).max(64) });

export async function permitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/shop/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/shop/permits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `shop:${ctx.tenantId}:permit:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    return reply.send({ data: row });
  });

  app.get("/v1/shop/permits/:id/actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const { id } = idParam.parse(req.params);
    const actions = await repo.listActions(id, ctx.tenantId);
    return reply.send({
      data: actions,
      meta: { page: 1, pageSize: actions.length, total: actions.length },
    });
  });

  app.get("/v1/shop/permits/verify", async (req, reply) => {
    const q = verifyQuery.parse(req.query);
    const permit = await repo.findByVerificationCode(q.code);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "No permit found for this verification code");
    return reply.send({
      data: {
        permitNumber: permit.permitNumber,
        establishmentName: permit.establishmentName,
        permitStatus: permit.permitStatus,
        issuedAt: permit.issuedAt,
        validFrom: permit.validFrom,
        validUntil: permit.validUntil,
      },
    });
  });

  app.post("/v1/shop/permits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = issueBody.parse(req.body);
    const application = await appRepo.findById(body.applicationId, ctx.tenantId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (application.status !== "approved") {
      throw new HttpError(422, "INVALID_STATUS",
        `Cannot issue a permit for application in status '${application.status}'`);
    }
    const existingPermit = await repo.findByApplicationId(body.applicationId, ctx.tenantId);
    if (existingPermit) {
      throw new HttpError(409, "PERMIT_ALREADY_ISSUED",
        `A permit already exists for this application (${existingPermit.permitNumber})`);
    }
    return reply.code(202).send(
      await commands.issuePermit(ctx, body.applicationId, body.establishmentName, body.validityMonths),
    );
  });

  app.post("/v1/shop/permits/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const permit = await repo.findById(id, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canPerformAction(permit.permitStatus, "suspended")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot suspend permit in status '${permit.permitStatus}'`);
    }
    return reply.code(202).send(await commands.suspendPermit(ctx, id, body.reason));
  });

  app.post("/v1/shop/permits/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const permit = await repo.findById(id, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canPerformAction(permit.permitStatus, "cancelled")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot cancel permit in status '${permit.permitStatus}'`);
    }
    return reply.code(202).send(await commands.cancelPermit(ctx, id, body.reason));
  });

  app.post("/v1/shop/permits/:id/restore", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const permit = await repo.findById(id, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canPerformAction(permit.permitStatus, "active")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot restore permit in status '${permit.permitStatus}'`);
    }
    return reply.code(202).send(await commands.restorePermit(ctx, id, body.reason));
  });

  app.post("/v1/shop/permits/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = noticeBody.parse(req.body);
    // Every other write route here does a synchronous pre-accept existence
    // check before returning 202 (see /permits/:id/suspend|cancel|restore and
    // POST /renewals above) — this route was the one exception. permit_actions
    // has no FK on permit_id (migration 0001), so without this check a bogus
    // permitId silently produced an orphaned notice action + a noticeIssued
    // event for a permit that never existed, with the 202 caller never told.
    const permit = await repo.findById(body.permitId, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    return reply.code(202).send(await commands.issueNotice(ctx, body.permitId, body.noticeDetails));
  });
}
