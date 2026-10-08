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
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import {
  submitGstReturn,
  verifyGstin,
  fetchReturnStatus,
  GstnAdapterError,
  CircuitBreakerOpenError,
  isEnabled,
  getBreakerState,
} from "./adapter.js";

const BILLING_ROLES = ["finance_officer", "finance_admin", "billing_admin", "tenant_admin", "super_admin"];

// GAP2-BILLING-GSTN-10: a government GST return filing is a material, legally
// significant mutation. CLAUDE.md §3.8 requires every mutation to emit an audit
// event. The gstn module has no DB transaction (the adapter is a thin external
// pass-through), so we publish an audit.event.record command directly around the
// adapter call — on both the success and failure branches — capturing actor,
// tenant, gstin, period, return type, the four tax totals and the outcome.
const AUDIT_TOPIC = "audit.event.record";

// GAP2-BILLING-GSTN-11: tighten the statutory-filing input beyond the previous
// bare `/^\d+$/` / `\d{2}/\d{4}` regexes. A paise ceiling guards against a
// fat-fingered absurd amount being forwarded to the live portal; the period
// refine enforces a real month (01–12) and a plausible year window.
//
// 10^15 paise = ₹10,000 crore — far above any realistic single GST return line,
// while still well within bigint/DB range. Values at/above this are almost
// certainly data-entry errors and are rejected before dispatch.
const MAX_TAX_PAISE = 10n ** 15n;

function withinPaiseCeiling(v: string): boolean {
  // v already matches /^\d+$/ by the time refine runs.
  try {
    return BigInt(v) <= MAX_TAX_PAISE;
  } catch {
    return false;
  }
}

const gstReturnBody = z
  .object({
    gstin: z.string().length(15),
    returnPeriod: z
      .string()
      .regex(/^\d{2}\/\d{4}$/)
      .refine(
        (p) => {
          const [mm, yyyy] = p.split("/");
          const month = Number(mm);
          const year = Number(yyyy);
          return month >= 1 && month <= 12 && year >= 2017 && year <= 2099;
        },
        { message: "returnPeriod must be MM/YYYY with month 01–12 and year 2017–2099" },
      ),
    returnType: z.enum(["GSTR1", "GSTR3B", "GSTR9", "GSTR9C"]),
    totalTaxableValue: z.string().regex(/^\d+$/).refine(withinPaiseCeiling, { message: "totalTaxableValue exceeds the sane paise ceiling" }),
    totalCgst: z.string().regex(/^\d+$/).refine(withinPaiseCeiling, { message: "totalCgst exceeds the sane paise ceiling" }),
    totalSgst: z.string().regex(/^\d+$/).refine(withinPaiseCeiling, { message: "totalSgst exceeds the sane paise ceiling" }),
    totalIgst: z.string().regex(/^\d+$/).refine(withinPaiseCeiling, { message: "totalIgst exceeds the sane paise ceiling" }),
  })
  .refine(
    (b) => {
      // Cross-field sanity: an intra-state return carries CGST+SGST (and no
      // IGST); an inter-state return carries IGST (and no CGST/SGST). Reject the
      // physically impossible "all three non-zero" combination.
      const cgst = BigInt(b.totalCgst);
      const sgst = BigInt(b.totalSgst);
      const igst = BigInt(b.totalIgst);
      const hasIntra = cgst > 0n || sgst > 0n;
      const hasInter = igst > 0n;
      return !(hasIntra && hasInter);
    },
    { message: "a return cannot carry both CGST/SGST and IGST" },
  );

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
   * GET /v1/billing/gstn/status
   *
   * GAP-BILLING-GSTN-08: lets the console tell up-front whether GSTN is enabled
   * in this environment (instead of the user learning only from a failed
   * filing). Read-only, role-gated like the rest of the console. Returns the
   * adapter's enabled flag and the circuit-breaker state. No PII, no secrets.
   */
  app.get("/v1/billing/gstn/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BILLING_ROLES);
    return reply.send({ data: { enabled: isEnabled(), breaker: getBreakerState() } });
  });

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

    // GAP2-BILLING-GSTN-11: parse explicitly and raise a clean 400 (HttpError)
    // on invalid input, so a bad period/amount is rejected deterministically
    // BEFORE any adapter dispatch — not surfaced as a 500 (the gstn plugin has
    // no scoped ZodError handler).
    const parsed = gstReturnBody.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      throw new HttpError(400, "VALIDATION_FAILED", msg);
    }
    const body = parsed.data;
    const startMs = Date.now();

    // GAP2-BILLING-GSTN-10: common audit fields for this filing. The four tax
    // totals, gstin, period and return type are recorded on every outcome so a
    // statutory filing always leaves an actor/tenant/amount/outcome trail.
    const auditBase = {
      service: "billing",
      resourceType: "gstn_return",
      gstin: body.gstin,
      returnPeriod: body.returnPeriod,
      returnType: body.returnType,
      totalTaxableValue: body.totalTaxableValue,
      totalCgst: body.totalCgst,
      totalSgst: body.totalSgst,
      totalIgst: body.totalIgst,
    };

    async function publishAudit(outcome: string, extra: Record<string, unknown> = {}): Promise<void> {
      const messageId = randomUUID();
      await queue
        .publish(AUDIT_TOPIC, {
          messageId,
          type: AUDIT_TOPIC,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          schemaVersion: "1.0",
          payload: { ...auditBase, action: "gstn_return_filed", outcome, ...extra },
        })
        .catch(() => {/* best-effort audit; never block the filing path */});
    }

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

      await publishAudit("success", { referenceId: result.referenceId, returnStatus: result.status });

      return reply.code(201).send({ data: result });
    } catch (err) {
      req.log.error(
        { adapter: "gstn", action: "submitGstReturn", durationMs: Date.now() - startMs },
        "GSTN return submission failed",
      );

      // Map the failure to a specific outcome so the audit trail distinguishes a
      // tripped breaker from an external failure from a disabled integration.
      const outcome =
        err instanceof CircuitBreakerOpenError
          ? "circuit_open"
          : err instanceof GstnAdapterError && err.code === "INTEGRATION_DISABLED"
            ? "integration_disabled"
            : "external_failure";
      await publishAudit(outcome);

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
