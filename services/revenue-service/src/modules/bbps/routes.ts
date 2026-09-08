import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { isBbpsEnabled, verifyBbpsCallback } from "./domain.js";
import * as commands from "./commands.js";
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
    const body = fetchBillBody.parse(req.body);
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
  // Two independent controls now gate this, matching this codebase's two
  // established conventions rather than inventing new ones:
  //   1. requireRole — same REVENUE_ROLES gate collection/routes.ts uses for
  //      every other collection-writing endpoint (accountability: who is
  //      relaying this claim).
  //   2. verifyBbpsCallback — same HMAC-over-raw-body pattern billing-service
  //      uses for Razorpay's webhook (integrity: proof the claim really came
  //      from the BBPS gateway, since there is no live gateway to call out to
  //      and verify against synchronously in this environment — see the STUB
  //      NOTE in domain.ts).
  // Both must pass BEFORE the command is published — an unsigned/unverified
  // request never reaches the queue, so the consumer never runs and no rows
  // are written (see consumer.ts for the additional server-side amount
  // re-derivation from the DCB record, kept as defense in depth).

  app.post("/v1/revenue/bbps/pay-bill", async (req, reply) => {
    if (!isBbpsEnabled()) {
      throw new HttpError(403, "BBPS_DISABLED", "BBPS not enabled");
    }
    const ctx = resolveContext(req);
    requireRole(ctx, REVENUE_ROLES);

    const signature = req.headers["x-bbps-signature"] as string | undefined;
    if (!signature) {
      throw new HttpError(400, "MISSING_SIGNATURE", "x-bbps-signature header is required");
    }
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (!verifyBbpsCallback(rawBody, signature)) {
      throw new HttpError(400, "INVALID_BBPS_SIGNATURE", "BBPS callback signature verification failed");
    }

    const body = payBillBody.parse(req.body);
    const result = await commands.payBill(ctx, body);
    return reply.code(202).send({ data: result });
  });
}
