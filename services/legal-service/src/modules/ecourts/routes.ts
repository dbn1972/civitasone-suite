import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cnrParam } from "./validators.js";
import { lookupCnr, ECourtsAdapterError, getBreakerState } from "./adapter.js";
import { CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

const LEGAL_ROLES = ["legal_officer", "legal_admin", "super_admin"];

export async function ecourtsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/legal/ecourts/cases/:cnr
   *
   * Look up a case by CNR number from e-Courts/NJDG.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.get("/v1/legal/ecourts/cases/:cnr", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);

    const { cnr } = cnrParam.parse(req.params);

    try {
      const result = await lookupCnr(cnr);
      return reply.send({ data: result });
    } catch (err) {
      if (err instanceof ECourtsAdapterError && err.code === "INTEGRATION_DISABLED") {
        return reply.code(503).send({
          error: {
            code: "INTEGRATION_DISABLED",
            message: "e-Courts integration is not available",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof CircuitBreakerOpenError) {
        return reply.code(503).send({
          error: {
            code: "CIRCUIT_OPEN",
            message: "e-Courts service is temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof ECourtsAdapterError) {
        // Upstream API error — log without PII, return generic error
        req.log.error({ code: err.code, httpStatus: err.httpStatus }, "e-Courts API error");
        return reply.code(502).send({
          error: {
            code: "UPSTREAM_ERROR",
            message: "e-Courts service returned an error",
            correlationId: req.id,
          },
        });
      }

      throw err;
    }
  });
}
