/**
 * Model Registry Domain Logic
 *
 * Manages ML model lifecycle: registration, promotion, deactivation, and version history.
 * All operations are tenant-scoped with optimistic locking. Artifacts stored in S3,
 * metadata in PostgreSQL, and current-model pointer cached in Redis (5-min TTL).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 19.2, 21.6, 24.5
 */

import { eq, and, desc, ne } from "drizzle-orm";
import { putObject } from "@civitasone/storage";
import { mlModels, type MlModelRow, type MlModelInsert, type ModelStatus, type ModelDomain } from "../models/schema.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { randomUUID } from "node:crypto";

// ─── Constants ────────────────────────────────────────────────────

/** Maximum artifact size: 50MB */
export const MAX_ARTIFACT_SIZE_BYTES = 50 * 1024 * 1024;

/** Maximum retained non-active versions per tenant per domain */
const MAX_RETAINED_VERSIONS = 3;

/** Redis cache key for current model per tenant per domain */
function currentModelCacheKey(tenantId: string, domain: string): string {
  return `ml:${tenantId}:model:${domain}:current`;
}

/** Metric tolerance for promotion gate (2%) */
const PROMOTION_TOLERANCE = 0.02;

// ─── Interfaces ───────────────────────────────────────────────────

export interface ModelMetrics {
  accuracy?: number;
  precision?: number;
  recall?: number;
  aucRoc?: number;
  falsePositiveRate?: number;
  rmse?: number;
  mape?: number;
}

export interface ModelCard {
  trainingDataRange: { start: Date; end: Date };
  features: string[];
  metrics: ModelMetrics;
  limitations: string[];
  biasCheckResults: BiasCheckResult[];
}

export interface BiasCheckResult {
  dimension: string;
  deviationPct: number;
  status: "pass" | "warn" | "fail";
}

export interface ModelMetadata {
  id: string;
  tenantId: string;
  domain: ModelDomain;
  version: number;
  status: ModelStatus;
  s3Key: string;
  trainedAt: Date;
  recordCount: number;
  metrics: ModelMetrics;
  featureList: string[];
  modelCard: ModelCard | null;
}

export interface RegisterCandidateInput {
  tenantId: string;
  domain: ModelDomain;
  version: number;
  s3Key: string;
  trainedAt: Date;
  recordCount: number;
  metrics: ModelMetrics;
  featureList: string[];
  modelCard?: ModelCard | null;
  createdBy: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

function rowToMetadata(row: MlModelRow): ModelMetadata {
  return {
    id: row.id,
    tenantId: row.tenantId,
    domain: row.domain as ModelDomain,
    version: row.version,
    status: row.status as ModelStatus,
    s3Key: row.s3Key,
    trainedAt: row.trainedAt,
    recordCount: row.recordCount,
    metrics: (row.metrics ?? {}) as ModelMetrics,
    featureList: row.featureList ?? [],
    modelCard: (row.modelCard as ModelCard) ?? null,
  };
}

/**
 * Get the primary metric for comparison based on model domain.
 * Different domains use different primary quality metrics.
 */
function getPrimaryMetric(metrics: ModelMetrics): number | null {
  if (metrics.aucRoc != null) return metrics.aucRoc;
  if (metrics.accuracy != null) return metrics.accuracy;
  if (metrics.mape != null) return 1 - metrics.mape; // lower MAPE is better, invert for comparison
  if (metrics.precision != null) return metrics.precision;
  return null;
}

/**
 * Determine if candidate metrics meet promotion criteria relative to current model.
 * Promotes if candidate metric >= (current metric - tolerance).
 */
export function meetsPromotionCriteria(candidateMetrics: ModelMetrics, currentMetrics: ModelMetrics): boolean {
  const candidateScore = getPrimaryMetric(candidateMetrics);
  const currentScore = getPrimaryMetric(currentMetrics);

  // If we can't compute metrics for either, allow promotion (no basis to reject)
  if (candidateScore == null || currentScore == null) return true;

  // Promote if candidate is within 2% tolerance of current
  return candidateScore >= currentScore - PROMOTION_TOLERANCE;
}

// ─── Domain Functions ─────────────────────────────────────────────

/**
 * Get the currently active model for a tenant and domain.
 * Uses Redis cache with 5-minute TTL, falling through to PostgreSQL.
 */
export async function getCurrentModel(tenantId: string, domain: ModelDomain): Promise<ModelMetadata | null> {
  const cacheKey = currentModelCacheKey(tenantId, domain);

  return cache.getOrLoad<ModelMetadata | null>(cacheKey, async () => {
    const rows = await db
      .select()
      .from(mlModels)
      .where(
        and(
          eq(mlModels.tenantId, tenantId),
          eq(mlModels.domain, domain),
          eq(mlModels.status, "active"),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return rowToMetadata(rows[0]!);
  });
}

/**
 * Register a new candidate model.
 * Stores metadata in PostgreSQL and uploads artifact to S3.
 * Enforces 50MB artifact size limit.
 *
 * @param input - Candidate model metadata
 * @param artifact - Model artifact buffer (serialized JSON)
 * @returns Registered model metadata with generated ID
 * @throws Error if artifact exceeds 50MB size limit
 */
export async function registerCandidate(
  input: RegisterCandidateInput,
  artifact?: Buffer,
): Promise<ModelMetadata> {
  // Enforce artifact size limit
  if (artifact && artifact.byteLength > MAX_ARTIFACT_SIZE_BYTES) {
    throw new Error(
      `Model artifact size (${artifact.byteLength} bytes) exceeds maximum allowed size (${MAX_ARTIFACT_SIZE_BYTES} bytes)`,
    );
  }

  // Upload artifact to S3 if provided
  if (artifact) {
    await putObject(input.s3Key, artifact, "application/json");
  }

  // Store metadata in PostgreSQL
  const insertRow: MlModelInsert = {
    tenantId: input.tenantId,
    domain: input.domain,
    version: input.version,
    status: "candidate",
    s3Key: input.s3Key,
    trainedAt: input.trainedAt,
    recordCount: input.recordCount,
    metrics: input.metrics as Record<string, unknown>,
    featureList: input.featureList,
    modelCard: input.modelCard ? (input.modelCard as unknown as Record<string, unknown>) : null,
    createdBy: input.createdBy,
    updatedBy: input.createdBy,
  };

  const [inserted] = await db.insert(mlModels).values(insertRow).returning();
  return rowToMetadata(inserted!);
}

/**
 * Promote a candidate model to active status.
 *
 * - Compares candidate metrics against current active model (2% tolerance gate)
 * - Deactivates the current active model (if any)
 * - Sets candidate to active
 * - Archives versions beyond the 3-version retention cap
 * - Invalidates the Redis cache for the current model
 * - Emits an audit event via outbox
 * - Uses optimistic locking (version_lock)
 *
 * @returns true if promotion succeeded, false if metrics gate failed
 */
export async function promote(modelId: string, actorId: string): Promise<boolean> {
  // Fetch the candidate model
  const [candidate] = await db
    .select()
    .from(mlModels)
    .where(eq(mlModels.id, modelId))
    .limit(1);

  if (!candidate) {
    throw new Error(`Model not found: ${modelId}`);
  }

  if (candidate.status !== "candidate") {
    throw new Error(`Model ${modelId} is not in candidate status (current: ${candidate.status})`);
  }

  const candidateMetrics = (candidate.metrics ?? {}) as ModelMetrics;
  const tenantId = candidate.tenantId;
  const domain = candidate.domain as ModelDomain;

  // Check metrics gate against current active model
  const currentActive = await db
    .select()
    .from(mlModels)
    .where(
      and(
        eq(mlModels.tenantId, tenantId),
        eq(mlModels.domain, domain),
        eq(mlModels.status, "active"),
      ),
    )
    .limit(1);

  if (currentActive.length > 0) {
    const currentMetrics = (currentActive[0]!.metrics ?? {}) as ModelMetrics;
    if (!meetsPromotionCriteria(candidateMetrics, currentMetrics)) {
      return false;
    }
  }

  // Perform promotion in a transaction with optimistic locking
  await db.transaction(async (tx) => {
    // Deactivate current active model (if any)
    if (currentActive.length > 0) {
      const current = currentActive[0]!;
      const updated = await tx
        .update(mlModels)
        .set({
          status: "deactivated",
          updatedAt: new Date(),
          updatedBy: actorId,
          versionLock: current.versionLock + 1,
        })
        .where(
          and(
            eq(mlModels.id, current.id),
            eq(mlModels.versionLock, current.versionLock),
          ),
        )
        .returning();

      if (updated.length === 0) {
        throw new Error("Optimistic lock conflict: current active model was modified concurrently");
      }
    }

    // Promote the candidate
    const promoted = await tx
      .update(mlModels)
      .set({
        status: "active",
        updatedAt: new Date(),
        updatedBy: actorId,
        versionLock: candidate.versionLock + 1,
      })
      .where(
        and(
          eq(mlModels.id, modelId),
          eq(mlModels.versionLock, candidate.versionLock),
        ),
      )
      .returning();

    if (promoted.length === 0) {
      throw new Error("Optimistic lock conflict: candidate model was modified concurrently");
    }

    // Archive versions beyond the retention cap (keep max 3 non-active)
    await enforceVersionRetention(tx, tenantId, domain, modelId);

    // Emit audit event via outbox
    await enqueue(tx, {
      topic: EVENTS.modelPromoted,
      eventType: EVENTS.modelPromoted,
      tenantId,
      actorId,
      correlationId: randomUUID(),
      payload: {
        tenantId,
        domain,
        modelId,
        version: candidate.version,
        previousModelId: currentActive.length > 0 ? currentActive[0]!.id : null,
        metrics: candidateMetrics,
        promotedBy: actorId,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Invalidate cache
  const cacheKey = currentModelCacheKey(tenantId, domain);
  await cache.invalidate(cacheKey);

  return true;
}

/**
 * Deactivate a model with a given reason.
 * Reverts to the most recent prior version if available.
 * Emits an audit event via outbox.
 */
export async function deactivate(modelId: string, reason: string): Promise<void> {
  const [model] = await db
    .select()
    .from(mlModels)
    .where(eq(mlModels.id, modelId))
    .limit(1);

  if (!model) {
    throw new Error(`Model not found: ${modelId}`);
  }

  const tenantId = model.tenantId;
  const domain = model.domain as ModelDomain;

  await db.transaction(async (tx) => {
    // Deactivate the model with optimistic locking
    const deactivated = await tx
      .update(mlModels)
      .set({
        status: "deactivated" as const,
        updatedAt: new Date(),
        updatedBy: model.updatedBy,
        versionLock: model.versionLock + 1,
      })
      .where(
        and(
          eq(mlModels.id, modelId),
          eq(mlModels.versionLock, model.versionLock),
        ),
      )
      .returning();

    if (deactivated.length === 0) {
      throw new Error("Optimistic lock conflict: model was modified concurrently");
    }

    // Attempt fallback reversion — promote the most recent deactivated version
    const [fallback] = await tx
      .select()
      .from(mlModels)
      .where(
        and(
          eq(mlModels.tenantId, tenantId),
          eq(mlModels.domain, domain),
          eq(mlModels.status, "deactivated"),
          ne(mlModels.id, modelId),
        ),
      )
      .orderBy(desc(mlModels.version))
      .limit(1);

    if (fallback) {
      await tx
        .update(mlModels)
        .set({
          status: "active" as const,
          updatedAt: new Date(),
          updatedBy: model.updatedBy,
          versionLock: fallback.versionLock + 1,
        })
        .where(
          and(
            eq(mlModels.id, fallback.id),
            eq(mlModels.versionLock, fallback.versionLock),
          ),
        );
    }

    // Emit audit event via outbox
    await enqueue(tx, {
      topic: EVENTS.modelDeactivated,
      eventType: EVENTS.modelDeactivated,
      tenantId,
      actorId: model.updatedBy,
      correlationId: randomUUID(),
      payload: {
        tenantId,
        domain,
        modelId,
        version: model.version,
        reason,
        fallbackModelId: fallback?.id ?? null,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Invalidate cache
  const cacheKey = currentModelCacheKey(tenantId, domain);
  await cache.invalidate(cacheKey);
}

/**
 * Get version history for a tenant and domain, ordered by version descending.
 * Used by the rollback UI to display available versions.
 */
export async function getVersionHistory(
  tenantId: string,
  domain: ModelDomain,
  limit = 10,
): Promise<ModelMetadata[]> {
  const rows = await db
    .select()
    .from(mlModels)
    .where(
      and(
        eq(mlModels.tenantId, tenantId),
        eq(mlModels.domain, domain),
      ),
    )
    .orderBy(desc(mlModels.version))
    .limit(limit);

  return rows.map(rowToMetadata);
}

/**
 * Enforce version retention policy: keep max 3 non-active versions per tenant per domain.
 * Older versions are archived.
 */
async function enforceVersionRetention(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  domain: string,
  excludeModelId: string,
): Promise<void> {
  // Get all non-active, non-archived versions for this tenant/domain, ordered by version desc
  const versions = await tx
    .select()
    .from(mlModels)
    .where(
      and(
        eq(mlModels.tenantId, tenantId),
        eq(mlModels.domain, domain),
        ne(mlModels.status, "active"),
        ne(mlModels.status, "archived"),
        ne(mlModels.id, excludeModelId),
      ),
    )
    .orderBy(desc(mlModels.version));

  // Archive any beyond the retention limit
  if (versions.length > MAX_RETAINED_VERSIONS) {
    const toArchive = versions.slice(MAX_RETAINED_VERSIONS);
    for (const ver of toArchive) {
      await tx
        .update(mlModels)
        .set({
          status: "archived",
          updatedAt: new Date(),
        })
        .where(eq(mlModels.id, ver.id));
    }
  }
}

/**
 * Validate artifact size against the 50MB limit.
 * Utility for pre-upload validation.
 */
export function validateArtifactSize(sizeBytes: number): boolean {
  return sizeBytes <= MAX_ARTIFACT_SIZE_BYTES;
}
