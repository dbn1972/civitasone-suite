/**
 * recommendation route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls recommendation-service through the gateway via cookie-aware fetchJson.
 *
 * GAP-RECOMMENDATIONS-{FEEDBACK,HEALTH,MATRIX,NBA}-0x: each child page now has a
 * typed loader with a zod schema at the boundary and an explicit per-endpoint
 * row type, instead of the single generic `mapRows` key-guessing cascade that
 * made a column mean a different thing on every row. The response shapes are
 * taken from the live recommendation-service route handlers (present in this
 * worktree): predictive (ranked scores), matrix (cross-sell cells), health
 * at-risk (banded scores) and the rejection-reason summary.
 */
import { z } from "zod";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/** Standard list envelope every recommendation-service list route returns. */
function listEnvelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: z
      .object({
        page: z.number().optional(),
        pageSize: z.number().optional(),
        total: z.number().optional(),
      })
      .partial()
      .optional(),
  });
}

// --- NBA / predictive -------------------------------------------------------
// GET /api/v1/recommendations/predictive -> ranked predictive model scores.
// (services/recommendation-service/src/modules/predictive/routes.ts +
//  repo.toView). `score`/`confidence` are numeric → arrive as decimal STRINGS.
const predictiveItem = z.object({
  id: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  modelType: z.string(),
  score: z.union([z.string(), z.number()]),
  confidence: z.union([z.string(), z.number()]).nullable().optional(),
  computedAt: z.string().nullable().optional(),
});
export type NbaScoreRow = {
  id: string;
  subject: string;
  subjectType: string;
  model: string;
  /** Decimal string, kept lossless (never coerced through a float). */
  score: string;
  confidence: string | null;
  computedAt: string | null;
};

function mapNba(payload: z.infer<ReturnType<typeof listEnvelope<typeof predictiveItem>>>): NbaScoreRow[] {
  return payload.data.map((r) => ({
    id: r.id,
    subject: r.subjectId,
    subjectType: r.subjectType,
    model: r.modelType,
    score: String(r.score),
    confidence: r.confidence === null || r.confidence === undefined ? null : String(r.confidence),
    computedAt: r.computedAt ?? null,
  }));
}

export const getRecNba = (): Promise<LoaderResult<NbaScoreRow[]>> =>
  fetchJson<z.infer<ReturnType<typeof listEnvelope<typeof predictiveItem>>>, NbaScoreRow[]>(
    "/api/v1/recommendations/predictive",
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "recommendations.nba",
      responseSchema: listEnvelope(predictiveItem),
      mapResponse: mapNba,
    },
  );

// --- Matrix -----------------------------------------------------------------
// GET /api/v1/recommendations/matrix -> cross-sell cells (matrix/routes.ts).
const matrixItem = z.object({
  id: z.string(),
  triggerProductId: z.string(),
  recommendedProductId: z.string(),
  segment: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
  priority: z.number(),
  weightBps: z.number(),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
});
export type MatrixRuleRow = {
  id: string;
  source: string;
  target: string;
  segment: string;
  channel: string;
  priority: number;
  /** Basis points (10000 = 100%). Numeric so the table can sort it. */
  weightBps: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

function mapMatrix(payload: z.infer<ReturnType<typeof listEnvelope<typeof matrixItem>>>): MatrixRuleRow[] {
  return payload.data.map((r) => ({
    id: r.id,
    source: r.triggerProductId,
    target: r.recommendedProductId,
    segment: r.segment ?? "—",
    channel: r.channel ?? "—",
    priority: r.priority,
    weightBps: r.weightBps,
    effectiveFrom: r.effectiveFrom ?? null,
    effectiveTo: r.effectiveTo ?? null,
  }));
}

export const getRecMatrix = (): Promise<LoaderResult<MatrixRuleRow[]>> =>
  fetchJson<z.infer<ReturnType<typeof listEnvelope<typeof matrixItem>>>, MatrixRuleRow[]>(
    "/api/v1/recommendations/matrix",
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "recommendations.matrix",
      responseSchema: listEnvelope(matrixItem),
      mapResponse: mapMatrix,
    },
  );

// --- Health at-risk ---------------------------------------------------------
// GET /api/v1/recommendations/health/at-risk -> banded scores worst-first
// (health/scoring-routes.ts). band ∈ critical|at_risk|healthy|thriving.
const healthItem = z.object({
  accountId: z.string(),
  score: z.number(),
  band: z.string(),
  computedAt: z.string().nullable().optional(),
});
export type HealthRow = {
  id: string;
  accountId: string;
  score: number;
  band: string;
  computedAt: string | null;
};

function mapHealth(payload: z.infer<ReturnType<typeof listEnvelope<typeof healthItem>>>): HealthRow[] {
  return payload.data.map((r) => ({
    id: r.accountId,
    accountId: r.accountId,
    score: r.score,
    band: r.band,
    computedAt: r.computedAt ?? null,
  }));
}

export const getRecHealth = (): Promise<LoaderResult<HealthRow[]>> =>
  fetchJson<z.infer<ReturnType<typeof listEnvelope<typeof healthItem>>>, HealthRow[]>(
    "/api/v1/recommendations/health/at-risk",
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "recommendations.health",
      responseSchema: listEnvelope(healthItem),
      mapResponse: mapHealth,
    },
  );

// --- Feedback (rejection-reason summary) ------------------------------------
// GAP-RECOMMENDATIONS-FEEDBACK-01/02: there is NO unfiltered feedback-list
// endpoint — GET /v1/recommendations/feedback REQUIRES a recommendationId
// (feedback/routes.ts), so the previous hub-level call to it would 400. The
// only tenant-wide aggregate recommendation-service exposes is
// GET /v1/recommendations/feedback/rejection-summary (feedback/reason-routes.ts),
// which is what an "acceptance/rejection analytics" page should actually read.
const rejectionSummaryEnvelope = z.object({
  data: z.object({
    summary: z.array(
      z.object({
        reasonCode: z.string(),
        count: z.number(),
      }),
    ),
    reasonCodes: z.array(z.string()),
    totalRejections: z.number(),
    uncodedRejections: z.number(),
  }),
});
export type FeedbackSummary = {
  totalRejections: number;
  uncodedRejections: number;
  byReason: { reasonCode: string; count: number }[];
};

function mapFeedback(payload: z.infer<typeof rejectionSummaryEnvelope>): FeedbackSummary {
  return {
    totalRejections: payload.data.totalRejections,
    uncodedRejections: payload.data.uncodedRejections,
    byReason: payload.data.summary.map((s) => ({ reasonCode: s.reasonCode, count: s.count })),
  };
}

const EMPTY_FEEDBACK: FeedbackSummary = { totalRejections: 0, uncodedRejections: 0, byReason: [] };

export const getRecFeedback = (): Promise<LoaderResult<FeedbackSummary>> =>
  fetchJson<z.infer<typeof rejectionSummaryEnvelope>, FeedbackSummary>(
    "/api/v1/recommendations/feedback/rejection-summary",
    EMPTY_FEEDBACK,
    {
      revalidateSeconds: 30,
      telemetryKey: "recommendations.feedback",
      responseSchema: rejectionSummaryEnvelope,
      mapResponse: mapFeedback,
    },
  );
