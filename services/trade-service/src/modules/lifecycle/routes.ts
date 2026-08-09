import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as licenceRepo from "../licences/repo.js";
import { canRequestRenewal } from "./domain.js";

const TRADE_ROLES = ["trade_user", "trade_admin", "super_admin"];
const OFFICER_ROLES = ["trade_admin", "trade_officer", "super_admin"];

const requestBody = z.object({
  licenceId: z.string().uuid(),
  renewalType: z.enum(["renewal", "amendment", "surrender", "duplicate"]),
  details: z.record(z.unknown()).optional(),
});
const decideBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});
const idParam = z.object({ id: z.string().uuid() });
const licenceIdQuery = z.object({ licenceId: z.string().uuid() });
const listQuery = z.object({
  status: z.string().optional(),
  renewalType: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/trade/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const body = requestBody.parse(req.body);
    const licence = await licenceRepo.findById(body.licenceId, ctx.tenantId);
    if (!licence) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    if (!canRequestRenewal(licence.status, body.renewalType)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot request '${body.renewalType}' for licence in status '${licence.status}'`);
    }
    return reply.code(202).send(await commands.requestRenewal(ctx, body.licenceId, body.renewalType, body.details));
  });

  app.get("/v1/trade/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total } });
  });

  app.get("/v1/trade/renewals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "RENEWAL_NOT_FOUND", "Renewal request not found");
    return reply.send({ data: row });
  });

  app.get("/v1/trade/renewals/by-licence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRADE_ROLES);
    const q = licenceIdQuery.parse(req.query);
    const rows = await repo.listByLicence(q.licenceId, ctx.tenantId);
    return reply.send({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } });
  });

  app.post("/v1/trade/renewals/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = decideBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "RENEWAL_NOT_FOUND", "Renewal request not found");
    if (existing.status !== "submitted" && existing.status !== "under_review") {
      throw new HttpError(422, "ALREADY_DECIDED", `Renewal already in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.decideRenewal(ctx, id, body.decision, body.reason));
  });
}
