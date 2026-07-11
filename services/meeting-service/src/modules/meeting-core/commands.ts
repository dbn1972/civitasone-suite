/**
 * meeting-core — command publishing helpers (CQRS write path, Req 1.1–1.7, 14.5).
 *
 * Routes (task 3.6) call these helpers after zod validation to publish a write intent
 * onto the queue and return `202 Accepted`; the meeting-core consumer (see consumer.ts)
 * performs the actual DB write inside a single transaction. This keeps the HTTP layer
 * free of any Postgres access (steering: "routes never write to Postgres directly").
 *
 * Each helper wraps the validated body in the standard CommandEnvelope and publishes to
 * the matching `COMMANDS.meeting*` / `COMMANDS.meetingSeries*` / `COMMANDS.meetingType*`
 * topic (contract documented in src/topics.ts). For create-style commands the durable
 * entity id is minted here and reused as the `messageId`, so a redelivery is idempotent
 * end-to-end (`markProcessed(tx, messageId)` dedupes it and the INSERT reuses the same
 * primary key) and the caller learns the id synchronously for the `Location` header.
 *
 * Read caches for the affected resource are invalidated best-effort so a subsequent read
 * re-loads from the DB rather than serving a pre-write snapshot (the bounded TTL is the
 * backstop).
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 14.5_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateMeetingInput,
  MeetingPatch,
  TransitionMeetingInput,
  CancelMeetingInput,
  CreateMeetingTypeInput,
  UpdateMeetingTypeInput,
  CreateSeriesInput,
  UpdateSeriesInput,
  GenerateSeriesInput,
} from "./validators.js";

/** Standard queued-write acknowledgement returned to the route (→ HTTP 202). */
export interface MeetingCommandAccepted {
  /** The primary resource id the client can poll (meeting / series / meeting-type id). */
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

/** Best-effort invalidation of a single meeting's read cache after a write is queued. */
async function invalidateMeeting(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "meeting", meetingId));
}

// ─── Meeting create / update ────────────────────────────────────────────────────

/**
 * Publish `meeting.create` (Req 1.2). Mints the meeting id (also the messageId) so the
 * caller learns the id synchronously; the consumer INSERTs it in `draft` state, assigns a
 * sequential meeting number, and emits `meeting.created`.
 */
export async function publishMeetingCreate(
  ctx: RequestContext,
  body: CreateMeetingInput,
): Promise<MeetingCommandAccepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.meetingCreate, {
    ...envelopeBase(ctx, id, COMMANDS.meetingCreate),
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `meeting.update` with an optimistic-lock `version` (COMMANDS.meetingUpdate).
 * `patch` carries only the changed editable fields; status changes flow exclusively through
 * `publishMeetingTransition` so the state-machine + audit log stay authoritative.
 */
export async function publishMeetingUpdate(
  ctx: RequestContext,
  meetingId: string,
  version: number,
  patch: MeetingPatch,
): Promise<MeetingCommandAccepted> {
  await queue.publish(COMMANDS.meetingUpdate, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.meetingUpdate),
    payload: { meetingId, version, patch },
  });
  await invalidateMeeting(ctx.tenantId, meetingId);
  return { id: meetingId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Meeting transition / cancel (Req 1.3–1.6) ────────────────────────────────────

/**
 * Publish `meeting.transition` (Req 1.3–1.6). `body` names the target state, an
 * optimistic-lock `version`, an optional `reason` (recorded in the transition audit log,
 * Req 1.7) and an optional `nextMeetingDate` (accompanies an adjournment, Req 1.5). The
 * consumer validates the transition against the (tenant-configurable) state machine.
 */
export async function publishMeetingTransition(
  ctx: RequestContext,
  meetingId: string,
  body: TransitionMeetingInput,
): Promise<MeetingCommandAccepted> {
  await queue.publish(COMMANDS.meetingTransition, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.meetingTransition),
    payload: { meetingId, ...body },
  });
  await invalidateMeeting(ctx.tenantId, meetingId);
  return { id: meetingId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `meeting.cancel` (COMMANDS.meetingCancel) — a soft cancellation moving the meeting
 * into the terminal `cancelled` state. Optimistic-locked; `reason` is required and recorded in
 * the transition audit log (Req 1.7).
 */
export async function publishMeetingCancel(
  ctx: RequestContext,
  meetingId: string,
  body: CancelMeetingInput,
): Promise<MeetingCommandAccepted> {
  await queue.publish(COMMANDS.meetingCancel, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.meetingCancel),
    payload: { meetingId, ...body },
  });
  await invalidateMeeting(ctx.tenantId, meetingId);
  return { id: meetingId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Meeting series (recurring pattern, Req 14.5) ─────────────────────────────────

/**
 * Publish `meeting.series.create` (COMMANDS.meetingSeriesCreate). Mints the series id (also
 * the messageId); the consumer INSERTs the recurring pattern and emits `meeting.series.created`.
 */
export async function publishSeriesCreate(
  ctx: RequestContext,
  body: CreateSeriesInput,
): Promise<MeetingCommandAccepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.meetingSeriesCreate, {
    ...envelopeBase(ctx, id, COMMANDS.meetingSeriesCreate),
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `meeting.series.update` with an optimistic-lock `version` (COMMANDS.meetingSeriesUpdate).
 * `patch` may change the recurrence pattern, window, cadence fields or `isActive`.
 */
export async function publishSeriesUpdate(
  ctx: RequestContext,
  seriesId: string,
  version: number,
  patch: UpdateSeriesInput,
): Promise<MeetingCommandAccepted> {
  await queue.publish(COMMANDS.meetingSeriesUpdate, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.meetingSeriesUpdate),
    payload: { seriesId, version, patch },
  });
  return { id: seriesId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `meeting.series.generate` (COMMANDS.meetingSeriesGenerate, Req 14.5). Materializes
 * concrete `draft` meeting instances from the series pattern up to `upToDate`, carrying the
 * committee membership (chairperson/secretary) forward onto each generated instance.
 */
export async function publishSeriesGenerate(
  ctx: RequestContext,
  seriesId: string,
  body: GenerateSeriesInput,
): Promise<MeetingCommandAccepted> {
  await queue.publish(COMMANDS.meetingSeriesGenerate, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.meetingSeriesGenerate),
    payload: { seriesId, ...body },
  });
  return { id: seriesId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Meeting types (config CRUD) ──────────────────────────────────────────────────

/**
 * Publish `meeting.meeting_type.create` (COMMANDS.meetingTypeCreate). Mints the meeting-type id
 * (also the messageId); the consumer INSERTs the template config and emits
 * `meeting.meeting_type.created`.
 */
export async function publishMeetingTypeCreate(
  ctx: RequestContext,
  body: CreateMeetingTypeInput,
): Promise<MeetingCommandAccepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.meetingTypeCreate, {
    ...envelopeBase(ctx, id, COMMANDS.meetingTypeCreate),
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `meeting.meeting_type.update` with an optimistic-lock `version`
 * (COMMANDS.meetingTypeUpdate). `patch` carries only the changed meeting-type fields.
 */
export async function publishMeetingTypeUpdate(
  ctx: RequestContext,
  meetingTypeId: string,
  version: number,
  patch: UpdateMeetingTypeInput,
): Promise<MeetingCommandAccepted> {
  await queue.publish(COMMANDS.meetingTypeUpdate, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.meetingTypeUpdate),
    payload: { meetingTypeId, version, patch },
  });
  return { id: meetingTypeId, status: "accepted", correlationId: ctx.correlationId };
}
