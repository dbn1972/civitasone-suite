import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { uuidParam, paginationQuery } from "../../shared/validators.js";
import { isBbpsEnabled } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { fetchBillBody, payBillBody } from "./validators.js";

// Matches collection/routes.ts — BBPS is another revenue collection channel
// and is gated the same way as every other collection-writing endpoint.
const REVENUE_ROLES = ["revenue_admin", "revenue_officer", "finance_admin", "super_admin", "tenant_admin"];

export async function bbpsRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  // ── POST /v1/revenue/bbps/fetch-bill ──────────────────────────────────────

  app.post("/v1/revenue/bbps/fetch-bill", async (req, reply) => {
    if (!isBbpsEnabled()) {
      throw new HttpError(403, "BBPS_DISABLED", "BBPS not enabled");
    }
    const ctx = resolveContext(req);
    // GAP2-REVENUE-BBPS-10: fetch-bill is a MUTATION (its consumer probes the
    // assessee's live DCB outstanding by free-text identifier and INSERTs a
    // bbps_transactions row) and must be gated exactly like pay-bill and every
    // other collection/arrears write route — not merely BBPS_ENABLED. Without
    // this, any authenticated tenant user (incl. roles with no revenue
    // permission) could use it as an arrears-balance probing oracle over any
    // assessee identifier in the tenant.
    requireRole(ctx, REVENUE_ROLES);
    const body = fetchBillBody.parse(req.body);

    // GAP2-REVENUE-BBPS-11: resolve the free-text identifier to a real assessee
    // SYNCHRONOUSLY and reject an unknown one with 404 here, instead of
    // returning 202 and letting the consumer silently no-op (`if (!dcb) return`)
    // on an identifier that maps to nothing. A fire-and-forget 202 for an
    // unknown identifier presents a failed lookup as success and leaves the
    // caller no way to learn it was unknown.
    const dcb = await repo.getDcbOutstanding(ctx.tenantId, body.assesseeIdentifier);
    if (!dcb) {
      throw new HttpError(404, "ASSESSEE_NOT_FOUND", "No assessee matches this identifier");
    }

    const result = await commands.fetchBill(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/revenue/bbps/pay-bill ────────────────────────────────────────
  //
  // SEC-001: this used to publish payBill straight from client-supplied
  // assesseeIdentifier/amountMinor/bbpsTxnId with no role check and no proof
  // any BBPS payment ever happened — any authenticated user could fabricate a
  // successful tax payment, a DCB collection, and a GL-bound event.
  //
  // requireRole — same REVENUE_ROLES gate collection/routes.ts uses for every
  // other collection-writing endpoint — closes the "ANY authenticated user"
  // part of that gap: only revenue/collection staff can call this route now.
  //
  // KNOWN RESIDUAL LIMITATION (not closed by this route, be honest about it):
  // there is still no live NPCI BBPS gateway integration in this codebase
  // (see the STUB NOTE in domain.ts), so nothing here cryptographically
  // proves a real BBPS payment occurred — a revenue-role user can still
  // submit a fabricated bbpsTxnId/amount and it will be accepted. A prior
  // version of this route additionally required an `x-bbps-signature` HMAC
  // header (`verifyBbpsCallback` in domain.ts), modeled on billing-service's
  // Razorpay *webhook* verification. That was wrong for THIS route: the real
  // caller is `PayBillForm.tsx`, a staff browser form that has no access to
  // (and should never see) the signing secret, so requiring both role AND
  // signature made every real call 400 MISSING_SIGNATURE. A signed-callback
  // check only makes sense on a separate, unauthenticated, gateway-facing
  // webhook route — see billing-service's
  // `POST /v1/billing/webhooks/razorpay` for that pattern — which is a
  // distinct, larger piece of future work once a real BBPS gateway exists,
  // not something this route can fake today.
  //
  // The consumer's amount bound (validateBbpsPayment: amount > 0 and <= the
  // assessee's real DCB outstanding, re-read fresh inside the transaction)
  // and the new per-tenant bbpsTxnId replay/duplicate protection (see
  // consumer.ts + migrations/0006_bbps_replay_protection.sql) remain as
  // defense in depth on top of the role gate.

  app.post("/v1/revenue/bbps/pay-bill", async (req, reply) => {
    if (!isBbpsEnabled()) {
      throw new HttpError(403, "BBPS_DISABLED", "BBPS not enabled");
    }
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);

    const body = payBillBody.parse(req.body);
    const result = await commands.payBill(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/revenue/bbps/requests/:id ─────────────────────────────────────
  // GAP-REVENUE-BBPS-02: poll the outcome of a fire-and-forget fetch/pay request
  // by the queue messageId returned at submit time. Returns status
  // (pending|success|failed), the resulting receiptId on success, and a human
  // failure reason on failure. Tenant-scoped (a payment outcome is sensitive).
  app.get("/v1/revenue/bbps/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const { id } = uuidParam.parse(req.params);
    const request = await repo.findRequestByMessageId(ctx.tenantId, id);
    if (!request) {
      // Not yet consumed (still queued) OR unknown id — report pending rather
      // than 404 so the client poller keeps waiting through the async window.
      return reply.send({ data: { messageId: id, status: "pending" } });
    }
    return reply.send({ data: request });
  });

  // ── GET /v1/revenue/bbps/requests ─────────────────────────────────────────
  // GAP-REVENUE-BBPS-02: the "Recent BBPS requests" list. Tenant-scoped.
  app.get("/v1/revenue/bbps/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);
    const q = paginationQuery.parse(req.query);
    const { rows, total } = await repo.listRequests(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });
}
