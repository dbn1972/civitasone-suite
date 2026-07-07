/**
 * GSTN routes — Government Rail integration for GST return filing
 * and GSTIN verification via the Goods and Services Tax Network.
 *
 * Routes:
 *   POST /v1/billing/gstn/returns              — submit a GST return
 *   GET  /v1/billing/gstn/returns/:ref/status   — check return filing status
 *   GET  /v1/billing/gstn/gstin/:gstin/verify   — verify a GSTIN number
 *
 * Env-gated: returns 503 INTEGRATION_DISABLED when GSTN_ENABLED !== 'true'.
 * Circuit-breaker: 503 CIRCUIT_OPEN when breaker is tripped.
 * No PII in logs — only correlation IDs, status codes, and timing.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import {
  submitGstReturn,
  verifyGstin,
  fetchReturnStatus,
  GstnAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";

const BILLING_ROLES = ["finance_officer", "finance_admin", "billing_admin", "tenant_admin", "super_admin"];

const gstReturnBody = z.object({
  gstin: z.string().length(15),
  returnPeriod: z.string().regex(/^\d{2}\/\d{4}$/),
  returnType: z.enum(["GSTR1", "GSTR3B", "GSTR9", "GSTR9C"]),
  totalTaxableValue: z.string().regex(/^\d+$/),
  totalCgst: z.string().regex(/^\d+$/),
  totalSgst: z.string().regex(/^\d+$/),
  totalIgst: z.string().regex(/^\d+$/),
});

const returnRefParam = z.object({
  ref: z.string().min(1).max(128),
});

const gstinParam = z.object({
  gstin: z.string().length(15),
});

function handleAdapterError(err: unknown, correlationId: string): { code: number; body: object } {
  if (err instanceof GstnAdapterError && err.code === "INTEGRATION_DISABLED") {
    return {
      code: 503,
      body: {
        error: {
          code: "INTEGRATION_DISABLED",
          message: "GSTN integration is not available",
          correlationId,
        },
      },
    };
  }

  if (err instanceof CircuitBreakerOpenError) {
    return {
      code: 503,
      body: {
        error: {
          code: "CIRCUIT_OPEN",
          message: "GSTN service is temporarily unavailable",
          correlationId,
        },
      },
    };
  }

  if (err instanceof GstnAdapterError) {
    return {
      code: 502,
      body: {
        error: {
          code: "EXTERNAL_FAILURE",
          message: "GSTN service returned an error",
          correlationId,
        },
      },
    };
  }

  // Unknown error — rethrow for the global handler
  throw err;
}

export async function gstnRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/billing/gstn/returns
   *
   * Submit a GST return filing.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.post("/v1/billing/gstn/returns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);

    const body = gstReturnBody.parse(req.body);
    const startMs = Date.now();

    try {
      const result = await submitGstReturn({
        gstin: body.gstin,
        returnPeriod: body.returnPeriod,
        returnType: body.returnType,
        totalTaxableValue: body.totalTaxableValue,
        totalCgst: body.totalCgst,
        totalSgst: body.totalSgst,
        totalIgst: body.totalIgst,
      });

      req.log.info(
        { adapter: "gstn", action: "submitGstReturn", durationMs: Date.now() - startMs, status: "success" },
        "GSTN return submitted",
      );

      return reply.code(201).send({ data: result });
    } catch (err) {
      req.log.error(
        { adapter: "gstn", action: "submitGstReturn", durationMs: Date.now() - startMs },
        "GSTN return submission failed",
      );

      const { code, body: errorBody } = handleAdapterError(err, req.id);
      return reply.code(code).send(errorBody);
    }
  });

  /**
   * GET /v1/billing/gstn/returns/:ref/status
   *
   * Check the status of a previously submitted GST return.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.get("/v1/billing/gstn/returns/:ref/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);

    const { ref } = returnRefParam.parse(req.params);
    const startMs = Date.now();

    try {
      const result = await fetchReturnStatus(ref);

      req.log.info(
        { adapter: "gstn", action: "fetchReturnStatus", durationMs: Date.now() - startMs, status: "success" },
        "GSTN return status fetched",
      );

      return reply.send({ data: result });
    } catch (err) {
      req.log.error(
        { adapter: "gstn", action: "fetchReturnStatus", durationMs: Date.now() - startMs },
        "GSTN return status check failed",
      );

      const { code, body: errorBody } = handleAdapterError(err, req.id);
      return reply.code(code).send(errorBody);
    }
  });

  /**
   * GET /v1/billing/gstn/gstin/:gstin/verify
   *
   * Verify a GSTIN number against GSTN registry.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.get("/v1/billing/gstn/gstin/:gstin/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);

    const { gstin } = gstinParam.parse(req.params);
    const startMs = Date.now();

    try {
      const result = await verifyGstin(gstin);

      req.log.info(
        { adapter: "gstn", action: "verifyGstin", durationMs: Date.now() - startMs, status: "success" },
        "GSTIN verification completed",
      );

      return reply.send({ data: result });
    } catch (err) {
      req.log.error(
        { adapter: "gstn", action: "verifyGstin", durationMs: Date.now() - startMs },
        "GSTIN verification failed",
      );

      const { code, body: errorBody } = handleAdapterError(err, req.id);
      return reply.code(code).send(errorBody);
    }
  });
}
