/**
 * TRACES routes — TDS return submission and PAN verification
 * via the env-gated Government Rail Adapter.
 *
 * Routes:
 *   POST /v1/finance/traces/tds-returns  — Submit a TDS return
 *   GET  /v1/finance/traces/pan-status/:pan — Verify PAN status
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  submitTdsReturn,
  verifyPanStatus,
  TracesAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function tracesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/finance/traces/tds-returns
   *
   * Submit a TDS return to TRACES.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.post("/v1/finance/traces/tds-returns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const body = z.object({
      tanNumber: z.string().min(1).max(10),
      formType: z.enum(["24Q", "26Q", "27Q", "27EQ"]),
      quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
      financialYear: z.string().regex(/^\d{4}-\d{2}$/),
      deductees: z.array(z.object({
        pan: z.string().min(1).max(10),
        name: z.string().min(1).max(256),
        amountPaidMinor: z.number().int().positive(),
        tdsDeductedMinor: z.number().int().min(0),
        section: z.string().min(1).max(10),
      })).min(1).max(5000),
    }).parse(req.body);

    try {
      const result = await submitTdsReturn({
        tanNumber: body.tanNumber,
        formType: body.formType,
        quarter: body.quarter,
        financialYear: body.financialYear,
        deductees: body.deductees.map((d) => ({
          pan: d.pan,
          name: d.name,
          amountPaidMinor: BigInt(d.amountPaidMinor),
          tdsDeductedMinor: BigInt(d.tdsDeductedMinor),
          section: d.section,
        })),
      });
      return reply.code(202).send({ data: result });
    } catch (err) {
      return handleAdapterError(err, req, reply);
    }
  });

  /**
   * GET /v1/finance/traces/pan-status/:pan
   *
   * Verify PAN status via TRACES.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.get("/v1/finance/traces/pan-status/:pan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const { pan } = z.object({
      pan: z.string().min(1).max(10),
    }).parse(req.params);

    try {
      const result = await verifyPanStatus(pan);
      return reply.send({ data: result });
    } catch (err) {
      return handleAdapterError(err, req, reply);
    }
  });
}

function handleAdapterError(err: unknown, req: any, reply: any) {
  if (err instanceof TracesAdapterError && err.code === "INTEGRATION_DISABLED") {
    return reply.code(503).send({
      error: {
        code: "INTEGRATION_DISABLED",
        message: "TRACES integration is not available",
        correlationId: req.id,
      },
    });
  }

  if (err instanceof CircuitBreakerOpenError) {
    return reply.code(503).send({
      error: {
        code: "CIRCUIT_OPEN",
        message: "TRACES service is temporarily unavailable",
        correlationId: req.id,
      },
    });
  }

  if (err instanceof TracesAdapterError) {
    // Upstream API error — log without PII, return generic error
    req.log.error({ code: err.code, httpStatus: err.httpStatus }, "TRACES API error");
    return reply.code(502).send({
      error: {
        code: "UPSTREAM_ERROR",
        message: "TRACES service returned an error",
        correlationId: req.id,
      },
    });
  }

  throw err;
}
