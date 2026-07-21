/**
 * feature-store module — Domain logic for materialized feature vectors.
 * Provides feature computation, caching (Redis TTL 5min fallthrough to PostgreSQL),
 * batch refresh, and domain-specific feature definitions.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 20.5, 20.6
 */
import { eq, and } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { mlFeatureVectors, type FeatureDomain } from "./schema.js";

export type { FeatureDomain } from "./schema.js";

const log = pino({ name: "ml-feature-store" });

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface FeatureVector {
  tenantId: string;
  domain: FeatureDomain;
  entityId: string;
  features: Record<string, number | string>;
  computedAt: Date;
}

export interface FeatureStorePort {
  getFeatureVector(tenantId: string, domain: FeatureDomain, entityId: string): Promise<FeatureVector | null>;
  computeAndCache(tenantId: string, domain: FeatureDomain, entityId: string): Promise<FeatureVector>;
  batchRefresh(tenantId: string, domain: FeatureDomain): Promise<number>;
}

// ─── Feature Definitions Per Domain ──────────────────────────────────────────

export const FEATURE_DEFINITIONS: Record<FeatureDomain, string[]> = {
  leads: ["daysInStage", "interactionCount", "companySizeBucket", "dealValueBucket", "sourceChannel", "lastActivityRecencyDays"],
  tickets: ["category", "priority", "assigneeWorkload", "queueDepth", "timeOfDay", "elapsedPctOfSla"],
  inventory: ["avgDailyMovement30d", "avgDailyMovement90d", "stdDevMovement90d", "leadTimeDays", "seasonalityIndex"],
  subscriptions: ["daysSinceLastLogin", "paymentDelayAvgDays", "supportTicketCount90d", "usageScore", "tenureDays"],
  tasks: ["spiHistory5", "cpiHistory5", "resourceUtilization", "dependencyCount", "criticalPathFlag"],
  transactions: ["amountPaise", "categoryId", "vendorId", "dayOfWeek", "hourOfDay", "zScoreFromMean90d"],
};

// ─── Cache Key Helpers ───────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 300; // 5 minutes

function featureCacheKey(tenantId: string, domain: FeatureDomain, entityId: string): string {
  return `ml:${tenantId}:feature:${domain}:${entityId}`;
}

// ─── Feature Store Implementation ────────────────────────────────────────────

/**
 * Retrieve a feature vector using cache.getOrLoad pattern.
 * Redis TTL 5min, fallthrough to PostgreSQL on cache miss.
 * If Redis is unavailable, falls through to PostgreSQL (graceful degradation).
 */
export async function getFeatureVector(
  tenantId: string,
  domain: FeatureDomain,
  entityId: string,
): Promise<FeatureVector | null> {
  const key = featureCacheKey(tenantId, domain, entityId);

  try {
    return await cache.getOrLoad<FeatureVector>(
      key,
      async () => loadFromPostgres(tenantId, domain, entityId),
      CACHE_TTL_SECONDS,
    );
  } catch (err) {
    // Graceful degradation: if Redis is unavailable, fall through to PostgreSQL
    log.warn({ tenantId, domain, entityId, err: (err as Error).message }, "cache unavailable — falling through to PostgreSQL");
    return loadFromPostgres(tenantId, domain, entityId);
  }
}

/**
 * Compute domain-specific features for an entity, persist to PostgreSQL, and cache.
 * Used for both real-time recomputation on entity events and initial computation.
 */
export async function computeAndCache(
  tenantId: string,
  domain: FeatureDomain,
  entityId: string,
): Promise<FeatureVector> {
  const features = computeDomainFeatures(tenantId, domain, entityId);
  const now = new Date();

  const vector: FeatureVector = {
    tenantId,
    domain,
    entityId,
    features,
    computedAt: now,
  };

  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this write — a bare db.insert() runs with no RLS GUC set.
  await db.transaction((tx) =>
    tx
      .insert(mlFeatureVectors)
      .values({
        tenantId,
        domain,
        entityId,
        features,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: [mlFeatureVectors.tenantId, mlFeatureVectors.domain, mlFeatureVectors.entityId],
        set: {
          features,
          computedAt: now,
        },
      }),
  );

  // Prime cache with fresh vector
  const key = featureCacheKey(tenantId, domain, entityId);
  try {
    await cache.put(key, vector, CACHE_TTL_SECONDS);
  } catch (err) {
    log.warn({ tenantId, domain, entityId, err: (err as Error).message }, "failed to cache feature vector — PostgreSQL write succeeded");
  }

  return vector;
}

/**
 * Batch refresh all feature vectors for a given tenant + domain.
 * Used by the daily batch refresh cron job.
 * Returns the count of entities refreshed.
 */
export async function batchRefresh(
  tenantId: string,
  domain: FeatureDomain,
): Promise<number> {
  // Get all entities that have feature vectors for this tenant+domain.
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const existing = await db.transaction((tx) =>
    tx
      .select({ entityId: mlFeatureVectors.entityId })
      .from(mlFeatureVectors)
      .where(
        and(
          eq(mlFeatureVectors.tenantId, tenantId),
          eq(mlFeatureVectors.domain, domain),
        ),
      ),
  );

  let refreshed = 0;
  for (const row of existing) {
    try {
      await computeAndCache(tenantId, domain, row.entityId);
      refreshed++;
    } catch (err) {
      log.error(
        { tenantId, domain, entityId: row.entityId, err: (err as Error).message },
        "batch refresh: failed to recompute feature vector",
      );
    }
  }

  log.info({ tenantId, domain, total: existing.length, refreshed }, "batch refresh completed");
  return refreshed;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

async function loadFromPostgres(
  tenantId: string,
  domain: FeatureDomain,
  entityId: string,
): Promise<FeatureVector | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(mlFeatureVectors)
      .where(
        and(
          eq(mlFeatureVectors.tenantId, tenantId),
          eq(mlFeatureVectors.domain, domain),
          eq(mlFeatureVectors.entityId, entityId),
        ),
      )
      .limit(1),
  );

  if (rows.length === 0) return null;

  const row = rows[0]!;
  return {
    tenantId: row.tenantId,
    domain: row.domain as FeatureDomain,
    entityId: row.entityId,
    features: row.features as Record<string, number | string>,
    computedAt: row.computedAt,
  };
}

/**
 * Compute domain-specific features for an entity.
 * In production, these would query the respective domain services for data.
 * Each domain's features are initialized to sensible defaults that will be
 * overwritten when actual entity data is fetched from the domain service.
 *
 * This function serves as the feature computation orchestrator — it defines
 * what features exist per domain and initializes them. The actual feature
 * values are filled during the domain integration phase (Workstream C tasks 5.1–5.6)
 * which queries real entity data from domain services via internal HTTP calls.
 */
function computeDomainFeatures(
  _tenantId: string,
  domain: FeatureDomain,
  _entityId: string,
): Record<string, number | string> {
  const featureNames = FEATURE_DEFINITIONS[domain];
  const features: Record<string, number | string> = {};

  // Initialize all features with default values.
  // Domain integration tasks (5.1–5.6) will implement actual data retrieval.
  for (const name of featureNames) {
    features[name] = getDefaultFeatureValue(domain, name);
  }

  return features;
}

/**
 * Returns a type-appropriate default for each feature.
 * Numeric features default to 0; categorical features default to "unknown".
 */
function getDefaultFeatureValue(domain: FeatureDomain, featureName: string): number | string {
  // Categorical features that produce string values
  const categoricalFeatures: Record<string, Set<string>> = {
    leads: new Set(["sourceChannel"]),
    tickets: new Set(["category", "priority"]),
    inventory: new Set([]),
    subscriptions: new Set([]),
    tasks: new Set([]),
    transactions: new Set(["categoryId", "vendorId"]),
  };

  if (categoricalFeatures[domain]?.has(featureName)) {
    return "unknown";
  }

  return 0;
}

// ─── FeatureStorePort Implementation ─────────────────────────────────────────

export const featureStore: FeatureStorePort = {
  getFeatureVector,
  computeAndCache,
  batchRefresh,
};
