/**
 * G20 — Serviceability route.
 *
 * GET /v1/crm/serviceability?originPin=&destinationPin=&articleType=
 *
 * Proxies to the apt-adapter with circuit-breaking, caching, and graceful
 * degradation. Never returns 500 for adapter unavailability — returns
 * `{ degraded: true }` instead.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { serviceabilityQuery } from "./validators.js";
import { checkServiceability } from "./port.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

export async function serviceabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/serviceability", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const query = serviceabilityQuery.parse(req.query);
    const result = await checkServiceability(
      ctx.tenantId,
      query.originPin,
      query.destinationPin,
      query.articleType,
    );

    return reply.send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({
        code: err.code,
        message: err.message,
        correlationId,
        retryable: false,
      });
    }
    req.log.error({ err }, "unhandled error in serviceability route");
    return reply.code(500).send({
      code: "INTERNAL",
      message: "internal error",
      correlationId,
      retryable: true,
    });
  });
}
