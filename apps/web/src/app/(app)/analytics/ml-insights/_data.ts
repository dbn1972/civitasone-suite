/**
 * ML Insights data loaders. Fetches from the ms-service evaluation and
 * prediction endpoints to power the ML Insights dashboard pages.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

// --- Types ---

export type MLDomainSummary = {
  domain: string;
  totalPredictions: number;
  /** Nullable: a genuine 0 is distinct from "no value reported" (shows "—"). */
  accuracy: number | null;
  /** Nullable: a genuine 0% fallback (the ideal) is distinct from missing. */
  fallbackRate: number | null;
  topFactor: string;
  modelVersion: number | null;
  lastTrainedAt: string | null;
};

export type MLDomainEvaluation = {
  totalPredictions: number;
  /** Nullable: a genuine 0 is distinct from "no value reported" (shows "—"). */
  accuracy: number | null;
  /** Nullable: a genuine 0% fallback rate is distinct from missing data. */
  fallbackRate: number | null;
  topFactor: string;
  accuracyTrend: AccuracyTrendPoint[];
  factorBreakdown: FactorBreakdownEntry[];
  recentPredictions: RecentPredictionRow[];
};

export type AccuracyTrendPoint = {
  date: string;
  accuracy: number;
};

export type FactorBreakdownEntry = {
  feature: string;
  avgContribution: number;
  direction: "positive" | "negative";
  frequency: number;
};

export type RecentPredictionRow = {
  id: string;
  entityId: string;
  /** Optional human-readable name/code for the scored entity (BE-provided). */
  entityLabel: string | null;
  /** Optional parent id (e.g. a task's owning project) for drill-through. */
  parentId: string | null;
  prediction: number;
  confidence: number;
  outcome: string | null;
  createdAt: string;
};

// --- Helpers ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Like toNumber, but returns null (not 0) when the field is absent or
 * non-finite, so a genuine 0 (e.g. a 0% fallback rate — the ideal) is
 * distinguishable from "no value reported". GAP-*-ML-INSIGHTS-*-05/06.
 */
function toNullableNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toText(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}


// --- Domain overview (hub page) ---

export async function getMLDomainOverview(): Promise<LoaderResult<MLDomainSummary[]>> {
  return fetchJson<unknown, MLDomainSummary[]>(
    "/api/v1/ml/evaluations?window=30d",
    [],
    {
      revalidateSeconds: 60,
      telemetryKey: "ml_insights.overview",
      mapResponse: (payload) => {
        if (!isRecord(payload)) return [];
        const domains = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.domains) ? payload.domains : [];
        return domains.filter(isRecord).map((d) => ({
          domain: String(d.domain ?? "unknown"),
          totalPredictions: toNumber(d.totalPredictions),
          // The ms-service evaluations endpoint reports the headline quality
          // as `avgConfidence`; accept an explicit `accuracy` first if a
          // future payload sends one. Nullable so a missing value shows "—".
          accuracy: toNullableNumber(d.accuracy ?? d.avgConfidence),
          fallbackRate: toNullableNumber(d.fallbackRate),
          topFactor: String(d.topFactor ?? "—"),
          modelVersion: typeof d.modelVersion === "number" ? d.modelVersion : null,
          lastTrainedAt: toText(d.lastTrainedAt),
        }));
      },
    },
  );
}

// --- Per-domain evaluation loader ---

const emptyEvaluation: MLDomainEvaluation = {
  totalPredictions: 0,
  accuracy: null,
  fallbackRate: null,
  topFactor: "—",
  accuracyTrend: [],
  factorBreakdown: [],
  recentPredictions: [],
};

function mapEvaluation(payload: unknown): MLDomainEvaluation | null {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload.data) ? payload.data : payload;

  const accuracyTrend = Array.isArray(data.accuracyTrend)
    ? data.accuracyTrend.filter(isRecord).map((p) => ({
        date: String(p.date ?? ""),
        accuracy: toNumber(p.accuracy),
      }))
    : [];

  const factorBreakdown = Array.isArray(data.factorBreakdown)
    ? data.factorBreakdown.filter(isRecord).map((f) => ({
        feature: String(f.feature ?? ""),
        avgContribution: toNumber(f.avgContribution),
        direction: f.direction === "negative" ? ("negative" as const) : ("positive" as const),
        frequency: toNumber(f.frequency),
      }))
    : [];

  const recentPredictions = Array.isArray(data.recentPredictions)
    ? data.recentPredictions.filter(isRecord).map((r) => ({
        id: String(r.id ?? ""),
        entityId: String(r.entityId ?? ""),
        entityLabel: toText(r.entityLabel),
        parentId: toText(r.parentId),
        prediction: toNumber(r.prediction),
        confidence: toNumber(r.confidence),
        outcome: toText(r.outcome),
        createdAt: String(r.createdAt ?? ""),
      }))
    : [];

  return {
    totalPredictions: toNumber(data.totalPredictions),
    accuracy: toNullableNumber(data.accuracy ?? data.avgConfidence),
    fallbackRate: toNullableNumber(data.fallbackRate),
    topFactor: String(data.topFactor ?? "—"),
    accuracyTrend,
    factorBreakdown,
    recentPredictions,
  };
}

export async function getMLDomainEvaluation(domain: string): Promise<LoaderResult<MLDomainEvaluation>> {
  return fetchJson<unknown, MLDomainEvaluation>(
    `/api/v1/ml/evaluations?domain=${encodeURIComponent(domain)}&window=30d`,
    emptyEvaluation,
    {
      revalidateSeconds: 30,
      telemetryKey: `ml_insights.${domain}`,
      mapResponse: mapEvaluation,
    },
  );
}
