/**
 * GeM routes — Government e-Marketplace integration for product search,
 * product details, and order submission via the env-gated Government Rail Adapter.
 *
 * Routes:
 *   GET  /v1/procurement/gem/products?q=...   — search GeM catalog
 *   GET  /v1/procurement/gem/products/:id     — get product details
 *   POST /v1/procurement/gem/orders           — submit order to GeM
 *
 * Env-gated: returns 503 INTEGRATION_DISABLED when GEM_ENABLED !== 'true'.
 * Circuit-breaker: 503 CIRCUIT_OPEN when breaker is tripped.
 * No PII in logs — only correlation IDs, status codes, and timing.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  searchProducts,
  getProductDetails,
  submitOrder,
  GemAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";

const PROCUREMENT_ROLES = ["procurement_officer", "procurement_admin", "finance_officer", "tenant_admin", "super_admin"];

function handleAdapterError(err: unknown, correlationId: string): { code: number; body: object } {
  if (err instanceof GemAdapterError && err.code === "INTEGRATION_DISABLED") {
    return {
      code: 503,
      body: {
        error: {
          code: "INTEGRATION_DISABLED",
          message: "GeM integration is not available",
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
          message: "GeM service is temporarily unavailable",
          correlationId,
        },
      },
    };
  }

  if (err instanceof GemAdapterError) {
    return {
      code: 502,
      body: {
        error: {
          code: "EXTERNAL_FAILURE",
          message: "GeM service returned an error",
          correlationId,
        },
      },
    };
  }

  // Unknown error — re-throw for Fastify's error handler
  throw err;
}

export async function gemRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/procurement/gem/products?q=...
   *
   * Search GeM product catalog.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.get("/v1/procurement/gem/products", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROCUREMENT_ROLES);

    const query = z.object({
      q: z.string().min(1).max(256),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);

    const startMs = Date.now();
    try {
      const result = await searchProducts({
        q: query.q,
        page: query.page,
        pageSize: query.pageSize,
      });

      req.log.info(
        { adapter: "gem", action: "searchProducts", durationMs: Date.now() - startMs, status: "success" },
        "GeM product search completed",
      );

      return reply.send({ data: result.products, meta: { page: result.page, pageSize: result.pageSize, total: result.total } });
    } catch (err) {
      req.log.error(
        { adapter: "gem", action: "searchProducts", durationMs: Date.now() - startMs },
        "GeM product search failed",
      );

      const { code, body } = handleAdapterError(err, req.id);
      return reply.code(code).send(body);
    }
  });

  /**
   * GET /v1/procurement/gem/products/:id
   *
   * Get product details from GeM catalog.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.get("/v1/procurement/gem/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROCUREMENT_ROLES);

    const { id } = z.object({
      id: z.string().min(1).max(128),
    }).parse(req.params);

    const startMs = Date.now();
    try {
      const result = await getProductDetails(id);

      req.log.info(
        { adapter: "gem", action: "getProductDetails", durationMs: Date.now() - startMs, status: "success" },
        "GeM product details fetched",
      );

      return reply.send({ data: result });
    } catch (err) {
      req.log.error(
        { adapter: "gem", action: "getProductDetails", durationMs: Date.now() - startMs },
        "GeM product details fetch failed",
      );

      const { code, body } = handleAdapterError(err, req.id);
      return reply.code(code).send(body);
    }
  });

  /**
   * POST /v1/procurement/gem/orders
   *
   * Submit an order to GeM.
   * Returns 503 with INTEGRATION_DISABLED when adapter is not configured.
   * Returns 503 with CIRCUIT_OPEN when circuit breaker is open.
   */
  app.post("/v1/procurement/gem/orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROCUREMENT_ROLES);

    const body = z.object({
      items: z.array(z.object({
        productId: z.string().min(1).max(128),
        quantity: z.number().int().min(1),
        deliveryAddress: z.string().min(1).max(512),
      })).min(1).max(100),
      buyerOrganization: z.string().min(1).max(256),
      contactName: z.string().min(1).max(256),
      contactEmail: z.string().email().max(256),
      remarks: z.string().max(1000).optional(),
    }).parse(req.body);

    const startMs = Date.now();
    try {
      const result = await submitOrder(body);

      req.log.info(
        { adapter: "gem", action: "submitOrder", durationMs: Date.now() - startMs, status: "success" },
        "GeM order submitted",
      );

      return reply.code(202).send({ data: result });
    } catch (err) {
      req.log.error(
        { adapter: "gem", action: "submitOrder", durationMs: Date.now() - startMs },
        "GeM order submission failed",
      );

      const { code, body: errBody } = handleAdapterError(err, req.id);
      return reply.code(code).send(errBody);
    }
  });
}
