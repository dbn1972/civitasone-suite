/**
 * PFMS/e-Kuber adapter HTTP routes.
 *
 * POST /v1/finance/pfms/payments        — Submit payment to PFMS
 * GET  /v1/finance/pfms/payments/:ref/status — Check payment status
 *
 * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
 * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
 * Returns 502 with UPSTREAM_ERROR on PFMS API failures.
 *
 * No PII in logs — only correlation IDs, adapter name, and status codes.
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { submitPaymentBody, referenceParam } from "./validators.js";
import {
  submitPayment,
  checkStatus,
  PfmsAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function pfmsAdapterRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/finance/pfms/payments
   *
   * Submit a payment to PFMS/e-Kuber.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.post("/v1/finance/pfms/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    let body: z.infer<typeof submitPaymentBody>;
    try {
      body = submitPaymentBody.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid request body",
            details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
            correlationId: req.id,
          },
        });
      }
      throw err;
    }

    try {
      const result = await submitPayment({
        referenceId: body.referenceId,
        beneficiaryCode: body.beneficiaryCode,
        amount: body.amount,
        purposeCode: body.purposeCode,
        schemeCode: body.schemeCode,
        ddoCode: body.ddoCode,
        remarks: body.remarks,
      });
      return reply.code(201).send({ data: result });
    } catch (err) {
      if (err instanceof PfmsAdapterError && err.code === "INTEGRATION_DISABLED") {
        // No PII in logs — only adapter name and correlation ID
        req.log.warn({ adapter: "pfms", correlationId: req.id }, "PFMS adapter disabled");
        return reply.code(503).send({
          error: {
            code: "INTEGRATION_DISABLED",
            message: "PFMS integration is not available",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof CircuitBreakerOpenError) {
        req.log.warn({ adapter: "pfms", correlationId: req.id }, "PFMS circuit breaker open");
        return reply.code(503).send({
          error: {
            code: "CIRCUIT_OPEN",
            message: "PFMS service is temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof PfmsAdapterError) {
        // Log without PII — only status code, adapter name, correlation ID, timing
        req.log.error(
          { adapter: "pfms", code: err.code, httpStatus: err.httpStatus, correlationId: req.id },
          "PFMS API error",
        );
        return reply.code(502).send({
          error: {
            code: "UPSTREAM_ERROR",
            message: "PFMS service returned an error",
            correlationId: req.id,
          },
        });
      }

      throw err;
    }
  });

  /**
   * GET /v1/finance/pfms/payments/:ref/status
   *
   * Check payment status from PFMS/e-Kuber.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.get("/v1/finance/pfms/payments/:ref/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const { ref } = referenceParam.parse(req.params);

    try {
      const result = await checkStatus(ref);
      return reply.send({ data: result });
    } catch (err) {
      if (err instanceof PfmsAdapterError && err.code === "INTEGRATION_DISABLED") {
        req.log.warn({ adapter: "pfms", correlationId: req.id }, "PFMS adapter disabled");
        return reply.code(503).send({
          error: {
            code: "INTEGRATION_DISABLED",
            message: "PFMS integration is not available",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof CircuitBreakerOpenError) {
        req.log.warn({ adapter: "pfms", correlationId: req.id }, "PFMS circuit breaker open");
        return reply.code(503).send({
          error: {
            code: "CIRCUIT_OPEN",
            message: "PFMS service is temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof PfmsAdapterError) {
        req.log.error(
          { adapter: "pfms", code: err.code, httpStatus: err.httpStatus, correlationId: req.id },
          "PFMS API error",
        );
        return reply.code(502).send({
          error: {
            code: "UPSTREAM_ERROR",
            message: "PFMS service returned an error",
            correlationId: req.id,
          },
        });
      }

      throw err;
    }
  });
}
