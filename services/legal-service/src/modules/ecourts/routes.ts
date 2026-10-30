import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { cnrParam } from "./validators.js";
import { lookupCnr, ECourtsAdapterError } from "./adapter.js";
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

    // UAT W8-B: this module installs no error handler and app.ts registers the shared Zod->400
    // handler only AFTER the route plugins, so a thrown ZodError (e.g. a 36-char UUID > the 30-char
    // CNR cap) reached Fastify's default handler as a 500. Validate without throwing instead.
    const parsed = cnrParam.safeParse(req.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: parsed.error.issues[0]?.message ?? "invalid cnr",
          correlationId: req.id,
        },
      });
    }
    const { cnr } = parsed.data;

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
