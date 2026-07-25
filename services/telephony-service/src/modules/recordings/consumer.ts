/**
 * recordings consumer — processes `telephony.recording.attach` commands.
 *
 * Flow:
 *   1. Receives recording-attach command with carrier recording URL
 *   2. Downloads the recording from the carrier URL (max 60s)
 *   3. Uploads to @civitasone/storage under {tenantId}/recordings/{callId}/{recordingId}.{format}
 *   4. Creates/updates recording record with the storageKey
 *   5. Emits audit event
 *
 * Uses exponential backoff for carrier download failures (handled by queue retry).
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { putObject } from "@civitasone/storage";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { RecordingInsert } from "./schema.js";

const log = pino({ name: "telephony-recording-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Command topic for recording attachment. */
export const RECORDING_ATTACH_COMMAND = "telephony.recording.attach";

export interface RecordingAttachPayload {
  id: string;
  tenantId: string;
  callId: string;
  recordingUrl: string;
  durationSec?: number;
  format?: string;
}

type TxLike = Parameters<typeof markProcessed>[0];

/**
 * Download a recording from the carrier URL with timeout.
 * Returns the Buffer content and detected content type.
 */
async function downloadRecording(url: string): Promise<{ content: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Download failed: HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "audio/mpeg";
    return { content: Buffer.from(arrayBuffer), contentType };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Build the S3 storage key for a recording.
 * Pattern: {tenantId}/recordings/{callId}/{recordingId}.{format}
 */
function buildStorageKey(tenantId: string, callId: string, recordingId: string, format: string): string {
  return `${tenantId}/recordings/${callId}/${recordingId}.${format}`;
}

export function registerRecordingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(RECORDING_ATTACH_COMMAND, async (msg: CommandEnvelope) => {
    const p = msg.payload as RecordingAttachPayload;
    if (!p.id || !p.tenantId || !p.callId || !p.recordingUrl) {
      throw new Error("invalid recording.attach payload: missing required fields");
    }

    const format = p.format ?? "mp3";
    const storageKey = buildStorageKey(p.tenantId, p.callId, p.id, format);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Insert the recording record in pending state.
      const row: RecordingInsert = {
        id: p.id,
        tenantId: p.tenantId,
        callId: p.callId,
        recordingUrl: p.recordingUrl,
        storageKey: null,
        durationSec: p.durationSec ?? null,
        format,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      };
      await repo.insert(tx as unknown as typeof db, row);
    });

    // Download and upload outside the transaction (network I/O).
    try {
      const { content, contentType } = await downloadRecording(p.recordingUrl);
      await putObject(storageKey, content, contentType);

      // Mark as stored.
      await db.transaction(async (tx) => {
        await repo.markStored(tx as unknown as typeof db, p.id, p.tenantId, storageKey, msg.actorId);
        await emitEvent(tx, msg, p.id, p.callId, storageKey);
      });

      log.info({ recordingId: p.id, callId: p.callId, storageKey }, "recording stored");
    } catch (err) {
      log.error({ recordingId: p.id, callId: p.callId, err: (err as Error).message }, "recording download/upload failed");
      // Mark as failed — DLQ/retry handled by queue infrastructure.
      await db.transaction(async (tx) => {
        await repo.markFailed(tx as unknown as typeof db, p.id, p.tenantId, msg.actorId);
        await emitAudit(tx, msg, p.id, "recording_attach_failed");
      });
      throw err; // Re-throw so the queue can retry/DLQ.
    }
  });
}

async function emitEvent(
  tx: TxLike,
  msg: CommandEnvelope,
  recordingId: string,
  callId: string,
  storageKey: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: EVENTS.callRecordingAttached,
    eventType: EVENTS.callRecordingAttached,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { recordingId, callId, storageKey },
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "telephony", action: "recording_attach", resourceType: "recording", resourceId: recordingId, outcome: "success" },
  });
}

async function emitAudit(tx: TxLike, msg: CommandEnvelope, resourceId: string, outcome: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "telephony", action: "recording_attach", resourceType: "recording", resourceId, outcome },
  });
}
