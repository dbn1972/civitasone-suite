/**
 * Lead Score Route — GET /v1/crm/leads/:id/score
 *
 * Returns ML-powered lead conversion probability with fallback to rule-based scoring.
 * Response is backward-compatible: includes both `score` (0–100) and `probability` (0.0–1.0).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import {
  extractLeadFeatures,
  scoreLeadWithMl,
  computeFallbackScore,
  type LeadScoreResponse,
} from "./ml-scoring.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

const leadIdParamSchema = z.object({
  id: z.string().uuid(),
});

export async function leadScoreRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/crm/leads/:id/score
   *
   * Returns the lead's ML-predicted conversion score with explainability factors.
   * Falls back to rule-based weighted scoring when ML model is unavailable.
   *
   * Response: { score: 0–100, probability: 0.0–1.0, factors[], modelVersion, isFallback }
   */
  app.get("/v1/crm/leads/:id/score", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const params = leadIdParamSchema.parse(req.params);
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;

    // Fetch lead data for feature extraction
    const rows = await sqlClient`
      SELECT
        c.id,
        c.tenant_id,
        c.lead_source,
        c.last_activity_at,
        c.company,
        c.stage_entered_at,
        c.lead_status,
        COALESCE(
          (SELECT COUNT(*)::int FROM crm.activities a WHERE a.contact_id = c.id AND a.tenant_id = c.tenant_id),
          0
        ) AS interaction_count,
        COALESCE(
          (SELECT MAX(d.value_minor) FROM crm.deals d WHERE d.contact_id = c.id AND d.tenant_id = c.tenant_id AND d.status = 'active'),
          0
        ) AS deal_value_paise,
        COALESCE(
          (SELECT (acc.metadata->>'employee_count')::int FROM crm.accounts acc WHERE acc.id = c.account_id AND acc.tenant_id = c.tenant_id),
          0
        ) AS employee_count
      FROM crm.contacts c
      WHERE c.id = ${params.id} AND c.tenant_id = ${ctx.tenantId} AND c.status = 'active'
      LIMIT 1
    `;

    if (rows.length === 0) {
      // Entity not found — return fallback with default features (200, not 404)
      const defaultFeatures = extractLeadFeatures({});
      const fallbackResult = computeFallbackScore(defaultFeatures);
      return reply.send({ data: fallbackResult });
    }

    const row = rows[0]!;

    // Extract features for ML model
    const features = extractLeadFeatures({
      stageEnteredAt: row.stage_entered_at as string | null,
      interactionCount: row.interaction_count as number,
      employeeCount: row.employee_count as number,
      dealValuePaise: row.deal_value_paise as number,
      leadSource: row.lead_source as string | null,
      lastActivityAt: row.last_activity_at as string | null,
    });

    // Get the auth token from request for forwarding to ml-service
    const authHeader = req.headers.authorization ?? "";
    const authToken = authHeader.replace(/^Bearer\s+/i, "");

    // Score the lead (ML with fallback)
    const result: LeadScoreResponse = await scoreLeadWithMl(
      ctx.tenantId,
      params.id,
      features,
      authToken,
      correlationId,
    );

    return reply.send({ data: result });
  });
}
