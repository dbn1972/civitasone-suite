/**
 * visitor-service: document-scan command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern).
 * Each function publishes a command envelope to SQS/RabbitMQ; the consumer
 * (./consumer.ts) performs the durable write + outbox event.
 *
 * Requirements validated: 6.3, 6.4, 6.5, 6.7, 6.8, 6.10, 11.4
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

// ── Payload input types ───────────────────────────────────────────────────

export interface ScanProcessInput {
  sessionId: string;
  tenantId: string;
  deviceId: string;
  imageStorageKey: string;
}

export interface ScanOcrCompleteInput {
  sessionId: string;
  ocrResultId: string;
  tenantId: string;
  status: "completed" | "failed";
}

// ── Command publishers ────────────────────────────────────────────────────

/**
 * Publish a scan process command. Triggered after image upload to S3/MinIO.
 * Consumer will: download image → OCR → map fields → blacklist screen → insert result.
 */
export async function publishScanProcess(ctx: RequestContext, input: ScanProcessInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.scanProcess, {
    messageId,
    type: COMMANDS.scanProcess,
    tenantId: input.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      imageStorageKey: input.imageStorageKey,
    },
  });
  return { id: input.sessionId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish a scan OCR complete command. Triggered when OCR processing finishes.
 * Consumer will: update session status + invalidate cache.
 */
export async function publishScanOcrComplete(ctx: RequestContext, input: ScanOcrCompleteInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.scanOcrComplete, {
    messageId,
    type: COMMANDS.scanOcrComplete,
    tenantId: input.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      sessionId: input.sessionId,
      ocrResultId: input.ocrResultId,
      tenantId: input.tenantId,
      status: input.status,
    },
  });
  return { id: input.sessionId, status: "accepted", correlationId: ctx.correlationId };
}
