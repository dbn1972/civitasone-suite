/**
 * Routing HTTP routes.
 *
 * POST /v1/locations/routing — Compute distance/time between 2–25 waypoints
 *   Body: { waypoints: Array<{ lat: number, lng: number }> }
 *
 * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
 * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
 * Returns 502 with UPSTREAM_ERROR on routing API failures.
 *
 * No PII in logs — only correlation IDs, adapter name, and status codes.
 */

import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { routingBody } from "./validators.js";
import {
  computeRoute,
  RoutingAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";

const LOCATION_ROLES = ["location_user", "location_admin", "super_admin", "admin"];

export async function routingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/locations/routing
   *
   * Compute route between 2–25 waypoints.
   * Returns: { data: { distanceMeters, durationSeconds, polyline } }
   *
   * Returns 503 with INTEGRATION_DISABLED when routing provider not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   * Returns 502 with UPSTREAM_ERROR on routing API failures.
   */
  app.post("/v1/locations/routing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);

    let body: ReturnType<typeof routingBody.parse>;
    try {
      body = routingBody.parse(req.body);
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
      const result = await computeRoute(body.waypoints);
      return reply.send({ data: result });
    } catch (err) {
      if (err instanceof RoutingAdapterError && err.code === "INTEGRATION_DISABLED") {
        req.log.warn({ adapter: "routing", correlationId: req.id }, "Routing adapter disabled");
        return reply.code(503).send({
          error: {
            code: "INTEGRATION_DISABLED",
            message: "Routing integration is not available",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof CircuitBreakerOpenError) {
        req.log.warn({ adapter: "routing", correlationId: req.id }, "Routing circuit breaker open");
        return reply.code(503).send({
          error: {
            code: "CIRCUIT_OPEN",
            message: "Routing service is temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof RoutingAdapterError) {
        req.log.error(
          { adapter: "routing", code: err.code, httpStatus: err.httpStatus, correlationId: req.id },
          "Routing API error",
        );
        return reply.code(502).send({
          error: {
            code: "UPSTREAM_ERROR",
            message: "Routing service returned an error",
            correlationId: req.id,
          },
        });
      }

      throw err;
    }
  });
}
