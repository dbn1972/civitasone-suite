/**
 * CPPP routes — Central Public Procurement Portal integration for tender
 * publication, tender fetch, and bid-status via the env-gated adapter.
 *
 * Routes:
 *   POST /v1/procurement/cppp/tenders          — publish a tender to CPPP
 *   GET  /v1/procurement/cppp/tenders/:id       — fetch published tender details
 *   GET  /v1/procurement/cppp/tenders/:id/bids  — bid / evaluation status
 *
 * Env-gated: returns 503 INTEGRATION_DISABLED when CPPP_ENABLED !== 'true'.
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
  getBidStatus,
  CpppAdapterError,
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
  if (err instanceof CpppAdapterError && err.code === "INTEGRATION_DISABLED") {
    return { code: 503, body: { error: { code: "INTEGRATION_DISABLED", message: "CPPP integration is not available", correlationId } } };
  }
  if (err instanceof CircuitBreakerOpenError) {
    return { code: 503, body: { error: { code: "CIRCUIT_OPEN", message: "CPPP service is temporarily unavailable", correlationId } } };
  }
  if (err instanceof CpppAdapterError) {
    return { code: 502, body: { error: { code: "EXTERNAL_FAILURE", message: "CPPP service returned an error", correlationId } } };
  }
  throw err;
}

const tenderBodySchema = z.object({
  referenceId: z.string().min(1).max(128),
  title: z.string().min(1).max(512),
  organisationChain: z.string().min(1).max(512),
  tenderType: z.enum(["open", "limited", "single", "eoi"]),
  estimatedValueMinor: z.string().regex(/^\d+$/).max(20),
  currency: z.string().length(3).default("INR"),
  bidSubmissionEndAt: z.string().datetime(),
  documents: z.array(z.object({ name: z.string().min(1).max(256), url: z.string().url().max(1024) })).max(50).optional(),
});

const idParamSchema = z.object({ id: z.string().min(1).max(128) });

export async function cpppRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/cppp/tenders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROCUREMENT_ROLES);
    const startMs = Date.now();
    try {
      const body = tenderBodySchema.parse(req.body);
      const result = await publishTender(body);
      req.log.info({ adapter: "cppp", action: "publishTender", durationMs: Date.now() - startMs, status: "success" }, "CPPP tender published");
      return reply.code(202).send({ data: result });
    } catch (err) {
      req.log.error({ adapter: "cppp", action: "publishTender", durationMs: Date.now() - startMs }, "CPPP tender publish failed");
      const { code, body: errBody } = handleAdapterError(err, req.id);
      return reply.code(code).send(errBody);
    }
  });

  app.get("/v1/procurement/cppp/tenders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROCUREMENT_ROLES);
    const startMs = Date.now();
    try {
      const { id } = idParamSchema.parse(req.params);
      const result = await fetchTender(id);
      req.log.info({ adapter: "cppp", action: "fetchTender", durationMs: Date.now() - startMs, status: "success" }, "CPPP tender fetched");
      return reply.send({ data: result });
    } catch (err) {
      req.log.error({ adapter: "cppp", action: "fetchTender", durationMs: Date.now() - startMs }, "CPPP tender fetch failed");
      const { code, body } = handleAdapterError(err, req.id);
      return reply.code(code).send(body);
    }
  });

  app.get("/v1/procurement/cppp/tenders/:id/bids", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROCUREMENT_ROLES);
    const startMs = Date.now();
    try {
      const { id } = idParamSchema.parse(req.params);
      const result = await getBidStatus(id);
      req.log.info({ adapter: "cppp", action: "getBidStatus", durationMs: Date.now() - startMs, status: "success" }, "CPPP bid status fetched");
      return reply.send({ data: result });
    } catch (err) {
      req.log.error({ adapter: "cppp", action: "getBidStatus", durationMs: Date.now() - startMs }, "CPPP bid status fetch failed");
      const { code, body } = handleAdapterError(err, req.id);
      return reply.code(code).send(body);
    }
  });
}
