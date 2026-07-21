/**
 * Training data extraction and validation module.
 *
 * Queries historical data with a 24-month rolling window per tenant per domain,
 * enforces minimum data volumes, verifies data freshness, applies stratified
 * sampling for imbalanced datasets, excludes zero-variance features, and
 * enforces tenant-scoped WHERE clauses on all training queries.
 *
 * Validates: Requirements 4.2, 4.3, 20.1, 20.2, 20.3, 20.4, 23.2, 23.6
 */
import { pino } from "pino";
import { sql, and, eq, gte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { mlFeatureVectors } from "../feature-store/schema.js";
import type { FeatureDomain } from "../feature-store/schema.js";
import type { ModelDomain } from "../models/schema.js";

const log = pino({ name: "ml-training-data-extractor" });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrainingDataConfig {
  rollingWindowMonths: number;
  maxDataStaleDays: number;
  minRecords: Record<ModelDomain, number>;
  imbalanceThreshold: number; // minority class < this fraction triggers rebalancing
}

export const DEFAULT_DATA_CONFIG: TrainingDataConfig = {
  rollingWindowMonths: 24,
  maxDataStaleDays: 7,
  minRecords: {
    leads: 100,
    tickets: 200,
    inventory: 30,
    subscriptions: 50,
    tasks: 5,
    transactions: 1000,
  },
  imbalanceThreshold: 0.20,
};

export interface TrainingRecord {
  entityId: string;
  features: Record<string, number>;
  label?: number | undefined; // 0 or 1 for classification domains
  computedAt: Date;
}

export interface ExtractionResult {
  success: boolean;
  records: TrainingRecord[];
  featureNames: string[];
  skippedReason?: string | undefined;
  classDistribution?: { positiveCount: number; negativeCount: number; totalCount: number } | undefined;
  classWeights?: { positive: number; negative: number } | undefined;
  excludedFeatures?: string[] | undefined;
  recordCount: number;
}

// ─── Rolling Window Calculation ──────────────────────────────────────────────

/**
 * Computes the start date of the rolling training window.
 * Training data older than rollingWindowMonths is excluded.
 *
 * Validates: Requirement 20.1
 */
export function computeWindowStart(
  now: Date,
  rollingWindowMonths: number,
): Date {
  const windowStart = new Date(now);
  windowStart.setMonth(windowStart.getMonth() - rollingWindowMonths);
  return windowStart;
}

// ─── Data Freshness Check ────────────────────────────────────────────────────

/**
 * Verifies that training data is fresh enough (< maxDataStaleDays old).
 * Returns true if data is fresh, false if stale.
 *
 * Validates: Requirement 20.2
 */
export function checkDataFreshness(
  latestRecordDate: Date,
  now: Date,
  maxStaleDays: number,
): boolean {
  const diffMs = now.getTime() - latestRecordDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays < maxStaleDays;
}

// ─── Minimum Volume Check ────────────────────────────────────────────────────

/**
 * Checks whether the given record count meets the domain minimum.
 *
 * Validates: Requirement 20.3 (domain-specific minimums)
 */
export function meetsMinimumVolume(
  domain: ModelDomain,
  recordCount: number,
  config: TrainingDataConfig = DEFAULT_DATA_CONFIG,
): boolean {
  const minimum = config.minRecords[domain];
  return recordCount >= minimum;
}

// ─── Zero-Variance Feature Exclusion ─────────────────────────────────────────

/**
 * Identifies and excludes zero-variance features from the dataset.
 * A zero-variance feature has the same value across all records — including
 * these would produce NaN/Infinity during normalization.
 *
 * Returns the list of feature names to keep (non-zero-variance).
 *
 * Validates: Requirement 23.6
 */
export function excludeZeroVarianceFeatures(
  records: TrainingRecord[],
  featureNames: string[],
): { keptFeatures: string[]; excludedFeatures: string[] } {
  if (records.length <= 1) {
    // With 0 or 1 records, cannot compute variance — keep all features
    return { keptFeatures: [...featureNames], excludedFeatures: [] };
  }

  const keptFeatures: string[] = [];
  const excludedFeatures: string[] = [];

  for (const feature of featureNames) {
    const values = records.map((r) => r.features[feature] ?? 0);
    const firstValue = values[0]!;
    const hasVariance = values.some((v) => v !== firstValue);

    if (hasVariance) {
      keptFeatures.push(feature);
    } else {
      excludedFeatures.push(feature);
    }
  }

  return { keptFeatures, excludedFeatures };
}

/**
 * Removes excluded features from all records in-place.
 * Returns new records with only kept features.
 */
export function filterFeatures(
  records: TrainingRecord[],
  keptFeatures: string[],
): TrainingRecord[] {
  const keptSet = new Set(keptFeatures);
  return records.map((r) => {
    const filteredFeatures: Record<string, number> = {};
    for (const [key, val] of Object.entries(r.features)) {
      if (keptSet.has(key)) {
        filteredFeatures[key] = val;
      }
    }
    return {
      ...r,
      features: filteredFeatures,
    };
  });
}

// ─── Class Imbalance Handling ────────────────────────────────────────────────

/**
 * Computes class distribution and determines if the dataset is imbalanced.
 * A dataset is imbalanced when the minority class is < imbalanceThreshold of total.
 *
 * Validates: Requirement 20.4
 */
export function computeClassDistribution(
  records: TrainingRecord[],
): { positiveCount: number; negativeCount: number; totalCount: number; isImbalanced: boolean } {
  let positiveCount = 0;
  let negativeCount = 0;

  for (const record of records) {
    if (record.label === 1) {
      positiveCount++;
    } else {
      negativeCount++;
    }
  }

  const totalCount = records.length;
  const minorityRatio = Math.min(positiveCount, negativeCount) / totalCount;
  const isImbalanced = totalCount > 0 && minorityRatio < DEFAULT_DATA_CONFIG.imbalanceThreshold;

  return { positiveCount, negativeCount, totalCount, isImbalanced };
}

/**
 * Computes class weights for imbalanced datasets using inverse frequency weighting.
 * This allows the training algorithm to weight minority class samples higher.
 *
 * Formula: weight_class = total / (2 * count_class)
 * Ensures balanced contribution to the loss function.
 *
 * Validates: Requirement 20.4
 */
export function computeClassWeights(
  positiveCount: number,
  negativeCount: number,
): { positive: number; negative: number } {
  const total = positiveCount + negativeCount;
  if (total === 0 || positiveCount === 0 || negativeCount === 0) {
    return { positive: 1.0, negative: 1.0 };
  }

  const positiveWeight = total / (2 * positiveCount);
  const negativeWeight = total / (2 * negativeCount);

  return { positive: positiveWeight, negative: negativeWeight };
}

/**
 * Applies stratified sampling to balance an imbalanced dataset.
 * Oversamples the minority class by duplicating records (with replacement)
 * until the minority class reaches the target ratio.
 *
 * This is simpler than SMOTE but effective for training with sufficient data.
 *
 * Validates: Requirement 20.4
 */
export function applyStratifiedSampling(
  records: TrainingRecord[],
  targetMinorityRatio: number = 0.30,
): TrainingRecord[] {
  const { positiveCount, negativeCount, totalCount } = computeClassDistribution(records);
  if (totalCount === 0) return records;

  const minorityIsPositive = positiveCount < negativeCount;
  const minorityCount = minorityIsPositive ? positiveCount : negativeCount;
  const majorityCount = minorityIsPositive ? negativeCount : positiveCount;
  const minorityLabel = minorityIsPositive ? 1 : 0;

  const currentRatio = minorityCount / totalCount;
  if (currentRatio >= targetMinorityRatio) {
    // Already balanced enough
    return records;
  }

  // Compute how many minority samples we need to reach the target ratio
  // target = (minorityCount + oversampleCount) / (totalCount + oversampleCount)
  // Solving for oversampleCount:
  // target * (totalCount + n) = minorityCount + n
  // target * totalCount + target * n = minorityCount + n
  // target * totalCount - minorityCount = n - target * n
  // target * totalCount - minorityCount = n * (1 - target)
  // n = (target * totalCount - minorityCount) / (1 - target)
  const oversampleCount = Math.ceil(
    (targetMinorityRatio * totalCount - minorityCount) / (1 - targetMinorityRatio),
  );

  if (oversampleCount <= 0) return records;

  const minorityRecords = records.filter((r) => r.label === minorityLabel);
  if (minorityRecords.length === 0) return records;

  const oversampled: TrainingRecord[] = [...records];
  for (let i = 0; i < oversampleCount; i++) {
    const sourceIdx = i % minorityRecords.length;
    oversampled.push({ ...minorityRecords[sourceIdx]! });
  }

  return oversampled;
}

// ─── Main Extraction Function ────────────────────────────────────────────────

/**
 * Extracts and validates training data for a given tenant-domain pair.
 *
 * Steps:
 * 1. Compute 24-month rolling window start date
 * 2. Query feature vectors with tenant-scoped WHERE clause
 * 3. Check data freshness (< 7 days stale)
 * 4. Enforce minimum data volume per domain
 * 5. Extract numeric features and classify labels
 * 6. Exclude zero-variance features
 * 7. Apply stratified sampling / class-weight adjustment for imbalanced datasets
 *
 * All queries enforce tenant_id = $tenantId (no cross-tenant aggregation).
 *
 * Validates: Requirements 4.2, 4.3, 20.1, 20.2, 20.3, 20.4, 23.2, 23.6
 */
export async function extractTrainingData(
  tenantId: string,
  domain: ModelDomain,
  config: TrainingDataConfig = DEFAULT_DATA_CONFIG,
  now: Date = new Date(),
): Promise<ExtractionResult> {
  const correlationId = `extract:${tenantId}:${domain}`;

  // Step 1: Compute rolling window
  const windowStart = computeWindowStart(now, config.rollingWindowMonths);

  log.info({ tenantId, domain, windowStart: windowStart.toISOString(), correlationId }, "starting training data extraction");

  // Step 2: Query feature vectors with tenant-scoped WHERE clause
  // Requirement 23.2 / 4.2: tenant-scoped WHERE clause on all training queries
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rawRecords = await db.transaction((tx) =>
    tx
      .select()
      .from(mlFeatureVectors)
      .where(
        and(
          eq(mlFeatureVectors.tenantId, tenantId),
          eq(mlFeatureVectors.domain, domain),
          gte(mlFeatureVectors.computedAt, windowStart),
        ),
      ),
  );

  if (rawRecords.length === 0) {
    log.info({ tenantId, domain, correlationId }, "no training data found within rolling window");
    return {
      success: false,
      records: [],
      featureNames: [],
      skippedReason: "no_data",
      recordCount: 0,
    };
  }

  // Step 3: Check data freshness
  const latestRecord = rawRecords.reduce((latest, r) =>
    r.computedAt > latest.computedAt ? r : latest,
  );

  if (!checkDataFreshness(latestRecord.computedAt, now, config.maxDataStaleDays)) {
    const staleDays = Math.floor((now.getTime() - latestRecord.computedAt.getTime()) / (1000 * 60 * 60 * 24));
    log.warn(
      { tenantId, domain, latestRecordDate: latestRecord.computedAt.toISOString(), staleDays, correlationId },
      "training data is stale — skipping training run",
    );
    return {
      success: false,
      records: [],
      featureNames: [],
      skippedReason: "training_data_stale",
      recordCount: rawRecords.length,
    };
  }

  // Step 4: Enforce minimum data volume per domain
  if (!meetsMinimumVolume(domain, rawRecords.length, config)) {
    const minimum = config.minRecords[domain];
    log.info(
      { tenantId, domain, recordCount: rawRecords.length, minimum, correlationId },
      "insufficient training data volume — below domain minimum",
    );
    return {
      success: false,
      records: [],
      featureNames: [],
      skippedReason: "insufficient_data",
      recordCount: rawRecords.length,
    };
  }

  // Step 5: Extract numeric features and labels
  const trainingRecords = rawRecords.map((row) => {
    const rawFeatures = row.features as Record<string, unknown>;
    const numericFeatures: Record<string, number> = {};

    for (const [key, value] of Object.entries(rawFeatures)) {
      if (typeof value === "number" && isFinite(value)) {
        numericFeatures[key] = value;
      }
      // Skip non-numeric and non-finite values (categorical features handled separately)
    }

    // Extract label for classification domains
    const label = extractLabel(domain, rawFeatures);

    return {
      entityId: row.entityId,
      features: numericFeatures,
      label,
      computedAt: row.computedAt,
    } satisfies TrainingRecord;
  });

  // Determine all numeric feature names from the records
  const allFeatureNames = new Set<string>();
  for (const record of trainingRecords) {
    for (const key of Object.keys(record.features)) {
      allFeatureNames.add(key);
    }
  }
  const featureNamesList = Array.from(allFeatureNames).sort();

  // Normalize: ensure all records have all feature keys (fill missing with 0)
  for (const record of trainingRecords) {
    for (const name of featureNamesList) {
      if (!(name in record.features)) {
        record.features[name] = 0;
      }
    }
  }

  // Step 6: Exclude zero-variance features
  const { keptFeatures, excludedFeatures } = excludeZeroVarianceFeatures(trainingRecords, featureNamesList);

  if (excludedFeatures.length > 0) {
    log.info(
      { tenantId, domain, excludedFeatures, correlationId },
      "excluded zero-variance features from training data",
    );
  }

  // Filter records to only include kept features
  const filteredRecords = filterFeatures(trainingRecords, keptFeatures);

  // Step 7: Handle class imbalance for classification domains
  const classificationDomains: Set<ModelDomain> = new Set(["leads", "tickets", "subscriptions", "transactions"]);
  let finalRecords = filteredRecords;
  let classDistribution: ExtractionResult["classDistribution"];
  let classWeights: ExtractionResult["classWeights"];

  if (classificationDomains.has(domain)) {
    const distribution = computeClassDistribution(filteredRecords);
    classDistribution = {
      positiveCount: distribution.positiveCount,
      negativeCount: distribution.negativeCount,
      totalCount: distribution.totalCount,
    };

    if (distribution.isImbalanced) {
      log.info(
        { tenantId, domain, ...distribution, correlationId },
        "dataset is imbalanced — applying class-weight adjustment",
      );

      // Compute class weights for the training algorithm
      classWeights = computeClassWeights(distribution.positiveCount, distribution.negativeCount);

      // Apply stratified oversampling
      finalRecords = applyStratifiedSampling(filteredRecords);
    }
  }

  log.info(
    {
      tenantId,
      domain,
      originalCount: rawRecords.length,
      finalCount: finalRecords.length,
      featureCount: keptFeatures.length,
      excludedFeatureCount: excludedFeatures.length,
      correlationId,
    },
    "training data extraction completed",
  );

  const result: ExtractionResult = {
    success: true,
    records: finalRecords,
    featureNames: keptFeatures,
    recordCount: finalRecords.length,
  };

  if (classDistribution) {
    result.classDistribution = classDistribution;
  }
  if (classWeights) {
    result.classWeights = classWeights;
  }
  if (excludedFeatures.length > 0) {
    result.excludedFeatures = excludedFeatures;
  }

  return result;
}

// ─── Label Extraction ────────────────────────────────────────────────────────

/**
 * Extracts the binary label for classification domains from feature data.
 * For domains that are not classification-based, returns undefined.
 *
 * Label conventions:
 * - leads: 1 = won/converted, 0 = lost/open
 * - tickets: 1 = breached SLA, 0 = resolved within SLA
 * - subscriptions: 1 = churned, 0 = active/renewed
 * - transactions: 1 = anomalous, 0 = normal
 * - inventory/tasks: regression domains (no binary label)
 */
function extractLabel(
  domain: ModelDomain,
  features: Record<string, unknown>,
): number | undefined {
  switch (domain) {
    case "leads":
      return features.outcome === "won" || features.label === 1 ? 1 : 0;
    case "tickets":
      return features.breached === true || features.label === 1 ? 1 : 0;
    case "subscriptions":
      return features.churned === true || features.label === 1 ? 1 : 0;
    case "transactions":
      return features.anomalous === true || features.label === 1 ? 1 : 0;
    case "inventory":
    case "tasks":
      // Regression domains — no binary label
      return undefined;
    default:
      return undefined;
  }
}

// ─── Utility: Get Latest Record Date ─────────────────────────────────────────

/**
 * Gets the most recent record date for a tenant-domain pair.
 * Used for freshness checks before initiating extraction.
 *
 * All queries are tenant-scoped (Requirement 23.2).
 */
export async function getLatestRecordDate(
  tenantId: string,
  domain: ModelDomain,
): Promise<Date | null> {
  const result = await db.execute(
    sql`SELECT MAX(computed_at) AS latest
        FROM ml.ml_feature_vectors
        WHERE tenant_id = ${tenantId}
        AND domain = ${domain}`,
  );
  const rows = result as unknown as Array<{ latest: string | null }>;
  if (!rows[0]?.latest) return null;
  return new Date(rows[0].latest);
}

/**
 * Gets the record count for a tenant-domain pair within the rolling window.
 * Used by the orchestrator for pre-flight threshold checks.
 *
 * All queries are tenant-scoped (Requirement 23.2).
 */
export async function getRecordCount(
  tenantId: string,
  domain: ModelDomain,
  windowStart: Date,
): Promise<number> {
  const result = await db.execute(
    sql`SELECT COUNT(*)::int AS cnt
        FROM ml.ml_feature_vectors
        WHERE tenant_id = ${tenantId}
        AND domain = ${domain}
        AND computed_at >= ${windowStart.toISOString()}`,
  );
  const rows = result as unknown as Array<{ cnt: number }>;
  return rows[0]?.cnt ?? 0;
}
