/**
 * Inference Routes — POST /v1/ml/predict
 *
 * Unified prediction endpoint with:
 * - Zod request validation
 * - JWT tenant validation (403 on mismatch)
 * - Feature flag gating (FEATURE_ML_ENABLED)
 * - Graceful degradation (never 5xx — always HTTP 200 with fallback)
 *
 * Validates: Requirements 3.1, 3.6, 16.1, 16.5, 17.2
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { predict, type PredictionRequest } from "./domain.js";

const VALID_DOMAINS = ["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"] as const;

const predictRequestSchema = z.object({
  domain: z.enum(VALID_DOMAINS),
  entityId: z.string().uuid(),
  tenantId: z.string().uuid(),
  features: z.record(z.union([z.number(), z.string()])).optional(),
  experimentId: z.string().max(128).optional(),
});

export async function inferenceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/ml/predict
   *
   * Unified prediction endpoint. Accepts a domain, entity, and optional feature overrides.
   * Returns prediction with confidence, explainability factors, and advisory flag.
   *
   * NEVER returns HTTP 5xx — all errors produce HTTP 200 with fallback response.
   */
  app.post("/v1/ml/predict", async (req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;

    // Feature flag gate — immediate fallback if disabled
    if (process.env.FEATURE_ML_ENABLED !== "true") {
      return reply.send({
        prediction: null,
        confidence: 0,
        factors: [],
        fallback: true,
        reason: "feature_disabled",
        advisory: true,
      });
    }

    // Validate request body
    let body: z.infer<typeof predictRequestSchema>;
    try {
      body = predictRequestSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_FAILED",
            message: "invalid request body",
            details: err.errors,
            correlationId,
          },
        });
      }
      throw err;
    }

    // JWT tenant validation — extract tid from JWT, compare with request tenantId
    try {
      const ctx = resolveContext(req);
      if (ctx.tenantId !== body.tenantId) {
        return reply.code(403).send({
          error: {
            code: "TENANT_MISMATCH",
            message: "JWT tenantId does not match request tenantId",
            correlationId,
          },
        });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.code(err.status).send({
          error: {
            code: err.code,
            message: err.message,
            correlationId,
          },
        });
      }
      // If auth fails unexpectedly, return fallback (never 5xx)
      return reply.send({
        prediction: null,
        confidence: 0,
        factors: [],
        fallback: true,
        reason: "auth_error",
        advisory: true,
      });
    }

    // Execute prediction — this NEVER throws, always returns a response
    const request: PredictionRequest = {
      tenantId: body.tenantId,
      domain: body.domain,
      entityId: body.entityId,
      features: body.features,
      experimentId: body.experimentId,
    };

    const response = await predict(request, correlationId);
    return reply.send(response);
  });

  // ─── Error Handler — ensures we never return 5xx ──────────────────────────
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;

    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "invalid request",
          details: err.errors,
          correlationId,
        },
      });
    }

    if (err instanceof HttpError) {
      return reply.code(err.status).send({
        error: {
          code: err.code,
          message: err.message,
          correlationId,
        },
      });
    }

    // For any unexpected error, return fallback response (never 5xx)
    req.log.error({ err, correlationId }, "unexpected error in inference route — returning fallback");
    return reply.code(200).send({
      prediction: null,
      confidence: 0,
      factors: [],
      fallback: true,
      reason: "internal_error",
      advisory: true,
    });
  });
}
