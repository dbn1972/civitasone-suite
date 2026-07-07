/**
 * ML-powered lead scoring — Feature extraction and scoring integration.
 *
 * This module:
 * - Extracts lead features for ML prediction (daysInStage, interactionCount, etc.)
 * - Calls ml-service internally via HTTP POST /v1/ml/predict
 * - Falls back to rule-based weighted scoring when ML is unavailable
 * - Emits `ml.prediction.lead_scored` event on high-confidence predictions
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
import { pino } from "pino";
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { computeLeadScore, type ScoringRule } from "./scoring.js";
import { queue } from "../../shared/infra.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { randomUUID } from "node:crypto";

const log = pino({ name: "crm-ml-scoring" });

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface LeadScoreResponse {
  score: number; // 0–100 (backward-compat with rule-based scoring)
  probability: number; // 0.0–1.0
  factors: ExplainabilityFactor[];
  modelVersion: number;
  isFallback: boolean;
}

export interface ExplainabilityFactor {
  feature: string;
  contribution: number;
  direction: "positive" | "negative";
}

export interface LeadFeatures {
  daysInStage: number;
  interactionCount: number;
  companySizeBucket: string;
  dealValueBucket: string;
  sourceChannel: string;
  lastActivityRecencyDays: number;
}

interface MlPredictResponse {
  prediction: number | null;
  confidence: number;
  factors: ExplainabilityFactor[];
  fallback: boolean;
  reason?: string;
  modelVersion?: number;
  advisory: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:3032";
const ML_PREDICT_TIMEOUT_MS = Number(process.env.ML_PREDICT_TIMEOUT_MS ?? "10000");
const HIGH_CONFIDENCE_THRESHOLD = 0.70;

/** Circuit breaker for ml-service calls: 5 failures in 60s → 30s open */
const mlBreaker = new CircuitBreaker({
  name: "crm-ml-service",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ─── Feature Extraction ──────────────────────────────────────────────────────

/**
 * Company size buckets based on estimated employee count or revenue signals.
 */
export function getCompanySizeBucket(employeeCount: number | null | undefined): string {
  if (employeeCount == null || employeeCount <= 0) return "unknown";
  if (employeeCount <= 10) return "micro";
  if (employeeCount <= 50) return "small";
  if (employeeCount <= 250) return "medium";
  if (employeeCount <= 1000) return "large";
  return "enterprise";
}

/**
 * Deal value buckets based on deal amount (in paise).
 */
export function getDealValueBucket(valuePaise: bigint | number | null | undefined): string {
  if (valuePaise == null) return "unknown";
  const val = typeof valuePaise === "bigint" ? Number(valuePaise) : valuePaise;
  if (val <= 0) return "unknown";
  if (val <= 100_000_00) return "low"; // ≤ ₹1 lakh
  if (val <= 500_000_00) return "medium"; // ≤ ₹5 lakh
  if (val <= 2500_000_00) return "high"; // ≤ ₹25 lakh
  return "enterprise"; // > ₹25 lakh
}

/**
 * Compute the recency in days between now and the last activity timestamp.
 */
export function computeLastActivityRecencyDays(lastActivityAt: Date | string | null | undefined): number {
  if (!lastActivityAt) return 365; // No activity = max recency
  const last = typeof lastActivityAt === "string" ? new Date(lastActivityAt) : lastActivityAt;
  const diffMs = Date.now() - last.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Compute days in current stage from stage entry timestamp.
 */
export function computeDaysInStage(stageEnteredAt: Date | string | null | undefined): number {
  if (!stageEnteredAt) return 0;
  const entered = typeof stageEnteredAt === "string" ? new Date(stageEnteredAt) : stageEnteredAt;
  const diffMs = Date.now() - entered.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Extract all ML features for a lead from raw database row data.
 */
export function extractLeadFeatures(row: {
  stageEnteredAt?: Date | string | null;
  interactionCount?: number | null;
  employeeCount?: number | null;
  dealValuePaise?: bigint | number | null;
  leadSource?: string | null;
  lastActivityAt?: Date | string | null;
}): LeadFeatures {
  return {
    daysInStage: computeDaysInStage(row.stageEnteredAt),
    interactionCount: row.interactionCount ?? 0,
    companySizeBucket: getCompanySizeBucket(row.employeeCount),
    dealValueBucket: getDealValueBucket(row.dealValuePaise),
    sourceChannel: row.leadSource ?? "unknown",
    lastActivityRecencyDays: computeLastActivityRecencyDays(row.lastActivityAt),
  };
}

// ─── ML Service Call ─────────────────────────────────────────────────────────

/**
 * Call ml-service POST /v1/ml/predict with circuit breaker protection.
 * Returns null on any failure (caller handles fallback).
 */
export async function callMlService(
  tenantId: string,
  entityId: string,
  features: LeadFeatures,
  authToken: string,
): Promise<MlPredictResponse | null> {
  try {
    const response = await mlBreaker.call(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ML_PREDICT_TIMEOUT_MS);

      try {
        const res = await fetch(`${ML_SERVICE_URL}/v1/ml/predict`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            domain: "leads",
            entityId,
            tenantId,
            features: {
              daysInStage: features.daysInStage,
              interactionCount: features.interactionCount,
              companySizeBucket: features.companySizeBucket,
              dealValueBucket: features.dealValueBucket,
              sourceChannel: features.sourceChannel,
              lastActivityRecencyDays: features.lastActivityRecencyDays,
            },
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          log.warn({ status: res.status, body: text }, "ml-service returned non-2xx");
          return null;
        }

        return (await res.json()) as MlPredictResponse;
      } finally {
        clearTimeout(timeout);
      }
    });

    return response;
  } catch (err) {
    if (err instanceof CircuitBreakerOpenError) {
      log.warn("ml-service circuit breaker open — using fallback scoring");
    } else {
      log.warn({ err: (err as Error).message }, "ml-service call failed — using fallback scoring");
    }
    return null;
  }
}

// ─── Fallback Rule-Based Scoring ─────────────────────────────────────────────

/**
 * Default ML-aligned scoring rules for fallback when ml-service is unavailable.
 * Uses the same feature attributes that the ML model uses, so scores are
 * roughly comparable between ML and rule-based modes.
 */
export const ML_FALLBACK_SCORING_RULES: ScoringRule[] = [
  {
    attribute: "lastActivityRecencyDays",
    weight: 30,
    scoreFn: (value: unknown): number => {
      const days = typeof value === "number" ? value : 365;
      if (days <= 3) return 100;
      if (days <= 7) return 85;
      if (days <= 14) return 70;
      if (days <= 30) return 50;
      if (days <= 60) return 30;
      return 10;
    },
  },
  {
    attribute: "interactionCount",
    weight: 25,
    scoreFn: (value: unknown): number => {
      const count = typeof value === "number" ? value : 0;
      if (count >= 10) return 100;
      if (count >= 5) return 80;
      if (count >= 3) return 60;
      if (count >= 1) return 40;
      return 10;
    },
  },
  {
    attribute: "sourceChannel",
    weight: 20,
    scoreFn: (value: unknown): number => {
      const sourceScores: Record<string, number> = {
        referral: 95,
        website: 75,
        campaign: 65,
        event: 55,
        social: 45,
        cold_call: 30,
        unknown: 20,
      };
      return sourceScores[String(value ?? "unknown").toLowerCase()] ?? 20;
    },
  },
  {
    attribute: "companySizeBucket",
    weight: 15,
    scoreFn: (value: unknown): number => {
      const bucketScores: Record<string, number> = {
        enterprise: 90,
        large: 75,
        medium: 60,
        small: 45,
        micro: 30,
        unknown: 20,
      };
      return bucketScores[String(value ?? "unknown").toLowerCase()] ?? 20;
    },
  },
  {
    attribute: "daysInStage",
    weight: 10,
    scoreFn: (value: unknown): number => {
      const days = typeof value === "number" ? value : 0;
      // Fewer days in stage = more recently progressed = higher score
      if (days <= 3) return 90;
      if (days <= 7) return 75;
      if (days <= 14) return 60;
      if (days <= 30) return 40;
      return 20;
    },
  },
];

/**
 * Compute fallback score using rule-based weighted scoring.
 * Returns a LeadScoreResponse with isFallback=true.
 */
export function computeFallbackScore(features: LeadFeatures): LeadScoreResponse {
  const attributes: Record<string, unknown> = {
    daysInStage: features.daysInStage,
    interactionCount: features.interactionCount,
    companySizeBucket: features.companySizeBucket,
    dealValueBucket: features.dealValueBucket,
    sourceChannel: features.sourceChannel,
    lastActivityRecencyDays: features.lastActivityRecencyDays,
  };

  const score = computeLeadScore(attributes, ML_FALLBACK_SCORING_RULES);
  const probability = score / 100;

  return {
    score,
    probability,
    factors: [],
    modelVersion: 0,
    isFallback: true,
  };
}

// ─── Main Scoring Function ───────────────────────────────────────────────────

/**
 * Score a lead using ML prediction with fallback to rule-based scoring.
 *
 * Flow:
 * 1. Extract features from lead data
 * 2. Call ml-service via HTTP (circuit-breaker protected)
 * 3. If ml-service returns a valid prediction → compute score from probability
 * 4. If ml-service is unavailable or returns fallback → use rule-based scoring
 * 5. Emit `ml.prediction.lead_scored` event on high-confidence ML predictions
 */
export async function scoreLeadWithMl(
  tenantId: string,
  entityId: string,
  features: LeadFeatures,
  authToken: string,
  correlationId: string,
): Promise<LeadScoreResponse> {
  // Attempt ML prediction
  const mlResponse = await callMlService(tenantId, entityId, features, authToken);

  // If ML service returned a valid (non-fallback) prediction
  if (mlResponse && !mlResponse.fallback && mlResponse.prediction != null) {
    const probability = mlResponse.prediction;
    const score = Math.round(probability * 100); // backward-compat 0–100

    const result: LeadScoreResponse = {
      score: Math.max(0, Math.min(100, score)),
      probability,
      factors: mlResponse.factors ?? [],
      modelVersion: mlResponse.modelVersion ?? 0,
      isFallback: false,
    };

    // Emit event on high-confidence predictions
    if (mlResponse.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      emitLeadScoredEvent(tenantId, entityId, result, mlResponse.confidence, correlationId);
    }

    return result;
  }

  // Fallback to rule-based scoring
  log.info({ tenantId, entityId, reason: mlResponse?.reason ?? "unavailable" }, "using fallback scoring for lead");
  return computeFallbackScore(features);
}

// ─── Event Emission ──────────────────────────────────────────────────────────

/**
 * Emit ml.prediction.lead_scored event for high-confidence predictions.
 * Best-effort — never blocks the response.
 */
function emitLeadScoredEvent(
  tenantId: string,
  entityId: string,
  result: LeadScoreResponse,
  confidence: number,
  correlationId: string,
): void {
  try {
    queue.publish(CONSUMED_EVENTS.mlLeadScored, {
      messageId: randomUUID(),
      type: CONSUMED_EVENTS.mlLeadScored,
      tenantId,
      actorId: tenantId, // system-generated prediction
      correlationId,
      schemaVersion: "1.0",
      payload: {
        tenantId,
        domain: "leads",
        entityId,
        prediction: result.probability,
        confidence,
        factors: result.factors,
        modelVersion: result.modelVersion,
        timestamp: new Date().toISOString(),
        correlationId,
      },
    });
  } catch (err) {
    log.error({ tenantId, entityId, err: (err as Error).message }, "failed to emit lead_scored event");
  }
}
