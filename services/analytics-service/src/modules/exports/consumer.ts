/**
 * exports/consumer.ts — ExportConsumer
 *
 * Picks up export commands from the queue, fetches query results,
 * generates CSV or JSON, enforces 50MB max file size, uploads to S3
 * via @civitasone/storage, generates presigned URL (24h TTL), and
 * updates export job status.
 *
 * CQRS: consumer is the ONLY writer to the export_jobs table.
 * Idempotent via markProcessed inbox check.
 */
import { pino } from "pino";
import { eq, sql } from "drizzle-orm";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { putObject, presignedGetUrl } from "@civitasone/storage";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, AUDIT_TOPIC, EXPORT_RESOURCE } from "../../topics.js";
import { exportJobs, type ExportJobInsert } from "./schema.js";
import {
  generateExport,
  buildFileKey,
  computeExpiresAt,
  PRESIGNED_URL_TTL_SECONDS,
  ExportSizeLimitExceededError,
  type ExportFormat,
} from "./domain.js";
import { queryRuns } from "../queries/schema.js";

const log = pino({ name: "export-consumer" });

type Tx = Parameters<typeof enqueue>[0];

interface ExportPayload {
  id: string;
  queryRunId: string;
  format: ExportFormat;
}

async function audit(
  tx: Tx,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
  outcome: "success" | "failure",
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "analytics", action, resourceType: "export_job", resourceId, outcome },
  });
}

async function emit(
  tx: Tx,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}

/**
 * Register the ExportConsumer on the given queue instance.
 */
export function registerExportConsumer(queue: Queue): void {
  queue.subscribe<ExportPayload>(COMMANDS.createExport, async (msg) => {
    const p = msg.payload as ExportPayload;
    const correlationId = msg.correlationId;

    log.info({ exportId: p.id, queryRunId: p.queryRunId, format: p.format, correlationId }, "export: processing");

    let fileKey: string | null = null;
    let downloadUrl: string | null = null;
    let expiresAt: Date | null = null;
    let fileSizeBytes: bigint | null = null;
    let error: string | null = null;
    let queryRunFound = false;

    try {
      // 1. Fetch source query run inside a short read transaction with tenant GUC.
      const run = await db.transaction(async (rtx) => {
        await rtx.execute(sql`SELECT set_config('app.tenant_id', ${msg.tenantId}, true)`);
        const runs = await rtx
          .select()
          .from(queryRuns)
          .where(eq(queryRuns.id, p.queryRunId))
          .limit(1);
        return runs[0] ?? null;
      });

      if (!run || run.tenantId !== msg.tenantId) {
        throw new Error(`Source query run ${p.queryRunId} not found or not accessible`);
      }

      queryRunFound = true;

      if (run.status !== "completed" || !run.result) {
        throw new Error(`Source query run ${p.queryRunId} has not completed successfully (status: ${run.status})`);
      }

      // 2. Generate export content (CSV or JSON) with 50MB enforcement.
      const exportResult = generateExport(run.result, p.format as ExportFormat);
      fileSizeBytes = BigInt(exportResult.sizeBytes);

      // 3. Upload to S3 via @civitasone/storage.
      fileKey = buildFileKey(msg.tenantId, p.id, p.format as ExportFormat);
      await putObject(fileKey, exportResult.content, exportResult.contentType);

      // 4. Generate presigned download URL (24h TTL).
      downloadUrl = await presignedGetUrl({ key: fileKey, expiresIn: PRESIGNED_URL_TTL_SECONDS });
      expiresAt = computeExpiresAt();

      log.info(
        { exportId: p.id, fileKey, sizeBytes: exportResult.sizeBytes, correlationId },
        "export: upload complete",
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (e instanceof ExportSizeLimitExceededError) {
        log.warn({ exportId: p.id, correlationId, error }, "export: file size limit exceeded");
      } else {
        log.error({ exportId: p.id, correlationId, error }, "export: generation failed");
      }
    }

    // 5. Persist job state in a single transaction (idempotent).
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${msg.tenantId}, true)`);
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent

      const insertRow: ExportJobInsert = {
        id: p.id,
        tenantId: msg.tenantId,
        queryRunId: queryRunFound ? p.queryRunId : null, // null when source doesn't exist (FK safety)
        format: p.format,
        status: "processing",
        fileKey: null,
        downloadUrl: null,
        expiresAt: null,
        fileSizeBytes: null,
        error: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      };
      await tx.insert(exportJobs).values(insertRow);

      if (error) {
        // Mark as failed with error reason.
        await tx
          .update(exportJobs)
          .set({
            status: "failed",
            error: error.slice(0, 4000),
            updatedBy: msg.actorId,
            updatedAt: new Date(),
          })
          .where(eq(exportJobs.id, p.id));

        await audit(tx, msg, "export.create", p.id, "failure");
      } else {
        // Mark as completed with file details and presigned URL.
        await tx
          .update(exportJobs)
          .set({
            status: "completed",
            fileKey,
            downloadUrl,
            expiresAt,
            fileSizeBytes,
            updatedBy: msg.actorId,
            updatedAt: new Date(),
          })
          .where(eq(exportJobs.id, p.id));

        await emit(tx, msg, EVENTS.exportCreated, {
          exportId: p.id,
          queryRunId: p.queryRunId,
          format: p.format,
          fileKey,
          fileSizeBytes: fileSizeBytes?.toString(),
        });
        await audit(tx, msg, "export.create", p.id, "success");
      }
    });

    // 6. Invalidate cache for export resource list.
    await cache.invalidateResource(msg.tenantId, EXPORT_RESOURCE);

    log.info(
      { exportId: p.id, status: error ? "failed" : "completed", correlationId },
      "export: done",
    );
  });
}
