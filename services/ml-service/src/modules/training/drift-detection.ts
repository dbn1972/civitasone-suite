/**
 * Drift Detection and Bias Monitoring Module
 *
 * Provides:
 * - KL divergence computation between current prediction confidence distribution and training distribution
 * - Drift detection with alert emission when KL divergence > 15%
 * - Emergency retrain triggering on drift detection
 * - Prediction distribution analysis across geographic territories and department types (quarterly)
 * - Bias alert emission when any territory deviates > 10% from population mean
 *
 * Validates: Requirements 21.7, 24.1
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS, COMMANDS } from "../../topics.js";
import { mlPredictions } from "../predictions/schema.js";
import { mlModels } from "../models/schema.js";
import type { ModelDomain } from "../models/schema.js";
import { sql, eq, and, gte, lte } from "drizzle-orm";

const log = pino({ name: "ml-drift-detection" });

// ─── Constants ───────────────────────────────────────────────────────────────

/** KL divergence threshold (15%) above which drift is detected */
export const KL_DIVERGENCE_THRESHOLD = 0.15;

/** Territory deviation threshold (10%) above which a bias alert is emitted */
export const TERRITORY_DEVIATION_THRESHOLD = 0.10;

/** Number of histogram bins for confidence distribution */
export const HISTOGRAM_BINS = 10;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConfidenceDistribution {
  /** Histogram bin counts normalized to probabilities (sum = 1.0) */
  bins: number[];
  /** Total number of predictions in this distribution */
  sampleCount: number;
}

export interface DriftResult {
  domain: ModelDomain;
  tenantId: string;
  modelId: string;
  klDivergence: number;
  driftDetected: boolean;
  trainingDistribution: ConfidenceDistribution;
  currentDistribution: ConfidenceDistribution;
}

export interface TerritoryDistribution {
  territory: string;
  predictionCount: number;
  meanConfidence: number;
  meanPrediction: number;
}

export interface BiasResult {
  domain: ModelDomain;
  tenantId: string;
  modelId: string;
  dimension: string;
  populationMean: number;
  territories: TerritoryDistribution[];
  deviations: BiasDeviation[];
}

export interface BiasDeviation {
  territory: string;
  deviationPct: number;
  status: "pass" | "warn" | "fail";
}

// ─── KL Divergence Computation ───────────────────────────────────────────────

/**
 * Computes the Kullback-Leibler divergence between two probability distributions.
 *
 * KL(P || Q) = Σ P(i) × ln(P(i) / Q(i))
 *
 * Uses Laplace smoothing to avoid division by zero or log(0).
 *
 * @param p - The "true" distribution (training distribution)
 * @param q - The "observed" distribution (current prediction distribution)
 * @returns KL divergence value (non-negative; 0 means identical distributions)
 */
export function computeKLDivergence(p: number[], q: number[]): number {
  if (p.length !== q.length) {
    throw new Error(`Distribution length mismatch: p=${p.length}, q=${q.length}`);
  }

  if (p.length === 0) return 0;

  // Apply Laplace smoothing (add small epsilon to avoid zero probabilities)
  const epsilon = 1e-10;
  const smoothedP = p.map((v) => v + epsilon);
  const smoothedQ = q.map((v) => v + epsilon);

  // Normalize after smoothing
  const sumP = smoothedP.reduce((a, b) => a + b, 0);
  const sumQ = smoothedQ.reduce((a, b) => a + b, 0);

  const normalizedP = smoothedP.map((v) => v / sumP);
  const normalizedQ = smoothedQ.map((v) => v / sumQ);

  // Compute KL divergence
  let kl = 0;
  for (let i = 0; i < normalizedP.length; i++) {
    kl += normalizedP[i]! * Math.log(normalizedP[i]! / normalizedQ[i]!);
  }

  return Math.max(0, kl); // Ensure non-negative (floating point safety)
}

/**
 * Builds a normalized histogram from confidence values.
 * Bins confidence values into HISTOGRAM_BINS equal-width bins [0, 0.1), [0.1, 0.2), ..., [0.9, 1.0].
 *
 * @param confidences - Array of confidence values (0.0 to 1.0)
 * @returns Normalized probability distribution
 */
export function buildConfidenceHistogram(confidences: number[]): ConfidenceDistribution {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);

  for (const conf of confidences) {
    const clamped = Math.max(0, Math.min(1, conf));
    const binIdx = Math.min(Math.floor(clamped * HISTOGRAM_BINS), HISTOGRAM_BINS - 1);
    bins[binIdx]!++;
  }

  const total = confidences.length;
  const normalized = total > 0 ? bins.map((count) => count / total) : bins;

  return { bins: normalized, sampleCount: total };
}

// ─── Drift Detection ─────────────────────────────────────────────────────────

/**
 * Fetches the confidence distribution of predictions made during the model's
 * training period (stored as the "training distribution baseline").
 *
 * Uses predictions from the first 7 days after model deployment as baseline.
 */
export async function getTrainingDistribution(
  tenantId: string,
  domain: ModelDomain,
  modelId: string,
): Promise<ConfidenceDistribution | null> {
  // Get the model's trained_at date to determine the baseline window
  const modelRows = await db.execute(
    sql`SELECT trained_at FROM ml.ml_models WHERE id = ${modelId} AND tenant_id = ${tenantId} LIMIT 1`
  );
  const models = modelRows as unknown as Array<{ trained_at: string }>;
  if (models.length === 0) return null;

  const trainedAt = new Date(models[0]!.trained_at);
  const baselineEnd = new Date(trainedAt.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days after training

  // Fetch confidence values from the baseline period
  const rows = await db.execute(
    sql`SELECT confidence FROM ml.ml_predictions
        WHERE tenant_id = ${tenantId}
        AND domain = ${domain}
        AND model_id = ${modelId}
        AND is_fallback = false
        AND created_at >= ${trainedAt.toISOString()}
        AND created_at <= ${baselineEnd.toISOString()}`
  );
  const predictions = rows as unknown as Array<{ confidence: string }>;

  if (predictions.length < 10) return null; // Need minimum samples for meaningful distribution

  const confidences = predictions.map((r) => parseFloat(r.confidence));
  return buildConfidenceHistogram(confidences);
}

/**
 * Fetches the current (recent) confidence distribution for predictions.
 * Uses the last 7 days of predictions.
 */
export async function getCurrentDistribution(
  tenantId: string,
  domain: ModelDomain,
  modelId: string,
): Promise<ConfidenceDistribution | null> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

  const rows = await db.execute(
    sql`SELECT confidence FROM ml.ml_predictions
        WHERE tenant_id = ${tenantId}
        AND domain = ${domain}
        AND model_id = ${modelId}
        AND is_fallback = false
        AND created_at >= ${windowStart.toISOString()}`
  );
  const predictions = rows as unknown as Array<{ confidence: string }>;

  if (predictions.length < 10) return null; // Need minimum samples

  const confidences = predictions.map((r) => parseFloat(r.confidence));
  return buildConfidenceHistogram(confidences);
}

/**
 * Detects drift for a specific tenant-domain-model triple.
 * Computes KL divergence between training and current distributions.
 * If divergence > 15%, drift is detected.
 */
export async function detectDrift(
  tenantId: string,
  domain: ModelDomain,
  modelId: string,
): Promise<DriftResult | null> {
  const trainingDist = await getTrainingDistribution(tenantId, domain, modelId);
  if (!trainingDist) {
    log.info({ tenantId, domain, modelId }, "insufficient training distribution data for drift detection");
    return null;
  }

  const currentDist = await getCurrentDistribution(tenantId, domain, modelId);
  if (!currentDist) {
    log.info({ tenantId, domain, modelId }, "insufficient current distribution data for drift detection");
    return null;
  }

  const klDivergence = computeKLDivergence(trainingDist.bins, currentDist.bins);
  const driftDetected = klDivergence > KL_DIVERGENCE_THRESHOLD;

  if (driftDetected) {
    log.warn(
      { tenantId, domain, modelId, klDivergence, threshold: KL_DIVERGENCE_THRESHOLD },
      "model drift detected — KL divergence exceeds threshold"
    );
  }

  return {
    domain,
    tenantId,
    modelId,
    klDivergence,
    driftDetected,
    trainingDistribution: trainingDist,
    currentDistribution: currentDist,
  };
}

/**
 * Emits the ml.model.drift_detected event and triggers an emergency retrain.
 */
export async function emitDriftAlert(result: DriftResult): Promise<void> {
  const correlationId = randomUUID();

  await db.transaction(async (tx) => {
    // Emit drift detected event
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: EVENTS.driftDetected,
      eventType: EVENTS.driftDetected,
      tenantId: result.tenantId,
      actorId: "00000000-0000-0000-0000-000000000000", // system actor
      correlationId,
      payload: {
        tenantId: result.tenantId,
        domain: result.domain,
        modelId: result.modelId,
        klDivergence: result.klDivergence,
        threshold: KL_DIVERGENCE_THRESHOLD,
        timestamp: new Date().toISOString(),
        correlationId,
      },
    });

    // Trigger emergency retrain
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: COMMANDS.train,
      eventType: COMMANDS.train,
      tenantId: result.tenantId,
      actorId: "00000000-0000-0000-0000-000000000000",
      correlationId,
      payload: {
        tenantId: result.tenantId,
        domain: result.domain,
        force: true,
        reason: "drift_detected",
        klDivergence: result.klDivergence,
        correlationId,
      },
    });
  });

  log.info(
    { tenantId: result.tenantId, domain: result.domain, modelId: result.modelId, correlationId },
    "drift alert emitted and emergency retrain triggered"
  );
}

// ─── Bias Monitoring ─────────────────────────────────────────────────────────

/**
 * Computes prediction distribution across geographic territories for a given domain.
 * Uses a quarterly window (last 90 days) of predictions grouped by territory metadata.
 *
 * Territory information is derived from entity metadata stored in the feature vectors.
 */
export async function computeTerritoryDistribution(
  tenantId: string,
  domain: ModelDomain,
  modelId: string,
): Promise<TerritoryDistribution[]> {
  const now = new Date();
  const quarterStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // Last 90 days

  // Join predictions with feature vectors to get territory info
  // Territory is stored as a feature named "territory" or "region" in the feature vector
  const rows = await db.execute(
    sql`SELECT
          COALESCE(fv.features->>'territory', fv.features->>'region', 'unknown') AS territory,
          COUNT(*)::int AS prediction_count,
          AVG(p.confidence::numeric)::numeric AS mean_confidence,
          AVG(p.prediction::numeric)::numeric AS mean_prediction
        FROM ml.ml_predictions p
        LEFT JOIN ml.ml_feature_vectors fv
          ON fv.tenant_id = p.tenant_id
          AND fv.domain = p.domain
          AND fv.entity_id = p.entity_id
        WHERE p.tenant_id = ${tenantId}
          AND p.domain = ${domain}
          AND p.model_id = ${modelId}
          AND p.is_fallback = false
          AND p.created_at >= ${quarterStart.toISOString()}
        GROUP BY territory
        HAVING COUNT(*) >= 5`
  );

  const territories = rows as unknown as Array<{
    territory: string;
    prediction_count: number;
    mean_confidence: string;
    mean_prediction: string;
  }>;

  return territories.map((r) => ({
    territory: r.territory,
    predictionCount: r.prediction_count,
    meanConfidence: parseFloat(r.mean_confidence) || 0,
    meanPrediction: parseFloat(r.mean_prediction) || 0,
  }));
}

/**
 * Computes prediction distribution across department types for a given domain.
 * Uses a quarterly window (last 90 days) of predictions grouped by department.
 */
export async function computeDepartmentDistribution(
  tenantId: string,
  domain: ModelDomain,
  modelId: string,
): Promise<TerritoryDistribution[]> {
  const now = new Date();
  const quarterStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const rows = await db.execute(
    sql`SELECT
          COALESCE(fv.features->>'department_type', fv.features->>'department', 'unknown') AS territory,
          COUNT(*)::int AS prediction_count,
          AVG(p.confidence::numeric)::numeric AS mean_confidence,
          AVG(p.prediction::numeric)::numeric AS mean_prediction
        FROM ml.ml_predictions p
        LEFT JOIN ml.ml_feature_vectors fv
          ON fv.tenant_id = p.tenant_id
          AND fv.domain = p.domain
          AND fv.entity_id = p.entity_id
        WHERE p.tenant_id = ${tenantId}
          AND p.domain = ${domain}
          AND p.model_id = ${modelId}
          AND p.is_fallback = false
          AND p.created_at >= ${quarterStart.toISOString()}
        GROUP BY territory
        HAVING COUNT(*) >= 5`
  );

  const departments = rows as unknown as Array<{
    territory: string;
    prediction_count: number;
    mean_confidence: string;
    mean_prediction: string;
  }>;

  return departments.map((r) => ({
    territory: r.territory,
    predictionCount: r.prediction_count,
    meanConfidence: parseFloat(r.mean_confidence) || 0,
    meanPrediction: parseFloat(r.mean_prediction) || 0,
  }));
}

/**
 * Computes deviations from population mean for a set of territory distributions.
 * A territory "deviates" when its mean prediction differs from the overall mean
 * by more than the deviation threshold (10%).
 *
 * @param territories - Array of territory distributions
 * @param threshold - Deviation threshold (default 0.10 = 10%)
 * @returns Array of deviations with pass/warn/fail status
 */
export function computeDeviations(
  territories: TerritoryDistribution[],
  threshold: number = TERRITORY_DEVIATION_THRESHOLD,
): { populationMean: number; deviations: BiasDeviation[] } {
  if (territories.length === 0) {
    return { populationMean: 0, deviations: [] };
  }

  // Compute weighted population mean (weighted by prediction count)
  const totalPredictions = territories.reduce((sum, t) => sum + t.predictionCount, 0);
  const populationMean = totalPredictions > 0
    ? territories.reduce((sum, t) => sum + t.meanPrediction * t.predictionCount, 0) / totalPredictions
    : 0;

  const deviations: BiasDeviation[] = territories.map((t) => {
    // Compute absolute deviation as a percentage of population mean
    const deviationPct = populationMean > 0
      ? Math.abs(t.meanPrediction - populationMean) / populationMean
      : 0;

    let status: "pass" | "warn" | "fail";
    if (deviationPct > threshold) {
      status = "fail";
    } else if (deviationPct > threshold * 0.7) {
      // Warn at 70% of threshold (7% for default 10%)
      status = "warn";
    } else {
      status = "pass";
    }

    return {
      territory: t.territory,
      deviationPct,
      status,
    };
  });

  return { populationMean, deviations };
}

/**
 * Runs bias monitoring for a tenant-domain-model triple.
 * Analyzes predictions across territories and department types.
 */
export async function detectBias(
  tenantId: string,
  domain: ModelDomain,
  modelId: string,
): Promise<BiasResult[]> {
  const results: BiasResult[] = [];

  // Territory-based bias check
  const territoryDist = await computeTerritoryDistribution(tenantId, domain, modelId);
  if (territoryDist.length > 1) {
    const { populationMean, deviations } = computeDeviations(territoryDist);
    results.push({
      domain,
      tenantId,
      modelId,
      dimension: "territory",
      populationMean,
      territories: territoryDist,
      deviations,
    });
  }

  // Department-type-based bias check
  const departmentDist = await computeDepartmentDistribution(tenantId, domain, modelId);
  if (departmentDist.length > 1) {
    const { populationMean, deviations } = computeDeviations(departmentDist);
    results.push({
      domain,
      tenantId,
      modelId,
      dimension: "department_type",
      populationMean,
      territories: departmentDist,
      deviations,
    });
  }

  return results;
}

/**
 * Emits ml.bias.territory_deviation alerts for any territory/department that
 * deviates by more than 10% from the population mean.
 */
export async function emitBiasAlerts(biasResults: BiasResult[]): Promise<number> {
  let alertCount = 0;

  for (const result of biasResults) {
    const failedDeviations = result.deviations.filter((d) => d.status === "fail");

    for (const deviation of failedDeviations) {
      const correlationId = randomUUID();

      await db.transaction(async (tx) => {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.biasAlert,
          eventType: EVENTS.biasAlert,
          tenantId: result.tenantId,
          actorId: "00000000-0000-0000-0000-000000000000",
          correlationId,
          payload: {
            tenantId: result.tenantId,
            domain: result.domain,
            modelId: result.modelId,
            dimension: result.dimension,
            deviationPct: deviation.deviationPct,
            affectedTerritory: deviation.territory,
            populationMean: result.populationMean,
            threshold: TERRITORY_DEVIATION_THRESHOLD,
            timestamp: new Date().toISOString(),
            correlationId,
          },
        });
      });

      alertCount++;
      log.warn(
        {
          tenantId: result.tenantId,
          domain: result.domain,
          dimension: result.dimension,
          territory: deviation.territory,
          deviationPct: deviation.deviationPct,
          correlationId,
        },
        "bias deviation alert emitted"
      );
    }
  }

  return alertCount;
}

// ─── Main Monitoring Loop ────────────────────────────────────────────────────

/**
 * Runs drift detection and bias monitoring for all active models across all tenants.
 * Intended to be called periodically (e.g., weekly with training, or quarterly for bias).
 */
export async function runDriftAndBiasMonitoring(): Promise<{
  driftChecks: number;
  driftAlerts: number;
  biasChecks: number;
  biasAlerts: number;
}> {
  const stats = { driftChecks: 0, driftAlerts: 0, biasChecks: 0, biasAlerts: 0 };

  log.info("starting drift detection and bias monitoring");

  // Get all active models
  const activeModels = await db.execute(
    sql`SELECT id, tenant_id, domain FROM ml.ml_models WHERE status = 'active'`
  );
  const models = activeModels as unknown as Array<{ id: string; tenant_id: string; domain: ModelDomain }>;

  for (const model of models) {
    // ─── Drift Detection ───
    try {
      const driftResult = await detectDrift(model.tenant_id, model.domain, model.id);
      if (driftResult) {
        stats.driftChecks++;
        if (driftResult.driftDetected) {
          await emitDriftAlert(driftResult);
          stats.driftAlerts++;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      log.error({ tenantId: model.tenant_id, domain: model.domain, modelId: model.id, err: msg }, "drift detection failed");
    }

    // ─── Bias Monitoring ───
    try {
      const biasResults = await detectBias(model.tenant_id, model.domain, model.id);
      if (biasResults.length > 0) {
        stats.biasChecks += biasResults.length;
        const alertCount = await emitBiasAlerts(biasResults);
        stats.biasAlerts += alertCount;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      log.error({ tenantId: model.tenant_id, domain: model.domain, modelId: model.id, err: msg }, "bias monitoring failed");
    }
  }

  log.info(stats, "drift detection and bias monitoring complete");
  return stats;
}
