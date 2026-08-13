import type { FastifyInstance } from "fastify";
import z from "zod";
import { ZodError } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { allowedModesForValue, bandLabel } from "./mode-bands.js";

/**
 * GFR 2017 procurement-mode band HTTP routes.
 *
 * GET /v1/procurement/gfr/mode-bands
 *   Returns the permissible procurement modes for an estimated value (paise).
 *   Query params:
 *     estimatedMinor  — estimated value in paise (bigint-safe integer string). Default 0.
 *
 * Requires authentication. Any authenticated role may read the reference data.
 */
export async function gfrRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/gfr/mode-bands", async (req, reply) => {
    resolveContext(req); // ensures authentication
    const q = z
      .object({ estimatedMinor: z.string().regex(/^\d+$/).optional() })
      .parse(req.query);
    const estimatedMinor = q.estimatedMinor != null ? BigInt(q.estimatedMinor) : 0n;
    const modes = allowedModesForValue(estimatedMinor);
    return reply.send({
      estimatedMinor: String(estimatedMinor),
      band: bandLabel(estimatedMinor),
      permittedModes: modes,
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
