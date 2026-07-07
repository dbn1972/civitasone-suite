/**
 * ML Insights data loaders. Fetches from the ml-service evaluation and
 * prediction endpoints to power the ML Insights dashboard pages.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

// --- Types ---

export type MLDomainSummary = {
  domain: string;
  totalPredictions: number;
  accuracy: number;
  fallbackRate: number;
  topFactor: string;
  modelVersion: number | null;
  lastTrainedAt: string | null;
};

export type MLDomainEvaluation = {
  totalPredictions: number;
  accuracy: number;
  fallbackRate: number;
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
          accuracy: toNumber(d.accuracy),
          fallbackRate: toNumber(d.fallbackRate),
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
  accuracy: 0,
  fallbackRate: 0,
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
        prediction: toNumber(r.prediction),
        confidence: toNumber(r.confidence),
        outcome: toText(r.outcome),
        createdAt: String(r.createdAt ?? ""),
      }))
    : [];

  return {
    totalPredictions: toNumber(data.totalPredictions),
    accuracy: toNumber(data.accuracy),
    fallbackRate: toNumber(data.fallbackRate),
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
