/**
 * visitor-service: document-scan consumer.
 *
 * Handles document scanning CQRS commands following the established pattern:
 *   markProcessed(tx, msg.messageId) → DB write → outbox event
 *   → cache invalidate (post-commit, best-effort).
 *
 * Each handler operates within a single DB transaction. The outbox relay
 * publishes events after commit (transactional outbox guarantee).
 *
 * Consumer handlers:
 *   - handleScanProcess: markProcessed → download image from S3 → performOcr
 *     (circuit breaker) → map fields → check confidence → blacklist screening
 *     (SISMEMBER) → INSERT ocr_result → outbox (scanCompleted or
 *     scanOcrLowConfidence or scanBlacklistMatch) → trigger DigiLocker verify
 *     if doc type supports it
 *   - handleScanOcrComplete: status update + cache invalidate
 *
 * Requirements validated: 6.3, 6.4, 6.5, 6.7, 6.8, 6.10, 11.4
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { eq, and } from "drizzle-orm";
import { Redis } from "ioredis";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { scanSessions, ocrResults } from "./schema.js";
import { performOcr } from "./ocr-adapter.js";
import { isLowConfidence, detectDocumentType, mapOcrFields, shouldScreenBlacklist } from "./domain.js";
import { blindIndex } from "../../shared/pii-crypto.js";

const log = pino({ name: "document-scan-consumer" });

/** Cache resource keys for document-scan records. */
const RESOURCE_SCAN_SESSION = "scan_session";
const RESOURCE_OCR_RESULT = "ocr_result";

// ── Redis Client for Blacklist Screening ──────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url || process.env.CACHE_DRIVER === "memory") return null;
  _redis = new Redis(url);
  return _redis;
}

/** Blacklist set key for tenant. */
function blacklistKey(tenantId: string): string {
  return `visitor:${tenantId}:blacklist:docs`;
}

/** Watchlist set key for tenant. */
function watchlistKey(tenantId: string): string {
  return `visitor:${tenantId}:watchlist:docs`;
}

// ── S3/MinIO client for image download ────────────────────────────────────

async function downloadFromStorage(key: string): Promise<Buffer> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("S3_BUCKET must be configured for image download");
  }

  const endpoint = process.env.S3_ENDPOINT ?? "https://s3.amazonaws.com";
  const region = process.env.S3_REGION ?? "ap-south-1";

  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region,
    ...(endpoint.includes("localhost") || endpoint.includes("localstack")
      ? { endpoint, forcePathStyle: true }
      : {}),
  });

  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));

  if (!response.Body) {
    throw new Error(`empty response body for key ${key}`);
  }

  // Convert readable stream to Buffer
  const chunks: Uint8Array[] = [];
  const stream = response.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ── Payload Types ─────────────────────────────────────────────────────────

export interface ScanProcessPayload {
  sessionId: string;
  tenantId: string;
  deviceId: string;
  imageStorageKey: string;
}

export interface ScanOcrCompletePayload {
  sessionId: string;
  ocrResultId: string;
  tenantId: string;
  status: "completed" | "failed";
}

// ── Document types that support DigiLocker verification ───────────────────

const DIGILOCKER_SUPPORTED_TYPES = new Set(["aadhaar", "pan", "driving_license"]);

// ── Consumer Registration ─────────────────────────────────────────────────

export function registerDocumentScanConsumers(queue: Queue): void {

  // ─── scanProcess ──────────────────────────────────────────────────────
  queue.subscribe<ScanProcessPayload>(COMMANDS.scanProcess, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // 1. Mark session as processing
      await tx
        .update(scanSessions)
        .set({ status: "processing" })
        .where(and(eq(scanSessions.id, p.sessionId), eq(scanSessions.tenantId, p.tenantId)));

      // 2. Download image from S3
      let imageBuffer: Buffer;
      try {
        imageBuffer = await downloadFromStorage(p.imageStorageKey);
      } catch (err) {
        log.error({ err, sessionId: p.sessionId, event: "image_download_failed" },
          "failed to download document image from storage");

        await tx
          .update(scanSessions)
          .set({ status: "failed" })
          .where(and(eq(scanSessions.id, p.sessionId), eq(scanSessions.tenantId, p.tenantId)));

        await enqueue(tx, {
          topic: EVENTS.scanCompleted,
          eventType: EVENTS.scanCompleted,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { sessionId: p.sessionId, status: "failed", reason: "image_download_failed" },
        });
        return;
      }

      // 3. Perform OCR (cloud with circuit breaker → Tesseract fallback)
      let extraction;
      try {
        extraction = await performOcr(imageBuffer);
      } catch (err) {
        log.error({ err, sessionId: p.sessionId, event: "ocr_failed" },
          "OCR processing failed");

        await tx
          .update(scanSessions)
          .set({ status: "failed" })
          .where(and(eq(scanSessions.id, p.sessionId), eq(scanSessions.tenantId, p.tenantId)));

        await enqueue(tx, {
          topic: EVENTS.scanCompleted,
          eventType: EVENTS.scanCompleted,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { sessionId: p.sessionId, status: "failed", reason: "ocr_processing_failed" },
        });
        return;
      }

      // 4. Map fields and detect document type
      const mapped = mapOcrFields(extraction);
      const docType = mapped.idDocumentType
        ?? (mapped.idDocumentNumber ? detectDocumentType(mapped.idDocumentNumber) : null);

      // 5. Check confidence
      const lowConf = isLowConfidence(mapped.confidenceScores);

      // 6. Blacklist/watchlist screening via Redis SISMEMBER
      let blacklistMatch = false;
      let watchlistMatch = false;

      if (shouldScreenBlacklist(mapped)) {
        const docHash = blindIndex(mapped.idDocumentNumber!);
        try {
          const redis = getRedis();
          if (redis) {
            const [blResult, wlResult] = await Promise.all([
              redis.sismember(blacklistKey(p.tenantId), docHash),
              redis.sismember(watchlistKey(p.tenantId), docHash),
            ]);
            blacklistMatch = blResult === 1;
            watchlistMatch = wlResult === 1;
          }
        } catch (err) {
          log.warn({ err, sessionId: p.sessionId, event: "screening_failed" },
            "blacklist/watchlist screening failed — continuing without match");
        }
      }

      // 7. Insert OCR result
      const ocrResultId = randomUUID();
      await tx.insert(ocrResults).values({
        id: ocrResultId,
        tenantId: p.tenantId,
        scanSessionId: p.sessionId,
        fullName: mapped.fullName,
        dateOfBirth: mapped.dateOfBirth,
        idDocumentNumber: mapped.idDocumentNumber,
        idDocumentType: docType,
        address: mapped.address,
        photoRegionKey: mapped.photoRegionKey,
        confidenceScores: mapped.confidenceScores,
        lowConfidence: lowConf,
        blacklistMatch,
        watchlistMatch,
        verificationStatus: "pending",
      });

      // 8. Update session status to completed
      await tx
        .update(scanSessions)
        .set({ status: "completed" })
        .where(and(eq(scanSessions.id, p.sessionId), eq(scanSessions.tenantId, p.tenantId)));

      // 9. Outbox events
      await enqueue(tx, {
        topic: EVENTS.scanCompleted,
        eventType: EVENTS.scanCompleted,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          sessionId: p.sessionId,
          ocrResultId,
          status: "completed",
          docType,
          lowConfidence: lowConf,
          blacklistMatch,
          watchlistMatch,
        },
      });

      // Emit specific event for low confidence
      if (lowConf) {
        await enqueue(tx, {
          topic: EVENTS.scanOcrLowConfidence,
          eventType: EVENTS.scanOcrLowConfidence,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            sessionId: p.sessionId,
            ocrResultId,
            confidenceScores: mapped.confidenceScores,
          },
        });
      }

      // Emit specific event for blacklist match
      if (blacklistMatch) {
        await enqueue(tx, {
          topic: EVENTS.scanBlacklistMatch,
          eventType: EVENTS.scanBlacklistMatch,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            sessionId: p.sessionId,
            ocrResultId,
            idDocumentType: docType,
          },
        });
      }

      // 10. Trigger DigiLocker verification if document type supports it
      if (docType && DIGILOCKER_SUPPORTED_TYPES.has(docType) && mapped.idDocumentNumber) {
        await enqueue(tx, {
          topic: COMMANDS.digilockerVerify,
          eventType: COMMANDS.digilockerVerify,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            sessionId: p.sessionId,
            ocrResultId,
            documentType: docType,
            documentNumber: mapped.idDocumentNumber,
          },
        });
      }
    });

    // Post-commit: invalidate caches (best-effort)
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_SCAN_SESSION, p.sessionId));
    } catch (err) {
      log.warn({ err, sessionId: p.sessionId, event: "cache_invalidate_failed" },
        "scan session cache invalidation failed");
    }
  });

  // ─── scanOcrComplete ──────────────────────────────────────────────────
  queue.subscribe<ScanOcrCompletePayload>(COMMANDS.scanOcrComplete, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Update session status
      await tx
        .update(scanSessions)
        .set({ status: p.status })
        .where(and(eq(scanSessions.id, p.sessionId), eq(scanSessions.tenantId, p.tenantId)));

      // Outbox event
      await enqueue(tx, {
        topic: EVENTS.scanCompleted,
        eventType: EVENTS.scanCompleted,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          sessionId: p.sessionId,
          ocrResultId: p.ocrResultId,
          status: p.status,
        },
      });
    });

    // Post-commit: invalidate caches (best-effort)
    try {
      await Promise.all([
        cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_SCAN_SESSION, p.sessionId)),
        cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_OCR_RESULT, p.sessionId)),
      ]);
    } catch (err) {
      log.warn({ err, sessionId: p.sessionId, event: "cache_invalidate_failed" },
        "cache invalidation failed after OCR complete");
    }
  });
}
