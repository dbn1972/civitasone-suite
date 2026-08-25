/**
 * visitor-service: document-scan image cleanup worker.
 *
 * Scheduled worker that enforces DPDP Act compliance by deleting raw document
 * images from S3/MinIO after they expire (1 hour from upload). Runs every
 * 60 seconds, queries scan_sessions with expired images, deletes from storage,
 * and marks records as deleted.
 *
 * Env-gated: S3_BUCKET (object storage bucket name)
 *
 * Requirements validated: 6.9
 */
import { pino } from "pino";
import { and, eq, lte } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { scanSessions } from "./schema.js";

const log = pino({ name: "document-scan-image-cleanup" });

/** Cleanup interval in milliseconds (60 seconds). */
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * S3/MinIO client adapter — env-gated.
 * Exported so other modules that need to delete a single stored object by
 * key (e.g. dpdp/purge-worker.ts deleting a purged visitor's photoRef blob)
 * reuse this exact client/approach instead of hand-rolling their own S3
 * client construction.
 */
export async function deleteFromStorage(key: string): Promise<void> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    log.warn({ key, event: "s3_bucket_not_configured" },
      "S3_BUCKET not configured — skipping image deletion");
    return;
  }

  const endpoint = process.env.S3_ENDPOINT ?? "https://s3.amazonaws.com";
  const region = process.env.S3_REGION ?? "ap-south-1";

  try {
    // Use the AWS SDK S3 client or MinIO client
    const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region,
      ...(endpoint.includes("localhost") || endpoint.includes("localstack")
        ? { endpoint, forcePathStyle: true }
        : {}),
    });

    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }));

    log.info({ bucket, key, event: "image_deleted_from_storage" },
      "raw document image deleted from storage");
  } catch (err) {
    log.error({ err, bucket, key, event: "image_deletion_failed" },
      "failed to delete document image from storage");
    throw err;
  }
}

/**
 * Run a single cleanup cycle: find expired images, delete from storage,
 * and mark as deleted in the database.
 */
export async function runCleanupCycle(): Promise<number> {
  const now = new Date();

  // Find scan sessions with expired images that have not been deleted
  // Cross-tenant scan via the BYPASSRLS scanner pool (bare db.select() under
  // FORCE RLS as visitor_svc returns zero rows -> expired images never purged).
  const expiredSessions = await scannerDb
    .select({
      id: scanSessions.id,
      tenantId: scanSessions.tenantId,
      imageStorageKey: scanSessions.imageStorageKey,
    })
    .from(scanSessions)
    .where(
      and(
        lte(scanSessions.imageExpiresAt, now),
        eq(scanSessions.imageDeleted, false),
      ),
    )
    .limit(100); // Process in batches to avoid long locks

  if (expiredSessions.length === 0) {
    return 0;
  }

  let deletedCount = 0;

  for (const session of expiredSessions) {
    if (!session.imageStorageKey) {
      // No storage key — just mark as deleted
      await runWithTenant(session.tenantId, () =>
        db.transaction((tx) =>
          tx
            .update(scanSessions)
            .set({ imageDeleted: true })
            .where(and(eq(scanSessions.id, session.id), eq(scanSessions.tenantId, session.tenantId))),
        ),
      );
      deletedCount++;
      continue;
    }

    try {
      // Delete from S3/MinIO
      await deleteFromStorage(session.imageStorageKey);

      // Mark as deleted in database (inside the session's tenant scope for RLS)
      await runWithTenant(session.tenantId, () =>
        db.transaction((tx) =>
          tx
            .update(scanSessions)
            .set({ imageDeleted: true })
            .where(and(eq(scanSessions.id, session.id), eq(scanSessions.tenantId, session.tenantId))),
        ),
      );

      deletedCount++;

      log.info({
        sessionId: session.id,
        tenantId: session.tenantId,
        storageKey: session.imageStorageKey,
        event: "scan_image_cleanup_completed",
      }, "scan session image cleaned up");
    } catch (err) {
      log.error({
        err,
        sessionId: session.id,
        tenantId: session.tenantId,
        event: "scan_image_cleanup_failed",
      }, "failed to clean up scan session image — will retry next cycle");
      // Continue processing other sessions
    }
  }

  if (deletedCount > 0) {
    log.info({ deletedCount, totalExpired: expiredSessions.length, event: "cleanup_cycle_completed" },
      "image cleanup cycle completed");
  }

  return deletedCount;
}

// ---------------------------------------------------------------------------
// Scheduled Worker
// ---------------------------------------------------------------------------

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the image cleanup worker. Runs every 60 seconds.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startImageCleanupWorker(): void {
  if (cleanupTimer) return;

  log.info({ intervalMs: CLEANUP_INTERVAL_MS, event: "image_cleanup_worker_started" },
    "document image cleanup worker started");

  cleanupTimer = setInterval(async () => {
    try {
      await runCleanupCycle();
    } catch (err) {
      log.error({ err, event: "cleanup_cycle_error" },
        "unexpected error in image cleanup cycle");
    }
  }, CLEANUP_INTERVAL_MS);

  // Allow the process to exit even if the timer is running
  cleanupTimer.unref();
}

/**
 * Stop the image cleanup worker gracefully.
 * Called during SIGTERM shutdown.
 */
export function stopImageCleanupWorker(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    log.info({ event: "image_cleanup_worker_stopped" },
      "document image cleanup worker stopped");
  }
}
