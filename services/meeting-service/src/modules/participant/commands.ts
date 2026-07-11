/**
 * Participant module — command publishing helpers (CQRS write path, Req 5.1–5.7).
 *
 * Routes (task 7.3) call these helpers after zod validation to publish a write intent
 * onto the queue and return `202 Accepted`; the participant consumer (see consumer.ts)
 * performs the actual DB write inside a single transaction. This keeps the HTTP layer
 * free of any Postgres access (steering: "routes never write to Postgres directly").
 *
 * Each helper wraps the validated body in the standard CommandEnvelope and publishes to the
 * matching `COMMANDS.participant*` / `COMMANDS.invitationsSend` topic (contract documented in
 * src/topics.ts). For `participantAdd` the durable participant-row ids are minted here (one per
 * participant) and carried in the payload so a command redelivery is idempotent end-to-end —
 * `markProcessed(tx, messageId)` dedupes the batch and each INSERT reuses the same primary key.
 *
 * The affected meeting's participant read-cache is invalidated best-effort so a subsequent read
 * re-loads from the DB rather than serving a pre-write snapshot (the bounded TTL is the backstop).
 *
 * PII note (Req 15.3): optional `personalEmail` / `personalPhone` overrides ride along in the add
 * payload and are encrypted at rest by the `encryptedText()` column; they are never logged. All
 * downstream notifications address recipients by `employeeId`, never by raw contact value.
 *
 * _Requirements: 5.1, 5.2, 5.5, 5.6, 5.7_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  ParticipantsAddInput,
  ParticipantRespondInput,
  ParticipantNominateInput,
  ParticipantPatch,
} from "./validators.js";

/** Standard queued-write acknowledgement returned to the route (→ HTTP 202). */
export interface ParticipantCommandAccepted {
  /** The primary resource id the client can poll (participant id, or meeting id for meeting-scoped commands). */
  id: string;
  status: "accepted";
  correlationId: string;
}

/** Notification channels an invitation may be delivered over (Req 5.2). */
export type InvitationChannel = "email" | "sms" | "push";

/**
 * Body for `POST /:meetingId/invite` (Req 5.2). Optionally restrict to specific participants
 * and/or channels; the consumer defaults to all not-declined participants across email + SMS +
 * push (with an ICS calendar attachment on the email) when these are omitted.
 */
export interface InvitationsSendInput {
  participantIds?: string[];
  channels?: InvitationChannel[];
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

/** Cache key for a meeting's participant listing (repo task 7.3 reads via this key). */
function participantsKey(tenantId: string, meetingId: string): string {
  return cache.makeKey(tenantId, "participants", meetingId);
}

/** Best-effort invalidation of a meeting's participant read cache after a write is queued. */
async function invalidateParticipants(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(participantsKey(tenantId, meetingId));
}

// ─── Participant add (Req 5.1, 5.7) ───────────────────────────────────────────

/**
 * Add one or many participants to a meeting (Req 5.1). A durable participant id is minted here
 * for each entry (so the caller learns the ids synchronously and redelivery reuses the same
 * primary keys); the consumer validates each role assignment and rejects duplicate active
 * participants before INSERT. Returns the `meetingId` as the primary resource id.
 */
export async function participantAdd(
  ctx: RequestContext,
  meetingId: string,
  body: ParticipantsAddInput,
): Promise<ParticipantCommandAccepted> {
  const participants = body.participants.map((p) => ({ id: randomUUID(), ...p }));
  await queue.publish(COMMANDS.participantAdd, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.participantAdd),
    payload: { meetingId, tenantId: ctx.tenantId, participants },
  });
  await invalidateParticipants(ctx.tenantId, meetingId);
  return { id: meetingId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Participant update (Req 5.1, 5.7) ────────────────────────────────────────

/**
 * Update a participant's editable fields (Req 5.1, 5.7). Optimistic-locked on `version`: the
 * consumer re-validates the resulting role assignment (domain `assertValidRoleAssignment`) and
 * applies the patch via `versionedUpdate` (a stale version surfaces as 409). `participantId` comes
 * from the path. Returns the `participantId` as the primary resource id.
 */
export async function participantUpdate(
  ctx: RequestContext,
  meetingId: string,
  participantId: string,
  version: number,
  patch: ParticipantPatch,
): Promise<ParticipantCommandAccepted> {
  await queue.publish(COMMANDS.participantUpdate, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.participantUpdate),
    payload: { meetingId, participantId, version, patch },
  });
  await invalidateParticipants(ctx.tenantId, meetingId);
  return { id: participantId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Participant remove (Req 5.1) ─────────────────────────────────────────────

/**
 * Remove a participant association from a meeting (Req 5.1). Optimistic-locked on `version`; the
 * consumer deletes the association row (a participant is a meeting↔employee link, not a PII record
 * — there is no soft-delete column) after re-reading the current version. `participantId` comes
 * from the path. Returns the `participantId` as the primary resource id.
 */
export async function participantRemove(
  ctx: RequestContext,
  meetingId: string,
  participantId: string,
  version: number,
  reason?: string,
): Promise<ParticipantCommandAccepted> {
  await queue.publish(COMMANDS.participantRemove, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.participantRemove),
    payload: { meetingId, participantId, version, ...(reason !== undefined ? { reason } : {}) },
  });
  await invalidateParticipants(ctx.tenantId, meetingId);
  return { id: participantId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── RSVP response (Req 5.2, 5.3, 5.4, 5.6) ───────────────────────────────────

/**
 * Record a participant's RSVP (Req 5.2, 5.6). `participantId` comes from the path; the consumer
 * maps the response to an invitation status (domain `resolveRsvp`), notifies the secretary on a
 * decline, and re-checks quorum confirmation against the 48-hour threshold (Req 5.3, 5.4).
 */
export async function participantRespond(
  ctx: RequestContext,
  meetingId: string,
  participantId: string,
  body: ParticipantRespondInput,
): Promise<ParticipantCommandAccepted> {
  await queue.publish(COMMANDS.participantRespond, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.participantRespond),
    payload: { meetingId, participantId, ...body },
  });
  await invalidateParticipants(ctx.tenantId, meetingId);
  return { id: participantId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Proxy / nominee designation (Req 5.5) ────────────────────────────────────

/**
 * Designate a proxy/nominee for a participant (Req 5.5). `participantId` comes from the path; the
 * consumer validates the nominee against the committee's approved nominee list (domain
 * `assertNomineeAllowed`) before recording it.
 */
export async function participantNominate(
  ctx: RequestContext,
  meetingId: string,
  participantId: string,
  body: ParticipantNominateInput,
): Promise<ParticipantCommandAccepted> {
  await queue.publish(COMMANDS.participantNominate, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.participantNominate),
    payload: { meetingId, participantId, ...body },
  });
  await invalidateParticipants(ctx.tenantId, meetingId);
  return { id: participantId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Send invitations (Req 5.2) ───────────────────────────────────────────────

/**
 * Send meeting invitations (Req 5.2). The consumer fans out a `notification.send` per targeted
 * participant per channel (email + SMS + push by default, with an ICS attachment on the email)
 * and emits `meeting.participant.invited`. Returns the `meetingId` as the primary resource id.
 */
export async function invitationsSend(
  ctx: RequestContext,
  meetingId: string,
  body: InvitationsSendInput = {},
): Promise<ParticipantCommandAccepted> {
  await queue.publish(COMMANDS.invitationsSend, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.invitationsSend),
    payload: {
      meetingId,
      ...(body.participantIds !== undefined ? { participantIds: body.participantIds } : {}),
      ...(body.channels !== undefined ? { channels: body.channels } : {}),
    },
  });
  await invalidateParticipants(ctx.tenantId, meetingId);
  return { id: meetingId, status: "accepted", correlationId: ctx.correlationId };
}
