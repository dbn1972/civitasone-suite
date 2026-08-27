import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canTransition, validateRefundAmount } from "./domain.js";

const REFUND_ROLES = ["refund_user", "refund_admin", "refund_approver", "super_admin"];

// Positive integer, no sign/decimal/exponent/leading zero, capped at 18 digits
// (safely under bigint's 19-digit max) so a malformed or absurd value fails
// fast at the route boundary instead of throwing inside BigInt() deep inside
// an async consumer transaction — which would look like a fake-success 202
// followed by a silently dead-lettered command.
const MINOR_AMOUNT = z.string().regex(/^[1-9]\d{0,17}$/, "must be a positive integer string (minor units)");

const createBody = z.object({
  applicantName: z.string().min(1).max(256),
  applicantPhone: z.string().min(10).max(15),
  originalServiceType: z.string().min(1).max(64),
  originalTransactionRef: z.string().min(1),
  originalAmountMinor: MINOR_AMOUNT,
  refundAmountMinor: MINOR_AMOUNT,
  refundReason: z.enum(["overpayment", "cancellation", "deposit_return", "duplicate_payment", "other"]),
  description: z.string().optional(),
  documents: z.array(z.object({
    docType: z.string(),
    fileId: z.string().uuid(),
    uploadedAt: z.string().datetime(),
  })).optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/refund/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const body = createBody.parse(req.body);

    // FIN-1: the refund amount must never exceed the original transaction
    // amount. `validateRefundAmount` already existed in domain.ts but was
    // never called anywhere in the request lifecycle — nothing enforced this
    // at creation, approval, or disbursement. This wires it up at the
    // earliest point (creation); disbursement is separately capped against
    // the approved refund amount in reconciliation/routes.ts.
    const originalAmountMinor = BigInt(body.originalAmountMinor);
    const refundAmountMinor = BigInt(body.refundAmountMinor);
    if (!validateRefundAmount(refundAmountMinor, originalAmountMinor)) {
      throw new HttpError(
        422,
        "REFUND_AMOUNT_INVALID",
        "refundAmountMinor must be greater than 0 and cannot exceed originalAmountMinor",
      );
    }

    return reply.code(202).send(await commands.createRequest(ctx, body));
  });

  app.get("/v1/refund/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/refund/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `refund:${ctx.tenantId}:request:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    return reply.send({ data: row });
  });

  app.post("/v1/refund/requests/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    if (!canTransition(existing.status, "under_review")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot submit request in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.submitRequest(ctx, id));
  });

  app.post("/v1/refund/requests/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REFUND_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REQUEST_NOT_FOUND", "Refund request not found");
    if (!canTransition(existing.status, "withdrawn")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw request in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.withdrawRequest(ctx, id));
  });
}
