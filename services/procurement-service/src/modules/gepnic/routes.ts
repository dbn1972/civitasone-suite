/**
 * GePNIC routes — Government eProcurement System of NIC integration for tender
 * publication, tender fetch, and award-status via the env-gated adapter.
 *
 * Routes:
 *   POST /v1/procurement/gepnic/tenders           — publish a tender to GePNIC
 *   GET  /v1/procurement/gepnic/tenders/:id        — fetch published tender details
 *   GET  /v1/procurement/gepnic/tenders/:id/award  — award-of-contract status
 *
 * Env-gated: returns 503 INTEGRATION_DISABLED when GEPNIC_ENABLED !== 'true'.
 * Circuit-breaker: 503 CIRCUIT_OPEN when breaker is tripped.
 * Validation: 400 VALIDATION_FAILED on bad input.
 * No PII in logs — only correlation IDs, status codes, and timing.
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import {
  publishTender,
  fetchTender,
  getAwardStatus,
  GepnicAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";

const PROCUREMENT_ROLES = ["procurement_officer", "procurement_admin", "finance_officer", "tenant_admin", "super_admin"];

function handleAdapterError(err: unknown, correlationId: string): { code: number; body: object } {
  if (err instanceof ZodError) {
    return {
      code: 400,
      body: { error: { code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) } },
    };
  }
  if (err instanceof GepnicAdapterError && err.code === "INTEGRATION_DISABLED") {
    return { code: 503, body: { error: { code: "INTEGRATION_DISABLED", message: "GePNIC integration is not available", correlationId } } };
  }
  if (err instanceof CircuitBreakerOpenError) {
    return { code: 503, body: { error: { code: "CIRCUIT_OPEN", message: "GePNIC service is temporarily unavailable", correlationId } } };
  }
  if (err instanceof GepnicAdapterError) {
    return { code: 502, body: { error: { code: "EXTERNAL_FAILURE", message: "GePNIC service returned an error", correlationId } } };
  }
  throw err;
}

const tenderBodySchema = z.object({
  referenceId: z.string().min(1).max(128),
  tenderTitle: z.string().min(1).max(512),
  departmentName: z.string().min(1).max(512),
  workCategory: z.string().min(1).max(256),
  procurementNature: z.enum(["goods", "works", "services"]),
  estimatedValueMinor: z.string().regex(/^\d+$/).max(20),
  currency: z.string().length(3).default("INR"),
  publishDate: z.string().datetime(),
  bidSubmissionEndAt: z.string().datetime(),
});

const idParamSchema = z.object({ id: z.string().min(1).max(128) });

export async function gepnicRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/gepnic/tenders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROCUREMENT_ROLES);
    const startMs = Date.now();
    try {
      const body = tenderBodySchema.parse(req.body);
      const result = await publishTender(body);
      req.log.info({ adapter: "gepnic", action: "publishTender", durationMs: Date.now() - startMs, status: "success" }, "GePNIC tender published");
      return reply.code(202).send({ data: result });
    } catch (err) {
      req.log.error({ adapter: "gepnic", action: "publishTender", durationMs: Date.now() - startMs }, "GePNIC tender publish failed");
      const { code, body: errBody } = handleAdapterError(err, req.id);
      return reply.code(code).send(errBody);
    }
  });

  app.get("/v1/procurement/gepnic/tenders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROCUREMENT_ROLES);
    const startMs = Date.now();
    try {
      const { id } = idParamSchema.parse(req.params);
      const result = await fetchTender(id);
      req.log.info({ adapter: "gepnic", action: "fetchTender", durationMs: Date.now() - startMs, status: "success" }, "GePNIC tender fetched");
      return reply.send({ data: result });
    } catch (err) {
      req.log.error({ adapter: "gepnic", action: "fetchTender", durationMs: Date.now() - startMs }, "GePNIC tender fetch failed");
      const { code, body } = handleAdapterError(err, req.id);
      return reply.code(code).send(body);
    }
  });

  app.get("/v1/procurement/gepnic/tenders/:id/award", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROCUREMENT_ROLES);
    const startMs = Date.now();
    try {
      const { id } = idParamSchema.parse(req.params);
      const result = await getAwardStatus(id);
      req.log.info({ adapter: "gepnic", action: "getAwardStatus", durationMs: Date.now() - startMs, status: "success" }, "GePNIC award status fetched");
      return reply.send({ data: result });
    } catch (err) {
      req.log.error({ adapter: "gepnic", action: "getAwardStatus", durationMs: Date.now() - startMs }, "GePNIC award status fetch failed");
      const { code, body } = handleAdapterError(err, req.id);
      return reply.code(code).send(body);
    }
  });
}
