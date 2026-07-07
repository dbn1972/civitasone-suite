/**
 * NACH/APBS routes — Government Rail integration for mandate management
 * and bulk salary payment via the NACH (National Automated Clearing House).
 *
 * Routes:
 *   POST /v1/payroll/nach/mandates           — submit a new mandate
 *   GET  /v1/payroll/nach/mandates/:ref/status — check mandate status
 *
 * Env-gated: returns 503 INTEGRATION_DISABLED when NACH_ENABLED !== 'true'.
 * Circuit-breaker: 503 CIRCUIT_OPEN when breaker is tripped.
 * No PII in logs — only correlation IDs, status codes, and timing.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import {
  submitMandate,
  checkMandateStatus,
  submitBulkPayment,
  NachAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "finance_officer", "super_admin"];

const mandateBody = z.object({
  employeeRef: z.string().uuid(),
  amountMinor: z.coerce.bigint().positive(),
  frequency: z.enum(["monthly", "quarterly", "yearly", "one-time"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountType: z.enum(["savings", "current"]),
  umrn: z.string().max(64).optional(),
});

const mandateRefParam = z.object({
  ref: z.string().min(1).max(128),
});

function handleAdapterError(err: unknown, correlationId: string): { code: number; body: object } {
  if (err instanceof NachAdapterError && err.code === "INTEGRATION_DISABLED") {
    return {
      code: 503,
      body: {
        error: {
          code: "INTEGRATION_DISABLED",
          message: "NACH/APBS integration is not available",
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
          message: "NACH/APBS service is temporarily unavailable",
          correlationId,
        },
      },
    };
  }

  if (err instanceof NachAdapterError) {
    return {
      code: 502,
      body: {
        error: {
          code: "EXTERNAL_FAILURE",
          message: "NACH/APBS service returned an error",
          correlationId,
        },
      },
    };
  }

  // Unknown error — rethrow for the global handler
  throw err;
}

export async function nachRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/payroll/nach/mandates
   *
   * Submit a new NACH mandate registration.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.post("/v1/payroll/nach/mandates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);

    let body: z.infer<typeof mandateBody>;
    try {
      body = mandateBody.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_FAILED",
            message: "invalid request",
            correlationId: req.id,
            fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
          },
        });
      }
      throw err;
    }

    const startMs = Date.now();

    try {
      const result = await submitMandate({
        employeeRef: body.employeeRef,
        amountMinor: body.amountMinor,
        frequency: body.frequency,
        startDate: body.startDate,
        endDate: body.endDate,
        accountType: body.accountType,
        umrn: body.umrn,
      });

      req.log.info(
        { adapter: "nach", action: "submitMandate", durationMs: Date.now() - startMs, status: "success" },
        "NACH mandate submitted",
      );

      return reply.code(201).send({ data: result });
    } catch (err) {
      req.log.error(
        { adapter: "nach", action: "submitMandate", durationMs: Date.now() - startMs },
        "NACH mandate submission failed",
      );

      const { code, body: errorBody } = handleAdapterError(err, req.id);
      return reply.code(code).send(errorBody);
    }
  });

  /**
   * GET /v1/payroll/nach/mandates/:ref/status
   *
   * Check the status of a NACH mandate.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.get("/v1/payroll/nach/mandates/:ref/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);

    const { ref } = mandateRefParam.parse(req.params);
    const startMs = Date.now();

    try {
      const result = await checkMandateStatus(ref);

      req.log.info(
        { adapter: "nach", action: "checkMandateStatus", durationMs: Date.now() - startMs, status: "success" },
        "NACH mandate status checked",
      );

      return reply.send({ data: result });
    } catch (err) {
      req.log.error(
        { adapter: "nach", action: "checkMandateStatus", durationMs: Date.now() - startMs },
        "NACH mandate status check failed",
      );

      const { code, body: errorBody } = handleAdapterError(err, req.id);
      return reply.code(code).send(errorBody);
    }
  });
}
