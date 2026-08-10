import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as reqRepo from "../requests/repo.js";
import { canComplete, canFail, canReconcile } from "./domain.js";

const ADMIN_ROLES = ["refund_admin", "refund_approver", "super_admin"];

const initiateBody = z.object({
  requestId: z.string().uuid(),
  bankAccountDetails: z.object({
    accountNumber: z.string().min(1),
    ifscCode: z.string().min(1),
    accountHolderName: z.string().min(1),
    bankName: z.string().optional(),
  }),
  disbursedAmountMinor: z.string().min(1),
});

const completeBody = z.object({ disbursementRef: z.string().min(1) });
const failBody = z.object({ reason: z.string().min(1) });

const idParam = z.object({ id: z.string().uuid() });

export async function reconciliationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/refund/disbursements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = initiateBody.parse(req.body);
    const request = await reqRepo.findById(body.requestId, ctx.tenantId);
    if (!request) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    if (request.status !== "approved") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot disburse for request in status '${request.status}'`);
    }
    return reply.code(202).send(
      await commands.initiateDisbursement(ctx, body.requestId, body.bankAccountDetails, body.disbursedAmountMinor),
    );
  });

  app.get("/v1/refund/disbursements/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "DISBURSEMENT_NOT_FOUND", "Disbursement not found");
    return reply.send({ data: row });
  });

  app.post("/v1/refund/disbursements/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "DISBURSEMENT_NOT_FOUND", "Disbursement not found");
    if (!canComplete(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot complete disbursement in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.completeDisbursement(ctx, id, body.disbursementRef));
  });

  app.post("/v1/refund/disbursements/:id/fail", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = failBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "DISBURSEMENT_NOT_FOUND", "Disbursement not found");
    if (!canFail(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot fail disbursement in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.failDisbursement(ctx, id, body.reason));
  });

  app.post("/v1/refund/disbursements/:id/reconcile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "DISBURSEMENT_NOT_FOUND", "Disbursement not found");
    if (!canReconcile(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot reconcile disbursement in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.reconcile(ctx, id));
  });
}
