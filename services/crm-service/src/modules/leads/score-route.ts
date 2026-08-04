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
import { withRawTenantGuc } from "@civitasone/db";
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

    // Fetch lead data for feature extraction.
    //
    // Wrapped in withRawTenantGuc: crm.contacts, crm.deals, crm.activities and
    // crm.accounts all have RLS ENABLEd AND FORCEd, and this module talks to
    // `sqlClient` directly (there is no Drizzle schema for this composite
    // read, so `db.transaction()` — where `wrapWithTenantGuc` sets
    // `app.tenant_id` — was never in the call path). Without this, the
    // connecting role (`crm_svc`, not a superuser) got zero rows back on
    // every call, silently: RLS fails CLOSED. Every call to this route fell
    // through to the "not found" branch and returned a default fallback
    // score regardless of whether the lead existed. See `@civitasone/db`'s
    // `withRawTenantGuc` for the shared fix — the same defect shape was
    // found in helpdesk-service, estab-service, hrms-service and
    // payroll-service.
    //
    // This query also referenced two columns that do not exist on this
    // schema (`c.stage_entered_at`, `acc.metadata`), which threw a 500 on
    // every call independent of RLS/GUC — found while reproducing the RLS
    // defect, since that error masked it. Stage-entry time is derived from
    // the most recent row in crm.lead_transitions (the lifecycle audit
    // trail) instead; there is no employee-count data source anywhere in
    // this schema, so that feature now resolves to "unknown" via NULL
    // rather than silently reading a nonexistent column.
    const rows = await withRawTenantGuc(sqlClient, ctx.tenantId, (tx) => tx`
      SELECT
        c.id,
        c.tenant_id,
        c.lead_source,
        c.last_activity_at,
        c.company,
        c.score AS current_score,
        (
          SELECT lt.created_at FROM crm.lead_transitions lt
          WHERE lt.contact_id = c.id AND lt.tenant_id = c.tenant_id
          ORDER BY lt.created_at DESC
          LIMIT 1
        ) AS stage_entered_at,
        c.lead_status,
        COALESCE(
          (SELECT COUNT(*)::int FROM crm.activities a WHERE a.contact_id = c.id AND a.tenant_id = c.tenant_id),
          0
        ) AS interaction_count,
        COALESCE(
          (SELECT MAX(d.value_minor) FROM crm.deals d WHERE d.contact_id = c.id AND d.tenant_id = c.tenant_id AND d.status = 'active'),
          0
        ) AS deal_value_paise,
        NULL::int AS employee_count
      FROM crm.contacts c
      WHERE c.id = ${params.id} AND c.tenant_id = ${ctx.tenantId} AND c.status = 'active'
      LIMIT 1
    `);

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

    // LQ-002: record a score read in crm.lead_score_history — but ONLY when the score
    // actually CHANGES vs the latest recorded value. GET /score is a read and may be
    // polled; inserting on every read would grow the table unboundedly for a score
    // that never moves. The INSERT...SELECT...WHERE score IS DISTINCT FROM (latest)
    // makes the skip atomic (no read-then-write race). previous_score is the last
    // recorded score, falling back to the contact's stored score for the first read.
    // Wrapped in withRawTenantGuc because crm.lead_score_history is FORCE RLS and this
    // module talks to sqlClient directly. Best-effort: a write failure must not fail
    // the score response.
    const previousScore = row.current_score == null ? null : Number(row.current_score);
    try {
      await withRawTenantGuc(sqlClient, ctx.tenantId, (tx) => tx`
        INSERT INTO crm.lead_score_history
          (tenant_id, lead_id, score, previous_score, factors, source, reason)
        SELECT
          ${ctx.tenantId}, ${params.id}, ${result.score},
          COALESCE(
            (SELECT h.score FROM crm.lead_score_history h
             WHERE h.tenant_id = ${ctx.tenantId} AND h.lead_id = ${params.id}
             ORDER BY h.scored_at DESC LIMIT 1),
            ${previousScore}
          ),
          ${JSON.stringify(result.factors ?? [])}::jsonb,
          ${result.isFallback ? "rule" : "ml"}, ${"score_read"}
        WHERE ${result.score} IS DISTINCT FROM (
          SELECT h2.score FROM crm.lead_score_history h2
          WHERE h2.tenant_id = ${ctx.tenantId} AND h2.lead_id = ${params.id}
          ORDER BY h2.scored_at DESC LIMIT 1
        )
      `);
    } catch (err) {
      req.log.warn({ err, leadId: params.id }, "failed to write lead score history");
    }

    return reply.send({ data: result });
  });
}
