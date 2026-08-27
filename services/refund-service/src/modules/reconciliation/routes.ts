import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as reqRepo from "../requests/repo.js";
import { canComplete, canFail, canReconcile } from "./domain.js";

const ADMIN_ROLES = ["refund_admin", "refund_approver", "super_admin"];

// See requests/routes.ts MINOR_AMOUNT: same shape, same reasoning (Zod-layer
// numeric validation so a malformed value 400s at the route instead of
// throwing inside BigInt() deep inside the async consumer transaction).
const MINOR_AMOUNT = z.string().regex(/^[1-9]\d{0,17}$/, "must be a positive integer string (minor units)");

const initiateBody = z.object({
  requestId: z.string().uuid(),
  bankAccountDetails: z.object({
    accountNumber: z.string().min(1),
    ifscCode: z.string().min(1),
    accountHolderName: z.string().min(1),
    bankName: z.string().optional(),
  }),
  disbursedAmountMinor: MINOR_AMOUNT,
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

    // FIN-4: a disbursement can also be (re-)initiated from a request that's
    // "failed" — see requests/domain.ts VALID_TRANSITIONS (failed -> processing)
    // — so a bad IFSC code / bounced transfer isn't a permanent dead end.
    if (request.status !== "approved" && request.status !== "failed") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot disburse for request in status '${request.status}'`);
    }

    // FIN-3 / double-disbursement guard: refuse a second disbursement while
    // one is already active (initiated/processing/completed) for this
    // request. `repo.findActiveByRequest` existed in spirit (as the old,
    // never-called `findByRequest`) but nothing ever checked it — a request
    // could previously accumulate more than one disbursement, including two
    // that both ran to completion/failure independently and left the parent
    // request's status flip-flopping between "refunded" and "failed"
    // depending on which one's terminal event was processed last.
    const existingActive = await repo.findActiveByRequest(body.requestId, ctx.tenantId);
    if (existingActive) {
      throw new HttpError(
        409,
        "DISBURSEMENT_ALREADY_ACTIVE",
        `An active disbursement already exists for this request (id=${existingActive.id}, status=${existingActive.status})`,
      );
    }

    // FIN-1 (disbursement side): the disbursed amount must never exceed the
    // approved refund amount on the request. Previously `disbursedAmountMinor`
    // was a fully caller-supplied figure with no bound anywhere in the route,
    // command, or consumer — a disbursement could be initiated for any
    // amount regardless of what was actually approved.
    const disbursedAmountMinor = BigInt(body.disbursedAmountMinor);
    const approvedCeiling = BigInt(request.refundAmountMinor);
    if (disbursedAmountMinor <= 0n || disbursedAmountMinor > approvedCeiling) {
      throw new HttpError(
        422,
        "DISBURSEMENT_AMOUNT_INVALID",
        `disbursedAmountMinor must be greater than 0 and cannot exceed the approved refund amount (${approvedCeiling})`,
      );
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
    // FIN-5: canReconcile() only looks at `status`, which reconcile() itself
    // never changes — so nothing previously stopped /reconcile from being
    // called any number of times on the same disbursement, each call
    // silently overwriting reconciled_at/reconciled_by.
    if (existing.reconciledAt) {
      throw new HttpError(
        409,
        "ALREADY_RECONCILED",
        `Disbursement was already reconciled at ${existing.reconciledAt.toISOString()}`,
      );
    }
    return reply.code(202).send(await commands.reconcile(ctx, id));
  });
}
