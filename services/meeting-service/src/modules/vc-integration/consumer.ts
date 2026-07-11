/**
 * VC-integration module — SQS / RabbitMQ consumer handlers (CQRS write side, Req 13.2–13.8).
 *
 * Every handler follows the mandatory order (steering: Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — if it returns false the message was already
 *      processed, so we skip (idempotency; P30).
 *   3. Business write (INSERT vc_sessions / UPDATE session or meeting / INSERT attendance).
 *   4. Emit domain EVENTS + an audit fact (+ secretary notifications) via the transactional
 *      outbox (same tx, so "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, invalidate the read-through caches.
 *
 * Handlers:
 *   • vc.create_session   → invoke the tenant's provider fallback chain (Req 13.5), INSERT the
 *                           session under the provider that actually served it, UPDATE
 *                           `meetings.vc_link`, optionally start recording (Req 13.8), emit
 *                           `vc.session_created`. A provider SWITCH notifies the secretary
 *                           (Req 13.5); when EVERY provider is unavailable the session is recorded
 *                           `failed` and a `VC_ALL_PLATFORMS_UNAVAILABLE` compliance alert + a
 *                           secretary notification are emitted (Req 13.5/13.6).
 *   • vc.recording_start  → start provider recording, stamp `started_at` / status = active (Req 13.8).
 *   • vc.recording_stop   → stop provider recording, persist the recording location (Req 13.7/13.8).
 *   • vc.end_session      → end the provider session, fetch + store the recording, finalise the
 *                           session row, emit `vc.session_ended` (Req 13.7/13.8).
 *   • vc.webhook          → a participant joined → INSERT VC-presence attendance
 *                           (method = vc, mode = vc), emit `vc.participant_joined` +
 *                           `attendance.marked` (Req 13.3, 6.7).
 *
 * The provider (external) call in create/end/recording is timeout-bounded (adapter.ts:
 * `fetchWithTimeout`, default 10s) and circuit-breaker protected, so running it inside the
 * idempotency transaction keeps "markProcessed first" strictly intact without an unbounded await.
 *
 * Registration: `registerVcConsumers(register)` maps each VC COMMANDS topic to its handler.
 * worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache, storage } from "../../shared/infra.js";
import { enqueue, markProcessed, type DrizzleTx } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { vcSessions } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { participants } from "../participant/schema.js";
import { attendanceRecords } from "../attendance/schema.js";
import { resolveVcChain } from "./provider.js";
import { VCAllPlatformsUnavailableError, type VCProvider, type VCRecording } from "./adapter.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "vc";
const MEETING_RESOURCE = "meeting";

/** Session lifecycle statuses (mirrors schema.ts JSDoc). `status` is a free-form VARCHAR(16). */
const STATUS_CREATED = "created";
const STATUS_ACTIVE = "active";
const STATUS_ENDED = "ended";
const STATUS_FAILED = "failed";

// ─── Command payload contracts (mirror topics.ts COMMANDS.vc*) ─────────────────

interface SessionCreatePayload {
  vcSessionId: string;
  meetingId: string;
  tenantId: string;
  platform?: VCProvider;
  recordingEnabled?: boolean;
}

interface SessionActionPayload {
  meetingId: string;
  vcSessionId: string;
  tenantId: string;
}

interface WebhookPayload {
  meetingId: string;
  tenantId: string;
  participantId: string;
  event: string;
  vcSessionId?: string;
  joinedAt?: string;
  externalUserId?: string;
  displayName?: string;
}

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Emit a standard audit fact for every mutation (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: MsgMeta,
  action: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: SERVICE,
      action,
      resourceType: "vc_session",
      resourceId,
      outcome: "success",
      ...(metadata ? { metadata } : {}),
    },
  });
}

/** Notify a single recipient via the canonical `notification.send` contract (@civitasone/events). */
async function notify(
  tx: DrizzleTx,
  msg: MsgMeta,
  recipientId: string,
  eventType: string,
  variables: Record<string, string>,
): Promise<void> {
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: buildNotificationPayload({
      eventType,
      recipient: recipientId,
      recipientId,
      channel: "in_app",
      variables,
    }),
  });
}

/** The meeting fields needed to provision + wire a VC session. */
interface MeetingContext {
  id: string;
  title: string;
  status: string;
  secretaryId: string | null;
  chairpersonId: string | null;
  scheduledAt: Date | null;
  durationMinutes: number;
}

async function loadMeeting(tx: DrizzleTx, meetingId: string, tenantId: string): Promise<MeetingContext | null> {
  const rows = await tx
    .select({
      id: meetings.id,
      title: meetings.title,
      status: meetings.status,
      secretaryId: meetings.secretaryId,
      chairpersonId: meetings.chairpersonId,
      scheduledAt: meetings.scheduledAt,
      durationMinutes: meetings.durationMinutes,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load a VC session row within the tx (null when missing / other tenant). */
async function loadSession(tx: DrizzleTx, vcSessionId: string, tenantId: string) {
  const rows = await tx
    .select()
    .from(vcSessions)
    .where(and(eq(vcSessions.id, vcSessionId), eq(vcSessions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Best-effort invalidation of the VC read caches after a write commits. */
async function invalidateVc(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, meetingId));
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, `${meetingId}:participants`));
}

// ─── vc.create_session (Req 13.2, 13.5, 13.6, 13.8) ────────────────────────────

async function handleSessionCreate(msg: CommandEnvelope<SessionCreatePayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) throw new NonRetryableError(`vc create: meeting ${p.meetingId} not found`);

    const chain = resolveVcChain(msg.tenantId, p.platform);

    // Req 13.5: try providers in priority order, falling through open/failing breakers. When every
    // configured provider is unavailable, record the failure and alert — do NOT retry (terminal).
    let result;
    try {
      result = await chain.createSession({
        meetingId: p.meetingId,
        title: meeting.title,
        scheduledAt: meeting.scheduledAt ?? new Date(),
        durationMinutes: meeting.durationMinutes,
        hostEmail: meeting.chairpersonId ?? "",
        participants: [],
      });
    } catch (err) {
      if (err instanceof VCAllPlatformsUnavailableError) {
        await recordAllPlatformsUnavailable(tx, msg, p, meeting, err);
        return;
      }
      throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
    }

    const { provider, session, switchedFrom } = result;

    // Req 13.8: start recording at creation when requested. Bounded provider call.
    let recordingStarted = false;
    if (p.recordingEnabled && session.externalId) {
      const adapter = chain.adapterFor(provider);
      if (adapter) {
        try {
          await adapter.startRecording(session.externalId);
          recordingStarted = true;
        } catch {
          // A recording-start failure must not fail session provisioning; recording can be
          // (re)started explicitly later via vc.recording_start.
          recordingStarted = false;
        }
      }
    }

    const now = new Date();
    await tx.insert(vcSessions).values({
      id: p.vcSessionId,
      tenantId: p.tenantId,
      meetingId: p.meetingId,
      provider,
      externalId: session.externalId,
      joinUrl: session.joinUrl,
      dialInNumber: session.dialInNumber ?? null,
      meetingPin: session.meetingPin ?? null,
      status: recordingStarted ? STATUS_ACTIVE : STATUS_CREATED,
      startedAt: recordingStarted ? now : null,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    // Req 13.2/13.4: publish the join link onto the meeting so invitations/agenda-book carry it.
    await tx
      .update(meetings)
      .set({
        vcLink: session.joinUrl,
        vcEnabled: true,
        updatedBy: msg.actorId,
        updatedAt: now,
        version: sql`${meetings.version} + 1`,
      })
      .where(and(eq(meetings.id, p.meetingId), eq(meetings.tenantId, msg.tenantId)));

    await enqueue(tx, {
      topic: EVENTS.vcSessionCreated,
      eventType: EVENTS.vcSessionCreated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.meetingId, vcSessionId: p.vcSessionId, platform: provider, joinUrl: session.joinUrl },
    });

    // Req 13.5: a fallback switch is logged (audit) + the secretary is notified of the change.
    if (switchedFrom !== null && meeting.secretaryId) {
      await notify(tx, msg, meeting.secretaryId, EVENTS.vcSessionCreated, {
        meetingId: p.meetingId,
        vcSessionId: p.vcSessionId,
        switchedFrom,
        provider,
      });
    }

    await audit(tx, msg, "vc_create_session", p.vcSessionId, {
      meetingId: p.meetingId,
      provider,
      ...(switchedFrom !== null ? { switchedFrom } : {}),
      recordingStarted,
    });
  });

  await invalidateVc(msg.tenantId, p.meetingId);
  await cache.invalidate(cache.makeKey(msg.tenantId, MEETING_RESOURCE, p.meetingId));
}

/**
 * Record a `VC_ALL_PLATFORMS_UNAVAILABLE` outcome (Req 13.5/13.6): persist a `failed` session row
 * capturing the reason, emit a compliance alert, and notify the secretary. Not a retryable error —
 * every configured provider was already exhausted for this attempt.
 */
async function recordAllPlatformsUnavailable(
  tx: DrizzleTx,
  msg: CommandEnvelope<SessionCreatePayload>,
  p: SessionCreatePayload,
  meeting: MeetingContext,
  err: VCAllPlatformsUnavailableError,
): Promise<void> {
  const attemptedProvider: VCProvider = p.platform ?? err.attempts[0]?.provider ?? "webrtc";
  await tx.insert(vcSessions).values({
    id: p.vcSessionId,
    tenantId: p.tenantId,
    meetingId: p.meetingId,
    provider: attemptedProvider,
    status: STATUS_FAILED,
    failureReason: err.code,
    createdBy: msg.actorId,
    updatedBy: msg.actorId,
  });

  await enqueue(tx, {
    topic: EVENTS.complianceAlert,
    eventType: EVENTS.complianceAlert,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      meetingId: p.meetingId,
      alertType: "vc_all_platforms_unavailable",
      detail: { vcSessionId: p.vcSessionId, attempts: err.attempts },
    },
  });

  if (meeting.secretaryId) {
    await notify(tx, msg, meeting.secretaryId, EVENTS.complianceAlert, {
      meetingId: p.meetingId,
      vcSessionId: p.vcSessionId,
      reason: err.code,
    });
  }

  await audit(tx, msg, "vc_create_failed", p.vcSessionId, {
    meetingId: p.meetingId,
    reason: err.code,
    attempts: err.attempts.length,
  });
}

// ─── vc.recording_start (Req 13.8) ─────────────────────────────────────────────

async function handleRecordingStart(msg: CommandEnvelope<SessionActionPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const session = await loadSession(tx, p.vcSessionId, msg.tenantId);
    if (!session || session.meetingId !== p.meetingId) {
      throw new NonRetryableError(`vc recording_start: session ${p.vcSessionId} not found for meeting ${p.meetingId}`);
    }
    if (session.status === STATUS_ENDED || session.status === STATUS_FAILED) return; // terminal — no-op

    if (session.externalId) {
      const adapter = resolveVcChain(msg.tenantId).adapterFor(session.provider as VCProvider);
      if (adapter) {
        try {
          await adapter.startRecording(session.externalId);
        } catch (err) {
          throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
        }
      }
    }

    await tx
      .update(vcSessions)
      .set({
        status: STATUS_ACTIVE,
        startedAt: session.startedAt ?? new Date(),
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: sql`${vcSessions.version} + 1`,
      })
      .where(and(eq(vcSessions.id, p.vcSessionId), eq(vcSessions.tenantId, msg.tenantId)));

    await audit(tx, msg, "vc_recording_start", p.vcSessionId, { meetingId: p.meetingId });
  });

  await invalidateVc(msg.tenantId, p.meetingId);
}

// ─── vc.recording_stop (Req 13.7, 13.8) ─────────────────────────────────────────

async function handleRecordingStop(msg: CommandEnvelope<SessionActionPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const session = await loadSession(tx, p.vcSessionId, msg.tenantId);
    if (!session || session.meetingId !== p.meetingId) {
      throw new NonRetryableError(`vc recording_stop: session ${p.vcSessionId} not found for meeting ${p.meetingId}`);
    }
    if (session.status === STATUS_ENDED || session.status === STATUS_FAILED) return; // terminal — no-op

    let recording: VCRecording | null = null;
    if (session.externalId) {
      const adapter = resolveVcChain(msg.tenantId).adapterFor(session.provider as VCProvider);
      if (adapter) {
        try {
          recording = await adapter.stopRecording(session.externalId);
        } catch (err) {
          throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
        }
      }
    }

    await tx
      .update(vcSessions)
      .set({
        recordingUrl: recording?.recordingUrl ?? session.recordingUrl,
        recordingStorageKey: recording?.storageKey ?? session.recordingStorageKey,
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: sql`${vcSessions.version} + 1`,
      })
      .where(and(eq(vcSessions.id, p.vcSessionId), eq(vcSessions.tenantId, msg.tenantId)));

    await audit(tx, msg, "vc_recording_stop", p.vcSessionId, {
      meetingId: p.meetingId,
      ...(recording?.storageKey ? { recordingStorageKey: recording.storageKey } : {}),
    });
  });

  await invalidateVc(msg.tenantId, p.meetingId);
}

// ─── vc.end_session (Req 13.7, 13.8) ─────────────────────────────────────────────

async function handleSessionEnd(msg: CommandEnvelope<SessionActionPayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const session = await loadSession(tx, p.vcSessionId, msg.tenantId);
    if (!session || session.meetingId !== p.meetingId) {
      throw new NonRetryableError(`vc end_session: session ${p.vcSessionId} not found for meeting ${p.meetingId}`);
    }
    if (session.status === STATUS_ENDED) return; // already ended — idempotent no-op

    // Req 13.8: fetch the recording (if any) and store it in object storage, then end the session.
    let recording: VCRecording | null = null;
    let recordingStorageKey = session.recordingStorageKey;
    let recordingUrl = session.recordingUrl;
    if (session.externalId) {
      const adapter = resolveVcChain(msg.tenantId).adapterFor(session.provider as VCProvider);
      if (adapter) {
        try {
          recording = await adapter.stopRecording(session.externalId);
          await adapter.endSession(session.externalId);
        } catch (err) {
          throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
        }
      }
    }
    if (recording) {
      recordingStorageKey = recording.storageKey;
      recordingUrl = recording.recordingUrl;
      // Persist a small manifest to object storage so the recording location is durably anchored
      // (the media relay from provider→S3 is keyed by recording_storage_key).
      try {
        await storage.putObject(
          recording.storageKey,
          JSON.stringify({
            vcSessionId: p.vcSessionId,
            meetingId: p.meetingId,
            provider: session.provider,
            recordingUrl: recording.recordingUrl,
            durationSeconds: recording.durationSeconds,
            sizeBytes: recording.sizeBytes,
          }),
          "application/json",
        );
      } catch {
        // Storage hiccup must not block ending the session; the URL/key are still persisted below.
      }
    }

    const now = new Date();
    await tx
      .update(vcSessions)
      .set({
        status: STATUS_ENDED,
        endedAt: now,
        recordingUrl,
        recordingStorageKey,
        updatedBy: msg.actorId,
        updatedAt: now,
        version: sql`${vcSessions.version} + 1`,
      })
      .where(and(eq(vcSessions.id, p.vcSessionId), eq(vcSessions.tenantId, msg.tenantId)));

    await enqueue(tx, {
      topic: EVENTS.vcSessionEnded,
      eventType: EVENTS.vcSessionEnded,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        meetingId: p.meetingId,
        vcSessionId: p.vcSessionId,
        ...(recordingStorageKey ? { recordingStorageKey } : {}),
      },
    });
    await audit(tx, msg, "vc_end_session", p.vcSessionId, {
      meetingId: p.meetingId,
      ...(recordingStorageKey ? { recordingStorageKey } : {}),
    });
  });

  await invalidateVc(msg.tenantId, p.meetingId);
}

// ─── vc.webhook — participant joined → VC-presence attendance (Req 13.3, 6.7) ────

async function handleWebhook(msg: CommandEnvelope<WebhookPayload>): Promise<void> {
  const p = msg.payload;
  const joinedAt = p.joinedAt ? new Date(p.joinedAt) : new Date();

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    // The external VC identity must map to an INVITED participant of THIS meeting.
    const rows = await tx
      .select({ id: participants.id, meetingId: participants.meetingId })
      .from(participants)
      .where(and(eq(participants.id, p.participantId), eq(participants.tenantId, msg.tenantId)))
      .limit(1);
    const participant = rows[0];
    if (!participant || participant.meetingId !== p.meetingId) {
      throw new NonRetryableError(`vc webhook: participant ${p.participantId} is not a participant of meeting ${p.meetingId}`);
    }

    // Req 6.7/13.3: record VC presence. method = "vc", mode = "vc", status = attending_via_vc.
    // The (meeting, participant) unique index makes a redelivered / duplicate join a no-op.
    const inserted = await tx
      .insert(attendanceRecords)
      .values({
        id: randomUUID(),
        tenantId: msg.tenantId,
        meetingId: p.meetingId,
        participantId: p.participantId,
        method: "vc",
        checkInAt: joinedAt,
        mode: "vc",
        status: "attending_via_vc",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      })
      .onConflictDoNothing({ target: [attendanceRecords.meetingId, attendanceRecords.participantId] })
      .returning({ id: attendanceRecords.id });

    if (inserted.length === 0) return; // participant already recorded present — nothing to emit

    await enqueue(tx, {
      topic: EVENTS.vcParticipantJoined,
      eventType: EVENTS.vcParticipantJoined,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        meetingId: p.meetingId,
        participantId: p.participantId,
        joinedAt: joinedAt.toISOString(),
        ...(p.vcSessionId ? { vcSessionId: p.vcSessionId } : {}),
      },
    });
    await enqueue(tx, {
      topic: EVENTS.attendanceMarked,
      eventType: EVENTS.attendanceMarked,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.meetingId, participantId: p.participantId, method: "vc", status: "attending_via_vc" },
    });
    await audit(tx, msg, "vc_participant_joined", p.participantId, { meetingId: p.meetingId });
  });

  await invalidateVc(msg.tenantId, p.meetingId);
  await cache.invalidate(cache.makeKey(msg.tenantId, "attendance", p.meetingId));
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every VC command handler. worker.ts (task 19.1) calls this with its `registerConsumer`,
 * wiring the VC COMMANDS topics to the handlers above.
 */
export function registerVcConsumers(register: RegisterConsumer): void {
  register(COMMANDS.vcSessionCreate, handleSessionCreate);
  register(COMMANDS.vcRecordingStart, handleRecordingStart);
  register(COMMANDS.vcRecordingStop, handleRecordingStop);
  register(COMMANDS.vcSessionEnd, handleSessionEnd);
  register(COMMANDS.vcWebhook, handleWebhook);
}
