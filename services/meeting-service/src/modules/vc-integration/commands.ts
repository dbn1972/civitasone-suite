/**
 * VC-integration module — command publishing helpers (CQRS write side, Req 13.2, 13.3, 13.7, 13.8).
 *
 * Routes (task 14.2) call these helpers after zod validation to publish a write intent onto the
 * queue and return `202 Accepted` immediately — routes NEVER touch Postgres for writes (steering:
 * "routes never write to Postgres directly"). The matching consumer handlers live in consumer.ts.
 *
 * `vcSessionCreate` mints the `vcSessionId` here (also used as the message id) so the caller learns
 * the session id synchronously (returned in the 202 body + `Location` header) and so a redelivery
 * is idempotent end-to-end — the consumer's `markProcessed(tx, messageId)` dedupes it and the
 * INSERT reuses the same id (mirrors the voting module's resolution-id minting).
 *
 * Envelope contract (see @civitasone/queue `PublishInput`/`CommandEnvelope`): each helper wraps the
 * validated body in the standard envelope and publishes to the matching `COMMANDS.vc*` topic
 * (payload contract documented in src/topics.ts).
 *
 * _Requirements: 13.2, 13.3, 13.7, 13.8_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { VcCreateSessionInput, VcWebhookInput } from "./validators.js";

/** Standard 202-accepted result returned by every command helper. */
export interface VcCommandAccepted {
  /** The primary resource id the client can poll (vc session id). */
  id: string;
  status: "accepted";
  correlationId: string;
}

const SCHEMA_VERSION = "1.0";

/** Common envelope scaffolding shared by every published command. */
function envelopeBase(ctx: RequestContext, messageId: string, type: string) {
  return {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
  } as const;
}

// ─── Create session (Req 13.2, 13.5, 13.8) ───────────────────────────────────────

/**
 * Publish `meeting.vc.create_session` (Req 13.2). Mints the vc-session id (also the message id) so
 * the row the consumer inserts has a stable, caller-known identity. The consumer invokes the
 * tenant's provider fallback chain (Req 13.5), persists the session under the provider that
 * actually served it, updates `meetings.vc_link`, and — when `recordingEnabled` — starts recording
 * (Req 13.8).
 */
export async function vcSessionCreate(
  ctx: RequestContext,
  meetingId: string,
  body: VcCreateSessionInput,
): Promise<VcCommandAccepted> {
  const vcSessionId = randomUUID();
  await queue.publish(COMMANDS.vcSessionCreate, {
    ...envelopeBase(ctx, vcSessionId, COMMANDS.vcSessionCreate),
    payload: {
      vcSessionId,
      meetingId,
      tenantId: ctx.tenantId,
      recordingEnabled: body.recordingEnabled,
      ...(body.platform !== undefined ? { platform: body.platform } : {}),
    },
  });
  return { id: vcSessionId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Recording start / stop (Req 13.7, 13.8) ─────────────────────────────────────

/** Publish `meeting.vc.recording_start` (Req 13.8) for an existing session. */
export async function vcRecordingStart(
  ctx: RequestContext,
  meetingId: string,
  vcSessionId: string,
): Promise<VcCommandAccepted> {
  await queue.publish(COMMANDS.vcRecordingStart, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.vcRecordingStart),
    payload: { meetingId, vcSessionId, tenantId: ctx.tenantId },
  });
  return { id: vcSessionId, status: "accepted", correlationId: ctx.correlationId };
}

/** Publish `meeting.vc.recording_stop` (Req 13.7, 13.8) — the artifact is stored in S3/MinIO. */
export async function vcRecordingStop(
  ctx: RequestContext,
  meetingId: string,
  vcSessionId: string,
): Promise<VcCommandAccepted> {
  await queue.publish(COMMANDS.vcRecordingStop, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.vcRecordingStop),
    payload: { meetingId, vcSessionId, tenantId: ctx.tenantId },
  });
  return { id: vcSessionId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── End session (Req 13.7, 13.8) ─────────────────────────────────────────────────

/**
 * Publish `meeting.vc.end_session` (Req 13.7). The consumer ends the provider session, fetches the
 * recording (if any), stores it in object storage, and finalises the session row (Req 13.8).
 */
export async function vcSessionEnd(
  ctx: RequestContext,
  meetingId: string,
  vcSessionId: string,
): Promise<VcCommandAccepted> {
  await queue.publish(COMMANDS.vcSessionEnd, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.vcSessionEnd),
    payload: { meetingId, vcSessionId, tenantId: ctx.tenantId },
  });
  return { id: vcSessionId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Provider webhook — participant joined (Req 13.3) ─────────────────────────────

/**
 * Publish `meeting.vc.webhook` (Req 13.3). Records that a participant joined the VC session so the
 * consumer can capture VC-presence attendance (Req 6.7). When the provider supplies an `eventId`
 * it is used as the command message id so a redelivered webhook is deduped by `markProcessed`.
 */
export async function vcWebhook(
  ctx: RequestContext,
  meetingId: string,
  body: VcWebhookInput,
): Promise<VcCommandAccepted> {
  const messageId = body.eventId ?? randomUUID();
  await queue.publish(COMMANDS.vcWebhook, {
    ...envelopeBase(ctx, messageId, COMMANDS.vcWebhook),
    payload: {
      meetingId,
      tenantId: ctx.tenantId,
      participantId: body.participantId,
      event: body.event,
      ...(body.vcSessionId !== undefined ? { vcSessionId: body.vcSessionId } : {}),
      ...(body.joinedAt !== undefined ? { joinedAt: body.joinedAt } : {}),
      ...(body.externalUserId !== undefined ? { externalUserId: body.externalUserId } : {}),
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    },
  });
  return { id: body.participantId, status: "accepted", correlationId: ctx.correlationId };
}
