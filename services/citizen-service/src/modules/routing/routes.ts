/**
 * Enhanced citizen request routing route.
 *
 * GET /v1/citizen/requests/:id/routing
 *
 * Returns intelligent routing suggestions including multi-label category
 * classification, sentiment detection, urgency scoring, similar complaint
 * clusters, and resolution template recommendations.
 *
 * All recommendations are ADVISORY-ONLY — require operator confirmation.
 *
 * Falls back to keyword-based triage when LLM adapter is unavailable.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { computeRouting } from "./domain.js";

// ── Request schemas ───────────────────────────────────────────────

const routingParamsSchema = z.object({
  id: z.string().uuid(),
});

// ── Roles ─────────────────────────────────────────────────────────

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin", "tenant_admin"];

// ── Mock data sources (in production these would be DB queries) ───

/**
 * In a production system, these would query the citizen-service database
 * for existing complaints and historically-resolved templates.
 * For now we provide the interface for the route to work end-to-end
 * and use sample data. The route handler receives the request text from
 * a (simulated) DB lookup by request ID.
 */

interface CitizenRequest {
  id: string;
  tenantId: string;
  text: string;
  citizenId: string;
}

/**
 * Simulate fetching request text by ID.
 * In production: SELECT text, tenant_id FROM citizen_requests WHERE id = $id
 */
async function fetchRequestById(_id: string, _tenantId: string): Promise<CitizenRequest | null> {
  // Placeholder: returns null to indicate "not found" in real DB lookup.
  // The route will handle this as a 404.
  // Integration with actual DB is handled when citizen_requests table exists.
  return null;
}

/**
 * Simulate fetching existing complaints for clustering.
 * In production: SELECT id, text, summary FROM citizen_requests
 *   WHERE tenant_id = $tenantId AND status IN ('open', 'in_progress')
 *   ORDER BY created_at DESC LIMIT 100
 */
async function fetchExistingComplaints(_tenantId: string): Promise<Array<{ id: string; text: string; summary: string }>> {
  return [];
}

/**
 * Simulate fetching historically-resolved templates.
 * In production: SELECT id, title, resolution_text FROM resolution_templates
 *   WHERE tenant_id = $tenantId AND success_rate > 0.5
 *   ORDER BY success_rate DESC LIMIT 50
 */
async function fetchResolvedTemplates(_tenantId: string): Promise<Array<{ id: string; title: string; text: string }>> {
  return [];
}

// ── Route registration ────────────────────────────────────────────

export async function citizenRoutingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/citizen/requests/:id/routing
   *
   * Compute intelligent routing suggestions for a citizen request.
   *
   * Params: { id: uuid }
   * Query: { text?: string } — optional override text for the request
   *   (used when the request hasn't been persisted yet, e.g., preview mode)
   *
   * Response (200): {
   *   data: {
   *     categories: Array<{ category: string, confidence: number }>,
   *     sentiment: "positive" | "neutral" | "negative",
   *     urgency: "low" | "medium" | "high" | "critical",
   *     similarComplaints: Array<{ requestId, similarity, summary }>,
   *     resolutionSuggestions: Array<{ templateId, title, confidence }>,
   *     advisory: true,
   *     isFallback: boolean
   *   }
   * }
   *
   * Returns 400 for invalid request ID.
   * Returns 404 when request not found and no text query param provided.
   * All suggestions are advisory — require operator confirmation.
   */
  app.get("/v1/citizen/requests/:id/routing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);

    // Validate path params
    const paramsResult = routingParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request ID",
          details: paramsResult.error.flatten(),
          correlationId: req.id,
        },
      });
    }

    const { id } = paramsResult.data;

    // Get text from query param or from database
    const query = req.query as Record<string, string | undefined>;
    let requestText = query.text;

    if (!requestText) {
      // Attempt to fetch from DB
      const citizenRequest = await fetchRequestById(id, ctx.tenantId);
      if (!citizenRequest) {
        throw new HttpError(404, "NOT_FOUND", "Citizen request not found");
      }
      // Verify tenant isolation
      if (citizenRequest.tenantId !== ctx.tenantId) {
        throw new HttpError(404, "NOT_FOUND", "Citizen request not found");
      }
      requestText = citizenRequest.text;
    }

    if (!requestText || requestText.trim().length === 0) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request text is required (either via query param or from stored request)",
          correlationId: req.id,
        },
      });
    }

    // Truncate excessively long text to prevent abuse (10KB max)
    if (requestText.length > 10_000) {
      requestText = requestText.slice(0, 10_000);
    }

    // Fetch existing complaints and templates for clustering/recommendations
    const [existingComplaints, resolvedTemplates] = await Promise.all([
      fetchExistingComplaints(ctx.tenantId),
      fetchResolvedTemplates(ctx.tenantId),
    ]);

    const routing = await computeRouting(requestText, existingComplaints, resolvedTemplates);

    return reply.code(200).send({
      data: {
        requestId: id,
        ...routing,
        message: "These are AI-generated routing suggestions. Please confirm before applying.",
      },
    });
  });
}
