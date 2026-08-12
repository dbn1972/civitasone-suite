import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canPerformAction } from "./domain.js";

const TRADE_ROLES = ["trade_user", "trade_admin", "super_admin"];
const OFFICER_ROLES = ["trade_admin", "trade_officer", "super_admin"];

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});
const idParam = z.object({ id: z.string().uuid() });
const issueBody = z.object({
  applicationId: z.string().uuid(),
  tradeCategory: z.string().min(1).max(64),
  validityMonths: z.number().int().positive().max(120).optional(),
});
const actionBody = z.object({ reason: z.string().min(1).max(1000) });
const noticeBody = z.object({ licenceId: z.string().uuid(), noticeDetails: z.record(z.unknown()) });
const verifyQuery = z.object({ code: z.string().min(1).max(64) });

export async function licenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/trade/licences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total } });
  });

  app.get("/v1/trade/licences/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `trade:${ctx.tenantId}:licence:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    return reply.send({ data: row });
  });

  app.get("/v1/trade/licences/:id/actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const { id } = idParam.parse(req.params);
    const actions = await repo.listActions(id, ctx.tenantId);
    return reply.send({ data: actions, meta: { page: 1, pageSize: actions.length, total: actions.length } });
  });

  app.get("/v1/trade/licences/verify", async (req, reply) => {
    const q = verifyQuery.parse(req.query);
    const licence = await repo.findByVerificationCode(q.code);
    if (!licence) throw new HttpError(404, "LICENCE_NOT_FOUND", "No licence found for this verification code");
    return reply.send({ data: { licenceNumber: licence.licenceNumber, tradeCategory: licence.tradeCategory, status: licence.status, issuedAt: licence.issuedAt, validFrom: licence.validFrom, validUntil: licence.validUntil } });
  });

  app.post("/v1/trade/licences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = issueBody.parse(req.body);
    return reply.code(202).send(await commands.issueLicence(ctx, body.applicationId, body.tradeCategory, body.validityMonths));
  });

  app.post("/v1/trade/licences/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const licence = await repo.findById(id, ctx.tenantId);
    if (!licence) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    if (!canPerformAction(licence.status, "suspended")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot suspend licence in status '${licence.status}'`);
    }
    return reply.code(202).send(await commands.suspendLicence(ctx, id, body.reason));
  });

  app.post("/v1/trade/licences/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const licence = await repo.findById(id, ctx.tenantId);
    if (!licence) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    if (!canPerformAction(licence.status, "cancelled")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot cancel licence in status '${licence.status}'`);
    }
    return reply.code(202).send(await commands.cancelLicence(ctx, id, body.reason));
  });

  app.post("/v1/trade/licences/:id/restore", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = actionBody.parse(req.body);
    const licence = await repo.findById(id, ctx.tenantId);
    if (!licence) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    if (!canPerformAction(licence.status, "active")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot restore licence in status '${licence.status}'`);
    }
    return reply.code(202).send(await commands.restoreLicence(ctx, id, body.reason));
  });

  app.post("/v1/trade/licences/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = noticeBody.parse(req.body);
    return reply.code(202).send(await commands.issueNotice(ctx, body.licenceId, body.noticeDetails));
  });
}
