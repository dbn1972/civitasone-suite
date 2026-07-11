/**
 * AI-assist module — command publishing helpers (CQRS write path).
 *
 * The three asynchronous AI operations (transcribe, draft-minutes, extract-actions) are heavy
 * and provider-dependent, so routes publish a command and return `202 Accepted`; the AI-assist
 * consumer (consumer.ts) fetches the recording / loads context, invokes the circuit-breaker-
 * wrapped provider, applies the confidence gate + human-approval invariant, and persists the
 * result. This keeps the HTTP layer free of any provider I/O or Postgres writes.
 *
 * (The synchronous `suggest-agenda` and `knowledge-base search` endpoints do not queue — they
 * read/generate and respond directly — so they have no command helper here.)
 *
 * Each helper wraps the validated body in the standard CommandEnvelope and publishes to the
 * matching `COMMANDS.ai*` topic (contract documented in src/topics.ts).
 *
 * _Requirements: 7.2, 17.1, 17.3, 17.4_
 */
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { AiTranscribeInput, AiDraftMinutesInput, AiExtractActionsInput } from "./validators.js";

/** Standard queued-write acknowledgement returned to the route (→ HTTP 202). */
export interface AiCommandAccepted {
  /** The meeting the AI job targets (the client polls the meeting's transcript/minutes). */
  meetingId: string;
  status: "accepted";
  correlationId: string;
}

const SCHEMA_VERSION = "1.0";

/**
 * Trigger asynchronous transcription of a meeting recording (Req 17.x). The consumer fetches the
 * recording from S3, invokes the provider, and — only if confidence ≥ 0.70 — stores the
 * transcript; otherwise it degrades to the manual workflow and notifies the secretary.
 */
export async function aiTranscribe(
  ctx: RequestContext,
  meetingId: string,
  body: AiTranscribeInput,
): Promise<AiCommandAccepted> {
  await queue.publish(COMMANDS.aiTranscribe, {
    type: COMMANDS.aiTranscribe,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      meetingId,
      tenantId: ctx.tenantId,
      recordingRef: body.recordingRef,
      ...(body.language ? { language: body.language } : {}),
    },
  });
  return { meetingId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Generate an AI minutes draft (Req 7.2, 17.x). The consumer loads the transcript + agenda +
 * attendance and writes a minutes record marked `ai_generated = true`, ALWAYS in `draft` status —
 * it is never auto-approved (human-approval invariant, P37).
 */
export async function aiDraftMinutes(
  ctx: RequestContext,
  meetingId: string,
  body: AiDraftMinutesInput,
): Promise<AiCommandAccepted> {
  await queue.publish(COMMANDS.aiDraftMinutes, {
    type: COMMANDS.aiDraftMinutes,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      meetingId,
      tenantId: ctx.tenantId,
      ...(body.transcriptRef ? { transcriptRef: body.transcriptRef } : {}),
      ...(body.templateType ? { templateType: body.templateType } : {}),
    },
  });
  return { meetingId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Extract candidate action items from a transcript (Req 17.x). The consumer stores the candidates
 * as a "pending confirmation" artifact and notifies the secretary — candidates are NEVER inserted
 * as live action items (human-approval invariant, P37).
 */
export async function aiExtractActions(
  ctx: RequestContext,
  meetingId: string,
  body: AiExtractActionsInput,
): Promise<AiCommandAccepted> {
  await queue.publish(COMMANDS.aiExtractActions, {
    type: COMMANDS.aiExtractActions,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      meetingId,
      tenantId: ctx.tenantId,
      ...(body.transcriptRef ? { transcriptRef: body.transcriptRef } : {}),
    },
  });
  return { meetingId, status: "accepted", correlationId: ctx.correlationId };
}
