/**
 * Geocoding adapter HTTP routes.
 *
 * POST /v1/locations/geocode — Forward or reverse geocode
 *   Body: { address: string } OR { lat: number, lng: number }
 *
 * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
 * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
 * Returns 502 with UPSTREAM_ERROR on geocoding API failures.
 *
 * No PII in logs — only correlation IDs, adapter name, and status codes.
 */

import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { geocodeBody } from "./validators.js";
import {
  geocodeAddress,
  reverseGeocode,
  GeocodingAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";

const LOCATION_ROLES = ["location_user", "location_admin", "super_admin", "admin"];

export async function geocodingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/locations/geocode
   *
   * Forward geocode: { address: "..." } → { data: { lat, lng } }
   * Reverse geocode: { lat, lng } → { data: { address } }
   *
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.post("/v1/locations/geocode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);

    let body: ReturnType<typeof geocodeBody.parse>;
    try {
      body = geocodeBody.parse(req.body);
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
      if ("address" in body) {
        const result = await geocodeAddress(body.address);
        return reply.send({ data: result });
      } else {
        const result = await reverseGeocode(body.lat, body.lng);
        return reply.send({ data: result });
      }
    } catch (err) {
      if (err instanceof GeocodingAdapterError && err.code === "INTEGRATION_DISABLED") {
        req.log.warn({ adapter: "geocoding", correlationId: req.id }, "Geocoding adapter disabled");
        return reply.code(503).send({
          error: {
            code: "INTEGRATION_DISABLED",
            message: "Geocoding integration is not available",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof CircuitBreakerOpenError) {
        req.log.warn({ adapter: "geocoding", correlationId: req.id }, "Geocoding circuit breaker open");
        return reply.code(503).send({
          error: {
            code: "CIRCUIT_OPEN",
            message: "Geocoding service is temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof GeocodingAdapterError) {
        req.log.error(
          { adapter: "geocoding", code: err.code, httpStatus: err.httpStatus, correlationId: req.id },
          "Geocoding API error",
        );
        return reply.code(502).send({
          error: {
            code: "UPSTREAM_ERROR",
            message: "Geocoding service returned an error",
            correlationId: req.id,
          },
        });
      }

      throw err;
    }
  });
}
