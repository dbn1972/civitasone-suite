/**
 * AI-assist module — SQS / RabbitMQ consumer handlers (CQRS write side).
 *
 * Handles the three asynchronous AI commands. Every handler follows the mandated order:
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — idempotency guard (skip if already processed).
 *   3. Fetch inputs (recording / transcript / context), invoke the circuit-breaker-wrapped AI
 *      provider, apply the confidence gate + human-approval invariant (domain.ts), persist.
 *   4. Emit domain EVENTS + an audit event into the transactional outbox (same tx).
 *   5. AFTER commit, invalidate the read-through cache.
 *
 * The two safety invariants are enforced here and cannot be bypassed:
 *   - Confidence gate: a transcript is stored as authoritative ONLY when confidence ≥ 0.70;
 *     below that the flow degrades to the manual workflow (`AI_LOW_CONFIDENCE`) and notifies the
 *     secretary — the low-confidence transcript is not persisted.
 *   - Human-approval ("AI never auto-publishes", P37): AI minutes are ALWAYS written as an
 *     editable `draft` marked `ai_generated = true` (never approved/signed/circulated), and
 *     extracted actions are stored as `pending_confirmation` candidates, never live action items.
 *
 * Graceful degradation (design "Graceful degradation"): when the AI provider is unavailable
 * (breaker open / provider error → {@link AIUnavailableError}) the handler does NOT throw — it
 * notifies the secretary + records a compliance alert + audits, then acks, so a vendor outage
 * degrades to the manual workflow instead of dead-lettering the message.
 *
 * Registration: `registerAiAssistConsumers(register)` maps each AI COMMANDS topic to its handler;
 * worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 7.2 (AI template), 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache, storage } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { meetings, type MeetingRow } from "../meeting-core/schema.js";
import { committees } from "../committee/schema.js";
import { participants } from "../participant/schema.js";
import { attendanceRecords } from "../attendance/schema.js";
import { agendaItems } from "../agenda/schema.js";
import { minutes, minutesVersions } from "../minutes/schema.js";
import { computeMinutesSubmissionDeadline } from "../minutes/domain.js";
import {
  meetingDocuments,
  AI_DOC_TYPE_TRANSCRIPT,
  AI_DOC_TYPE_ACTION_SUGGESTIONS,
} from "./schema.js";
import {
  createAIAdapter,
  AIUnavailableError,
  type AIProvider,
  type MinutesGenerationContext,
} from "./adapter.js";
import {
  meetsConfidenceThreshold,
  normalizeConfidence,
  buildAiMinutesDraft,
  assertAiMinutesNeverAutoApproved,
  buildActionCandidateArtifact,
  computeHash,
  transcriptStorageKey,
  actionCandidatesStorageKey,
  AI_LOW_CONFIDENCE,
  AI_UNAVAILABLE,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE_TRANSCRIPT = "ai_transcript";

// ─── Command payload contracts (mirror topics.ts COMMANDS.ai*) ───────────────

interface AiTranscribePayload {
  meetingId: string;
  tenantId: string;
  recordingRef: string;
  language?: string;
}
interface AiDraftMinutesPayload {
  meetingId: string;
  tenantId: string;
  transcriptRef?: string;
  templateType?: string;
}
interface AiExtractActionsPayload {
  meetingId: string;
  tenantId: string;
  transcriptRef?: string;
}

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Emit an audit fact for every mutation / degradation event (steering: audit on every action). */
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
      resourceType: "ai_assist",
      resourceId,
      outcome: "success",
      ...(metadata ? { metadata } : {}),
    },
  });
}

/** Load the parent meeting within the tx (tenant-scoped). */
async function loadMeeting(tx: DrizzleTx, meetingId: string, tenantId: string): Promise<MeetingRow | null> {
  const rows = await tx
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Notify the meeting secretary (falling back to the acting user) in-app via notification-service.
 * Used for AI-draft-ready notices and for the manual-fallback / AI-unavailable degradations.
 */
async function notifySecretary(
  tx: DrizzleTx,
  msg: MsgMeta,
  meeting: MeetingRow,
  eventType: string,
  variables: Record<string, unknown>,
): Promise<void> {
  const recipientId = meeting.secretaryId ?? msg.actorId;
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
      variables: { meetingId: meeting.id, ...variables },
    }),
  });
}

/** Record a compliance alert (design: low-confidence / AI-unavailable degradations are auditable). */
async function complianceAlert(
  tx: DrizzleTx,
  msg: MsgMeta,
  meetingId: string,
  alertType: string,
  detail: string,
): Promise<void> {
  await enqueue(tx, {
    topic: EVENTS.complianceAlert,
    eventType: EVENTS.complianceAlert,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { meetingId, alertType, detail },
  });
}

/** Best-effort transcript read-cache invalidation after a transcript is stored. */
async function invalidateTranscript(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE_TRANSCRIPT, meetingId));
}

/**
 * Load the transcript text for a meeting from object storage. Uses the explicit `transcriptRef`
 * (a `meeting_documents.id`) when supplied, otherwise the latest stored transcript for the
 * meeting. Returns null when no transcript exists or its bytes cannot be fetched.
 */
async function loadTranscriptText(
  tx: DrizzleTx,
  tenantId: string,
  meetingId: string,
  transcriptRef?: string,
): Promise<string | null> {
  const conds = [
    eq(meetingDocuments.tenantId, tenantId),
    eq(meetingDocuments.meetingId, meetingId),
    eq(meetingDocuments.documentType, AI_DOC_TYPE_TRANSCRIPT),
  ];
  if (transcriptRef) conds.push(eq(meetingDocuments.id, transcriptRef));

  const rows = await tx
    .select({ storageKey: meetingDocuments.storageKey })
    .from(meetingDocuments)
    .where(and(...conds))
    .orderBy(desc(meetingDocuments.createdAt))
    .limit(1);
  const key = rows[0]?.storageKey;
  if (!key) return null;
  try {
    const buf = await storage.getObject(key);
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

/** Gather the meeting context the AI needs to draft minutes (committee, agenda, attendance). */
async function collectMinutesContext(
  tx: DrizzleTx,
  tenantId: string,
  meeting: MeetingRow,
): Promise<MinutesGenerationContext> {
  let committeeName: string | null = null;
  if (meeting.committeeId) {
    const c = await tx
      .select({ name: committees.name })
      .from(committees)
      .where(and(eq(committees.id, meeting.committeeId), eq(committees.tenantId, tenantId)))
      .limit(1);
    committeeName = c[0]?.name ?? null;
  }

  const agendaRows = await tx
    .select({ title: agendaItems.title, sequence: agendaItems.sequence })
    .from(agendaItems)
    .where(
      and(eq(agendaItems.meetingId, meeting.id), eq(agendaItems.tenantId, tenantId), ne(agendaItems.status, "withdrawn")),
    )
    .orderBy(agendaItems.sequence);
  const agendaTitles = agendaRows.map((a) => a.title);

  // Prefer verified attendance; fall back to the invited roster.
  const attRows = await tx
    .select({ employeeId: participants.employeeId })
    .from(attendanceRecords)
    .innerJoin(
      participants,
      and(eq(participants.id, attendanceRecords.participantId), eq(participants.tenantId, attendanceRecords.tenantId)),
    )
    .where(and(eq(attendanceRecords.meetingId, meeting.id), eq(attendanceRecords.tenantId, tenantId)));
  let attendeeNames = attRows.map((r) => r.employeeId);
  if (attendeeNames.length === 0) {
    const roster = await tx
      .select({ employeeId: participants.employeeId })
      .from(participants)
      .where(and(eq(participants.meetingId, meeting.id), eq(participants.tenantId, tenantId)));
    attendeeNames = roster.map((r) => r.employeeId);
  }

  return { meetingTitle: meeting.title, committeeName, agendaTitles, attendeeNames };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * ai.transcribe → fetch recording from S3 → transcribe → confidence gate (Req 17.x).
 * confidence ≥ 0.70 → store transcript + emit `ai.transcript_ready`; below → manual fallback
 * (notify secretary, `AI_LOW_CONFIDENCE`, no transcript stored). AI unavailable → degrade + notify.
 */
async function handleAiTranscribe(msg: CommandEnvelope<AiTranscribePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await loadMeeting(tx, p.meetingId, p.tenantId);
    if (!meeting) return;

    // Fetch the recording bytes from object storage.
    let audio: Buffer;
    try {
      audio = await storage.getObject(p.recordingRef);
    } catch {
      await notifySecretary(tx, msg, meeting, EVENTS.complianceAlert, { reason: "recording_unavailable" });
      await complianceAlert(tx, msg, meeting.id, "ai_recording_unavailable", `recording ${p.recordingRef} could not be fetched`);
      await audit(tx, msg, "transcribe_failed", meeting.id, { reason: "recording_unavailable" });
      return;
    }

    const ai: AIProvider = createAIAdapter(p.tenantId);
    let result: Awaited<ReturnType<AIProvider["transcribe"]>>;
    try {
      result = await ai.transcribe({ audio, ...(p.language ? { language: p.language } : {}) });
    } catch (err) {
      if (!(err instanceof AIUnavailableError)) throw err;
      // Graceful degradation — do NOT dead-letter; degrade to the manual workflow.
      await notifySecretary(tx, msg, meeting, EVENTS.complianceAlert, { reason: AI_UNAVAILABLE });
      await complianceAlert(tx, msg, meeting.id, "ai_unavailable", `transcription unavailable via ${ai.name}`);
      await audit(tx, msg, "transcribe_degraded", meeting.id, { reason: AI_UNAVAILABLE, provider: ai.name });
      return;
    }

    const confidence = normalizeConfidence(result.confidence);
    if (!meetsConfidenceThreshold(confidence)) {
      // Confidence gate closed → manual fallback; the transcript is NOT stored.
      await notifySecretary(tx, msg, meeting, EVENTS.complianceAlert, { reason: AI_LOW_CONFIDENCE, confidence });
      await complianceAlert(tx, msg, meeting.id, "ai_low_confidence", `transcription confidence ${confidence} < 0.70`);
      await audit(tx, msg, "transcribe_low_confidence", meeting.id, { confidence });
      return;
    }

    // Confidence gate open → store the transcript as authoritative.
    const storageKey = transcriptStorageKey(p.tenantId, meeting.id);
    await storage.putObject(storageKey, result.transcript, "text/plain");
    const hash = computeHash(result.transcript);
    const documentId = randomUUID();
    await tx.insert(meetingDocuments).values({
      id: documentId,
      tenantId: p.tenantId,
      meetingId: meeting.id,
      fileName: `transcript-${meeting.id}.txt`,
      mimeType: "text/plain",
      fileSizeBytes: Buffer.byteLength(result.transcript, "utf8"),
      storageKey,
      hash,
      classification: meeting.confidentialityLevel ?? "internal",
      documentType: AI_DOC_TYPE_TRANSCRIPT,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await enqueue(tx, {
      topic: EVENTS.aiTranscriptReady,
      eventType: EVENTS.aiTranscriptReady,
      tenantId: p.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: meeting.id, transcriptRef: documentId, confidence },
    });
    await notifySecretary(tx, msg, meeting, EVENTS.aiTranscriptReady, { transcriptRef: documentId, confidence });
    await audit(tx, msg, "transcribe", meeting.id, { transcriptRef: documentId, confidence, provider: ai.name });
  });
  await invalidateTranscript(p.tenantId, p.meetingId);
}

/**
 * ai.draft_minutes → load transcript + agenda + attendance → generate → write an AI minutes
 * DRAFT (Req 7.2, 17.x). The minutes are ALWAYS `status = draft`, `ai_generated = true` and are
 * NEVER auto-approved (P37). An existing approved/signed/circulated minutes is never overwritten.
 */
async function handleAiDraftMinutes(msg: CommandEnvelope<AiDraftMinutesPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await loadMeeting(tx, p.meetingId, p.tenantId);
    if (!meeting) return;

    const transcript = await loadTranscriptText(tx, p.tenantId, meeting.id, p.transcriptRef);
    if (!transcript) {
      await notifySecretary(tx, msg, meeting, EVENTS.complianceAlert, { reason: "transcript_missing" });
      await audit(tx, msg, "draft_minutes_skipped", meeting.id, { reason: "transcript_missing" });
      return;
    }

    const ai: AIProvider = createAIAdapter(p.tenantId);
    const context = await collectMinutesContext(tx, p.tenantId, meeting);
    const draftTemplate = buildAiMinutesDraft("", p.templateType).templateType;

    let gen: Awaited<ReturnType<AIProvider["generateMinutes"]>>;
    try {
      gen = await ai.generateMinutes({ transcript, template: draftTemplate, context });
    } catch (err) {
      if (!(err instanceof AIUnavailableError)) throw err;
      await notifySecretary(tx, msg, meeting, EVENTS.complianceAlert, { reason: AI_UNAVAILABLE });
      await complianceAlert(tx, msg, meeting.id, "ai_unavailable", `minutes drafting unavailable via ${ai.name}`);
      await audit(tx, msg, "draft_minutes_degraded", meeting.id, { reason: AI_UNAVAILABLE, provider: ai.name });
      return;
    }

    const confidence = normalizeConfidence(gen.confidence);
    // Human-approval invariant: the persisted shape is pinned to draft + ai_generated.
    const draft = buildAiMinutesDraft(gen.content, p.templateType);

    const existingRows = await tx
      .select()
      .from(minutes)
      .where(and(eq(minutes.meetingId, meeting.id), eq(minutes.tenantId, p.tenantId)))
      .limit(1);
    const existing = existingRows[0];

    let minutesId: string;
    let version: number;

    if (!existing) {
      minutesId = randomUUID();
      version = 1;
      const meetingDate = meeting.actualEndAt ?? meeting.scheduledAt ?? new Date();
      await tx.insert(minutes).values({
        id: minutesId,
        tenantId: p.tenantId,
        meetingId: meeting.id,
        templateType: draft.templateType,
        content: draft.content,
        status: draft.status,
        currentVersion: 1,
        aiGenerated: draft.aiGenerated,
        submissionDeadline: computeMinutesSubmissionDeadline(meetingDate),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
    } else {
      // Never overwrite human-authorised minutes (P37). Degrade + notify instead of DLQ.
      try {
        assertAiMinutesNeverAutoApproved(existing.status);
      } catch {
        await notifySecretary(tx, msg, meeting, EVENTS.complianceAlert, { reason: "minutes_locked", minutesId: existing.id });
        await audit(tx, msg, "draft_minutes_skipped", existing.id, { reason: "minutes_locked", status: existing.status });
        return;
      }
      minutesId = existing.id;
      version = existing.currentVersion + 1;
      // Snapshot the prior content as an immutable version, then replace with the AI draft.
      await tx.insert(minutesVersions).values({
        tenantId: p.tenantId,
        minutesId: existing.id,
        versionNum: existing.currentVersion,
        content: existing.content,
        changedBy: msg.actorId,
        changeNote: "superseded by AI-generated draft",
      });
      await versionedUpdate(tx, minutes, {
        id: existing.id,
        tenantId: p.tenantId,
        expectedVersion: existing.version,
        set: {
          templateType: draft.templateType,
          content: draft.content,
          status: draft.status,
          aiGenerated: draft.aiGenerated,
          currentVersion: version,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "minutes",
      });
    }

    await enqueue(tx, {
      topic: EVENTS.aiMinutesDraftReady,
      eventType: EVENTS.aiMinutesDraftReady,
      tenantId: p.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: meeting.id, minutesId, version, confidence },
    });
    await notifySecretary(tx, msg, meeting, EVENTS.aiMinutesDraftReady, { minutesId, version, confidence });
    await audit(tx, msg, "draft_minutes", minutesId, { version, confidence, aiGenerated: true, provider: ai.name });
  });
  await cache.invalidate(cache.makeKey(p.tenantId, "minutes", p.meetingId));
}

/**
 * ai.extract_actions → parse transcript → store CANDIDATE actions pending human confirmation
 * (Req 17.x, P37). Candidates are stored as a `pending_confirmation` artifact (object storage +
 * a `meeting_documents` row) and the secretary is notified — they are NEVER inserted as live
 * action items. AI unavailable → degrade + notify.
 */
async function handleAiExtractActions(msg: CommandEnvelope<AiExtractActionsPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await loadMeeting(tx, p.meetingId, p.tenantId);
    if (!meeting) return;

    const transcript = await loadTranscriptText(tx, p.tenantId, meeting.id, p.transcriptRef);
    if (!transcript) {
      await notifySecretary(tx, msg, meeting, EVENTS.complianceAlert, { reason: "transcript_missing" });
      await audit(tx, msg, "extract_actions_skipped", meeting.id, { reason: "transcript_missing" });
      return;
    }

    const context = await collectMinutesContext(tx, p.tenantId, meeting);
    const ai: AIProvider = createAIAdapter(p.tenantId);
    let candidates: Awaited<ReturnType<AIProvider["extractActions"]>>;
    try {
      candidates = await ai.extractActions({ transcript, attendeeNames: context.attendeeNames });
    } catch (err) {
      if (!(err instanceof AIUnavailableError)) throw err;
      await notifySecretary(tx, msg, meeting, EVENTS.complianceAlert, { reason: AI_UNAVAILABLE });
      await complianceAlert(tx, msg, meeting.id, "ai_unavailable", `action extraction unavailable via ${ai.name}`);
      await audit(tx, msg, "extract_actions_degraded", meeting.id, { reason: AI_UNAVAILABLE, provider: ai.name });
      return;
    }

    const artifact = buildActionCandidateArtifact(meeting.id, candidates);
    const json = JSON.stringify(artifact, null, 2);
    const storageKey = actionCandidatesStorageKey(p.tenantId, meeting.id);
    await storage.putObject(storageKey, json, "application/json");
    await tx.insert(meetingDocuments).values({
      id: randomUUID(),
      tenantId: p.tenantId,
      meetingId: meeting.id,
      fileName: `ai-action-candidates-${meeting.id}.json`,
      mimeType: "application/json",
      fileSizeBytes: Buffer.byteLength(json, "utf8"),
      storageKey,
      hash: computeHash(json),
      classification: meeting.confidentialityLevel ?? "internal",
      documentType: AI_DOC_TYPE_ACTION_SUGGESTIONS,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await notifySecretary(tx, msg, meeting, EVENTS.complianceAlert, {
      reason: "ai_actions_suggested",
      count: artifact.candidates.length,
    });
    await audit(tx, msg, "extract_actions", meeting.id, {
      candidateCount: artifact.candidates.length,
      pendingConfirmation: true,
      provider: ai.name,
    });
  });
}

// ─── Registration ────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every AI-assist command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`, wiring the AI COMMANDS topics to the handlers above.
 */
export function registerAiAssistConsumers(register: RegisterConsumer): void {
  register(COMMANDS.aiTranscribe, handleAiTranscribe);
  register(COMMANDS.aiDraftMinutes, handleAiDraftMinutes);
  register(COMMANDS.aiExtractActions, handleAiExtractActions);
}
