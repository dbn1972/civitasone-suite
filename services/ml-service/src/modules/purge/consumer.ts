/**
 * Tenant Deletion Purge Consumer
 *
 * Consumes `tenant.deleted` events and purges all ML data for the tenant:
 *   1. Deletes all ml_models records
 *   2. Deletes all ml_predictions records
 *   3. Deletes all ml_feature_vectors records
 *   4. Deletes all ml_training_runs records
 *   5. Deletes S3 objects under `ml-models/{tenantId}/` prefix
 *
 * Must complete within 24 hours (DPDP Act compliance, Requirement 17.6, 23.3).
 *
 * Validates: Requirements 17.6, 23.3
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import { eq } from "drizzle-orm";
import { deleteObject } from "@civitasone/storage";
import {
  S3Client,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED } from "../../topics.js";
import { mlModels } from "../models/schema.js";
import { mlPredictions } from "../predictions/schema.js";
import { mlFeatureVectors } from "../feature-store/schema.js";
import { mlTrainingRuns } from "../training/schema.js";
import { cache } from "../../shared/infra.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "ml-purge-consumer" });

// ─── S3 Prefix Deletion ──────────────────────────────────────────

/**
 * List all S3 object keys under a given prefix.
 * Handles pagination via ContinuationToken.
 */
async function listObjectKeysByPrefix(prefix: string): Promise<string[]> {
  const endpoint = process.env.AWS_ENDPOINT_URL || undefined;
  const region = process.env.AWS_DEFAULT_REGION || "ap-south-1";
  const bucket = process.env.AWS_S3_BUCKET || "civitasone";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || "";

  const isLocalStack = endpoint?.includes("localhost") || endpoint?.includes("127.0.0.1");
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true" || isLocalStack === true;

  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });

  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) keys.push(obj.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * Delete all S3 objects under the `ml-models/{tenantId}/` prefix.
 * Iterates through listed keys and deletes each one.
 */
export async function deleteS3ObjectsByTenantPrefix(tenantId: string): Promise<number> {
  const prefix = `ml-models/${tenantId}/`;
  const keys = await listObjectKeysByPrefix(prefix);

  let deleted = 0;
  for (const key of keys) {
    try {
      await deleteObject(key);
      deleted++;
    } catch (err) {
      log.warn(
        { tenantId, key, err: (err as Error).message },
        "purge: failed to delete S3 object — continuing",
      );
    }
  }

  return deleted;
}

// ─── Database Purge ──────────────────────────────────────────────

export interface PurgeResult {
  modelsDeleted: number;
  predictionsDeleted: number;
  featureVectorsDeleted: number;
  trainingRunsDeleted: number;
  s3ObjectsDeleted: number;
  durationMs: number;
}

interface PurgeRowCounts {
  predictionsDeleted: number;
  trainingRunsDeleted: number;
  featureVectorsDeleted: number;
  modelsDeleted: number;
}

/** Minimal transaction surface needed for the row deletes + audit enqueue below. */
type PurgeTx = Parameters<typeof enqueue>[0];

/**
 * Delete all ML data rows for a tenant using an ALREADY-OPEN transaction.
 * Deletes in order: predictions (FK → models), training_runs (FK → models),
 * feature_vectors, then models.
 *
 * Shared by purgeTenantData() (which opens its own transaction, for direct/
 * standalone callers) and registerPurgeConsumer() (which needs this in the
 * SAME transaction as its idempotency check — see the note there on why).
 */
async function purgeTenantRowsInTx(tx: PurgeTx, tenantId: string): Promise<PurgeRowCounts> {
  // 1. Delete predictions (references ml_models via model_id FK)
  const predictionsResult = await tx
    .delete(mlPredictions)
    .where(eq(mlPredictions.tenantId, tenantId))
    .returning({ id: mlPredictions.id });

  // 2. Delete training runs (references ml_models via model_id FK)
  const trainingRunsResult = await tx
    .delete(mlTrainingRuns)
    .where(eq(mlTrainingRuns.tenantId, tenantId))
    .returning({ id: mlTrainingRuns.id });

  // 3. Delete feature vectors (no FK dependencies)
  const featureVectorsResult = await tx
    .delete(mlFeatureVectors)
    .where(eq(mlFeatureVectors.tenantId, tenantId))
    .returning({ id: mlFeatureVectors.id });

  // 4. Delete models (now safe since FK-dependent rows are gone)
  const modelsResult = await tx
    .delete(mlModels)
    .where(eq(mlModels.tenantId, tenantId))
    .returning({ id: mlModels.id });

  return {
    predictionsDeleted: predictionsResult.length,
    trainingRunsDeleted: trainingRunsResult.length,
    featureVectorsDeleted: featureVectorsResult.length,
    modelsDeleted: modelsResult.length,
  };
}

/**
 * Purge all ML data for a given tenant from the database.
 * Deletes in order: predictions (FK → models), training_runs (FK → models),
 * feature_vectors, then models.
 */
export async function purgeTenantData(tenantId: string): Promise<PurgeResult> {
  const startMs = Date.now();

  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before these writes — bare db.delete() calls run with no RLS GUC set
  // and would silently delete zero rows under FORCE ROW LEVEL SECURITY.
  const { predictionsDeleted, trainingRunsDeleted, featureVectorsDeleted, modelsDeleted } =
    await db.transaction((tx) => purgeTenantRowsInTx(tx as PurgeTx, tenantId));

  // 5. Delete S3 objects under tenant prefix
  let s3ObjectsDeleted = 0;
  try {
    s3ObjectsDeleted = await deleteS3ObjectsByTenantPrefix(tenantId);
  } catch (err) {
    log.error(
      { tenantId, err: (err as Error).message },
      "purge: S3 prefix deletion failed — database records already removed",
    );
  }

  // 6. Invalidate Redis cache entries for this tenant
  try {
    await invalidateTenantCache(tenantId);
  } catch (err) {
    log.warn(
      { tenantId, err: (err as Error).message },
      "purge: cache invalidation failed — entries will expire via TTL",
    );
  }

  const durationMs = Date.now() - startMs;

  return {
    modelsDeleted,
    predictionsDeleted,
    featureVectorsDeleted,
    trainingRunsDeleted,
    s3ObjectsDeleted,
    durationMs,
  };
}

/**
 * Invalidate known Redis cache patterns for a tenant.
 * Best-effort: keys will also expire naturally via TTL (5 minutes).
 */
async function invalidateTenantCache(tenantId: string): Promise<void> {
  const domains = ["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"];
  const cacheKeys: string[] = [];

  for (const domain of domains) {
    cacheKeys.push(`ml:${tenantId}:model:${domain}:current`);
  }

  for (const key of cacheKeys) {
    try {
      await cache.invalidate(key);
    } catch {
      // Best-effort — TTL will handle it
    }
  }
}

// ─── Consumer Registration ───────────────────────────────────────

export function registerPurgeConsumer(queue: Queue): void {
  queue.subscribe(CONSUMED.tenantDeleted, async (msg: CommandEnvelope) => {
    const startMs = Date.now();
    const payload = msg.payload as { tenantId?: string; deletedAt?: string; correlationId?: string };
    const tenantId = payload.tenantId ?? msg.tenantId;

    if (!tenantId) {
      log.warn({ messageId: msg.messageId }, "purge: missing tenantId in tenant.deleted event — skipping");
      return;
    }

    try {
      // Idempotency check + row purge + audit enqueue happen in ONE transaction.
      //
      // Previously markProcessed() committed in its OWN transaction before
      // purgeTenantData() ran in a SEPARATE one. If the purge then threw for any
      // transient reason (connection blip, constraint error), the message was
      // already durably marked processed — so the re-throw below still triggered
      // a queue retry, but every retry hit markProcessed() first, saw the message
      // as already-processed, and silently returned without ever purging.
      // Net effect: one transient failure permanently and silently dropped a
      // DPDP Act-mandated tenant data purge, with no further error ever logged.
      // Keeping markProcessed atomic with the actual purge means a failed purge
      // is never marked done, so a retry genuinely re-attempts it.
      const rows = await db.transaction(async (tx) => {
        const isNew = await markProcessed(tx, msg.messageId);
        if (!isNew) return null;

        const deleted = await purgeTenantRowsInTx(tx as PurgeTx, tenantId);

        await enqueue(tx as PurgeTx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "ml-service", action: "purge", resourceType: "tenant_data", resourceId: tenantId, outcome: "success" },
        });

        return deleted;
      });

      if (!rows) {
        log.debug({ messageId: msg.messageId, tenantId }, "purge: already processed");
        return;
      }

      // S3 and Redis are external systems that can't participate in the
      // Postgres transaction above — cleaned up best-effort after the DB
      // commit, same as before.
      let s3ObjectsDeleted = 0;
      try {
        s3ObjectsDeleted = await deleteS3ObjectsByTenantPrefix(tenantId);
      } catch (err) {
        log.error(
          { tenantId, err: (err as Error).message },
          "purge: S3 prefix deletion failed — database records already removed",
        );
      }
      try {
        await invalidateTenantCache(tenantId);
      } catch (err) {
        log.warn(
          { tenantId, err: (err as Error).message },
          "purge: cache invalidation failed — entries will expire via TTL",
        );
      }

      const processingTimeMs = Date.now() - startMs;
      log.info(
        {
          messageId: msg.messageId,
          topic: msg.type,
          tenantId,
          processingTimeMs,
          outcome: "processed",
          modelsDeleted: rows.modelsDeleted,
          predictionsDeleted: rows.predictionsDeleted,
          featureVectorsDeleted: rows.featureVectorsDeleted,
          trainingRunsDeleted: rows.trainingRunsDeleted,
          s3ObjectsDeleted,
        },
        "tenant ML data purged successfully",
      );
    } catch (err) {
      const processingTimeMs = Date.now() - startMs;
      log.error(
        {
          messageId: msg.messageId,
          tenantId,
          processingTimeMs,
          err: (err as Error).message,
          outcome: "failed",
        },
        "purge: tenant data purge failed",
      );
      // Re-throw so queue retries / DLQ
      throw err;
    }
  });

  log.info("purge consumer registered for tenant.deleted events");
}
