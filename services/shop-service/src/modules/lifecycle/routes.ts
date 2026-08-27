import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as permitRepo from "../permits/repo.js";
import { canRequestRenewal } from "./domain.js";

const SHOP_ROLES = ["shop_user", "shop_admin", "super_admin"];
const OFFICER_ROLES = ["shop_admin", "shop_officer", "super_admin"];

const requestBody = z.object({
  permitId: z.string().uuid(),
  renewalType: z.enum(["renewal", "amendment", "duplicate", "surrender"]),
  details: z.record(z.unknown()).optional(),
});

const decideBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});

const feePaymentBody = z.object({
  transactionId: z.string().min(1).max(128),
});

const idParam = z.object({ id: z.string().uuid() });
const permitIdQuery = z.object({ permitId: z.string().uuid() });
const listQuery = z.object({
  status: z.string().optional(),
  renewalType: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/shop/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const body = requestBody.parse(req.body);
    const permit = await permitRepo.findById(body.permitId, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found");
    if (!canRequestRenewal(permit.permitStatus, body.renewalType)) {
      throw new HttpError(422, "INVALID_STATUS",
        `Cannot request '${body.renewalType}' for permit in status '${permit.permitStatus}'`);
    }
    return reply.code(202).send(
      await commands.requestRenewal(ctx, body.permitId, body.renewalType, body.details),
    );
  });

  app.get("/v1/shop/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/shop/renewals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "RENEWAL_NOT_FOUND", "Renewal request not found");
    return reply.send({ data: row });
  });

  app.get("/v1/shop/renewals/by-permit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const q = permitIdQuery.parse(req.query);
    const rows = await repo.listByPermit(q.permitId, ctx.tenantId);
    return reply.send({
      data: rows,
      meta: { page: 1, pageSize: rows.length, total: rows.length },
    });
  });

  app.post("/v1/shop/renewals/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = decideBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "RENEWAL_NOT_FOUND", "Renewal request not found");
    if (existing.status !== "submitted" && existing.status !== "under_review") {
      throw new HttpError(422, "ALREADY_DECIDED", `Renewal already in status '${existing.status}'`);
    }
    const feeOwed = existing.feeAmountMinor ?? 0n;
    if (body.decision === "approved" && feeOwed > 0n && !existing.feePaid) {
      throw new HttpError(422, "FEE_NOT_PAID",
        "Cannot approve a renewal until its fee has been paid");
    }
    return reply.code(202).send(await commands.decideRenewal(ctx, id, body.decision, body.reason));
  });

  app.post("/v1/shop/renewals/:id/fee-payment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const { id } = idParam.parse(req.params);
    const body = feePaymentBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "RENEWAL_NOT_FOUND", "Renewal request not found");
    if (existing.feePaid) throw new HttpError(409, "FEE_ALREADY_PAID", "Fee has already been paid");
    return reply.code(202).send(await commands.recordRenewalFeePayment(ctx, id, body.transactionId));
  });
}
