/**
 * AI-powered grievance auto-triage route.
 *
 * POST /v1/citizen/grievances/:id/auto-triage
 *
 * Env-gated behind FEATURE_AI_ASSISTANT_ENABLED.
 * When disabled: returns 404 (FEATURE_NOT_AVAILABLE).
 * When circuit breaker is open: returns 503.
 *
 * The response is a RECOMMENDATION only — never auto-applied.
 * The user must confirm via a separate PATCH to apply triage fields.
 *
 * Validates: Requirements 20.6
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  isEnabled,
  AiAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";
import { triageGrievance } from "./auto-triage.js";

// ── Request schemas ───────────────────────────────────────────────

const triageParamsSchema = z.object({
  id: z.string().uuid(),
});

const triageBodySchema = z.object({
  text: z.string().min(1, "Grievance text must not be empty").max(2000, "Grievance text must not exceed 2000 characters"),
});

// ── Roles ─────────────────────────────────────────────────────────

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

// ── Route registration ────────────────────────────────────────────

export async function aiTriageRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/citizen/grievances/:id/auto-triage
   *
   * Submits grievance text for AI-powered triage recommendation.
   *
   * Body: { text: string } (max 2000 chars)
   * Response (202): { data: { category, priority, department, confidence } }
   *
   * The recommendation is clearly marked as AI-suggested and requires
   * explicit user confirmation before being applied (never auto-apply).
   *
   * Returns 404 when FEATURE_AI_ASSISTANT_ENABLED !== 'true'.
   * Returns 400 when text is empty or exceeds 2000 chars.
   * Returns 503 when circuit breaker is open or AI times out.
   */
  app.post("/v1/citizen/grievances/:id/auto-triage", async (req, reply) => {
    // Gate check: return 404 to completely hide AI functionality
    if (!isEnabled()) {
      return reply.code(404).send({
        error: {
          code: "FEATURE_NOT_AVAILABLE",
          message: "AI assistant is not available",
          correlationId: req.id,
        },
      });
    }

    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);

    // Validate path params
    const paramsResult = triageParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid grievance ID",
          details: paramsResult.error.flatten(),
          correlationId: req.id,
        },
      });
    }

    // Validate body
    const bodyResult = triageBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: bodyResult.error.flatten(),
          correlationId: req.id,
        },
      });
    }

    const { text } = bodyResult.data;

    try {
      const recommendation = await triageGrievance(text);

      // Return 202 Accepted — this is a suggestion, not an applied action.
      // The user must confirm via a separate PATCH endpoint.
      return reply.code(202).send({
        data: {
          ...recommendation,
          aiSuggested: true,
          grievanceId: paramsResult.data.id,
          message: "This is an AI-generated recommendation. Please confirm before applying.",
        },
      });
    } catch (err) {
      if (err instanceof AiAdapterError && err.code === "FEATURE_NOT_AVAILABLE") {
        return reply.code(404).send({
          error: {
            code: "FEATURE_NOT_AVAILABLE",
            message: "AI assistant is not available",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof CircuitBreakerOpenError) {
        return reply.code(503).send({
          error: {
            code: "CIRCUIT_OPEN",
            message: "AI service is temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError && err.code === "AI_TIMEOUT") {
        req.log.warn({ code: err.code }, "Auto-triage: Anthropic API timeout");
        return reply.code(503).send({
          error: {
            code: "AI_TIMEOUT",
            message: "AI service request timed out",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError) {
        req.log.error({ code: err.code, httpStatus: err.httpStatus }, "Auto-triage: Anthropic API error");
        return reply.code(503).send({
          error: {
            code: "AI_UNAVAILABLE",
            message: "AI features are temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      throw err;
    }
  });
}
