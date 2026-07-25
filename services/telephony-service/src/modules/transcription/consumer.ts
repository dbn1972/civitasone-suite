/**
 * transcription consumer — processes recordings for transcription.
 *
 * Subscribes to `telephony.recording.stored` event.
 * Flow:
 *   1. Receives event when a recording is stored successfully
 *   2. Checks if TRANSCRIPTION_ENABLED === 'true'; skips silently if not
 *   3. Creates a pending transcript record
 *   4. Invokes the transcription adapter (within 120s timeout)
 *   5. Persists the transcript text (max 500K chars)
 *   6. Emits audit event
 *
 * Validates: Requirements 15.5, 15.6, 15.7
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { presignedGetUrl } from "@civitasone/storage";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as adapter from "./adapter.js";
import type { TranscriptInsert } from "./schema.js";

const log = pino({ name: "telephony-transcription-consumer" });
const AUDIT_TOPIC = "audit.event.record";

/** Event topic consumed: recording has been stored. */
export const RECORDING_STORED_EVENT = "telephony.recording.stored";

export interface RecordingStoredPayload {
  recordingId: string;
  callId: string;
  storageKey: string;
  tenantId?: string;
}

type TxLike = Parameters<typeof markProcessed>[0];

export function registerTranscriptionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  // Listen for the recording-attached event (same topic used by recording consumer).
  queue.subscribe(EVENTS.callRecordingAttached, async (msg: CommandEnvelope) => {
    const p = msg.payload as RecordingStoredPayload;
    if (!p.recordingId || !p.callId || !p.storageKey) {
      log.warn({ messageId: msg.messageId }, "transcription consumer: invalid payload — skipping");
      return;
    }

    const tenantId = p.tenantId ?? msg.tenantId;

    // Env-gate check: if transcription is disabled, skip silently.
    if (!adapter.isEnabled()) {
      log.debug({ callId: p.callId, recordingId: p.recordingId }, "transcription disabled — skipping");
      return;
    }

    // Idempotency: check if already processed.
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) {
        log.debug({ messageId: msg.messageId }, "transcription: already processed");
        return;
      }

      // Create a pending transcript record.
      const transcriptId = crypto.randomUUID();
      const row: TranscriptInsert = {
        id: transcriptId,
        tenantId,
        callId: p.callId,
        recordingId: p.recordingId,
        text: "",
        status: "pending",
        durationMs: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      };
      await repo.insert(tx as unknown as typeof db, row);
      await repo.markProcessing(tx as unknown as typeof db, transcriptId, tenantId, msg.actorId);
    });

    // Find the just-created transcript to get its ID.
    const transcript = await repo.findByRecordingId(tenantId, p.recordingId);
    if (!transcript) {
      log.error({ recordingId: p.recordingId }, "transcription: failed to find pending transcript");
      return;
    }

    // Perform transcription outside transaction (network I/O, up to 120s).
    try {
      const presignedUrl = await presignedGetUrl({ key: p.storageKey, expiresIn: 3600 });
      const result = await adapter.transcribe(p.storageKey, presignedUrl);

      // Persist the completed transcript.
      await db.transaction(async (tx) => {
        await repo.markCompleted(
          tx as unknown as typeof db,
          transcript.id,
          tenantId,
          result.text,
          result.durationMs,
          msg.actorId,
        );
        await emitAudit(tx, msg, tenantId, transcript.id, "transcription_completed");
      });

      log.info({ transcriptId: transcript.id, callId: p.callId, durationMs: result.durationMs }, "transcription completed");
    } catch (err) {
      log.error(
        { transcriptId: transcript.id, callId: p.callId, err: (err as Error).message },
        "transcription failed",
      );

      // Mark as failed.
      await db.transaction(async (tx) => {
        await repo.markFailed(tx as unknown as typeof db, transcript.id, tenantId, msg.actorId);
        await emitAudit(tx, msg, tenantId, transcript.id, "transcription_failed");
      });

      // Re-throw so queue can retry/DLQ if appropriate.
      throw err;
    }
  });
}

async function emitAudit(
  tx: TxLike,
  msg: CommandEnvelope,
  tenantId: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: "telephony",
      action: "transcription",
      resourceType: "transcript",
      resourceId,
      outcome,
    },
  });
}
