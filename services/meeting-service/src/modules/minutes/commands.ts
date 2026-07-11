/**
 * Minutes module — command publishing helpers (CQRS write path).
 *
 * Routes (task 9.3) call these helpers after zod validation to publish a write intent
 * onto the queue and return `202 Accepted`; the minutes consumer (see consumer.ts) does
 * the actual DB write inside a single transaction. This keeps the HTTP layer free of any
 * Postgres access (steering: "routes never write to Postgres directly").
 *
 * Each helper wraps the validated body in the standard CommandEnvelope and publishes to the
 * matching `COMMANDS.minutes*` topic (contract documented in src/topics.ts). Read caches for
 * the affected minutes / meeting are invalidated best-effort so a subsequent read re-loads
 * from the DB rather than serving a pre-write snapshot (the bounded TTL is the backstop).
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  MinutesCreateInput,
  MinutesUpdateInput,
  MinutesSubmitInput,
  MinutesApproveInput,
  MinutesRejectInput,
  MinutesSignInput,
  MinutesCirculateInput,
} from "./validators.js";

/** Standard queued-write acknowledgement returned to the route (→ HTTP 202). */
export interface MinutesCommandAccepted {
  /** The primary resource id the client can poll (minutes id). */
  id: string;
  status: "accepted";
  correlationId: string;
}

const SCHEMA_VERSION = "1.0";

/** Cache key for a single minutes record (repo task 9.3 reads via this key). */
function minutesKey(tenantId: string, minutesId: string): string {
  return cache.makeKey(tenantId, "minutes", minutesId);
}

/** Best-effort invalidation of a minutes read cache after a write is queued. */
async function invalidateMinutes(tenantId: string, minutesId: string): Promise<void> {
  await cache.invalidate(minutesKey(tenantId, minutesId));
}

/**
 * Create the minutes draft for a meeting (Req 7.1, 7.2). The minutes id is minted here and
 * reused as the message id so the write is naturally idempotent and the client gets a stable
 * id to poll. The consumer renders the initial draft from meeting metadata + attendance +
 * agenda placeholders and persists it.
 */
export async function minutesCreate(
  ctx: RequestContext,
  meetingId: string,
  body: MinutesCreateInput,
): Promise<MinutesCommandAccepted> {
  const minutesId = randomUUID();
  await queue.publish(COMMANDS.minutesCreate, {
    messageId: minutesId,
    type: COMMANDS.minutesCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      minutesId,
      meetingId,
      tenantId: ctx.tenantId,
      ...(body.templateType ? { templateType: body.templateType } : {}),
    },
  });
  await invalidateMinutes(ctx.tenantId, minutesId);
  return { id: minutesId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Update the minutes draft content (Req 7.1, 7.8). Optimistic-locked on `version`; the
 * consumer snapshots the prior content into `minutes_versions` and bumps `current_version`.
 * Rejected on locked (approved/signed/circulated) minutes at the domain layer.
 */
export async function minutesUpdate(
  ctx: RequestContext,
  minutesId: string,
  body: MinutesUpdateInput,
): Promise<MinutesCommandAccepted> {
  await queue.publish(COMMANDS.minutesUpdate, {
    type: COMMANDS.minutesUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      minutesId,
      tenantId: ctx.tenantId,
      version: body.version,
      content: body.content,
      ...(body.changeNote !== undefined ? { changeNote: body.changeNote } : {}),
    },
  });
  await invalidateMinutes(ctx.tenantId, minutesId);
  return { id: minutesId, status: "accepted", correlationId: ctx.correlationId };
}

/** Submit the draft into the approval workflow (Req 7.3). Optimistic-locked on `version`. */
export async function minutesSubmit(
  ctx: RequestContext,
  minutesId: string,
  body: MinutesSubmitInput,
): Promise<MinutesCommandAccepted> {
  await queue.publish(COMMANDS.minutesSubmit, {
    type: COMMANDS.minutesSubmit,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { minutesId, tenantId: ctx.tenantId, version: body.version },
  });
  await invalidateMinutes(ctx.tenantId, minutesId);
  return { id: minutesId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Approve the minutes (Req 7.5, 8.5). Locks the content, links it into the committee's
 * hash chain, and applies the DSC. `approverId` defaults to the authenticated actor.
 */
export async function minutesApprove(
  ctx: RequestContext,
  minutesId: string,
  body: MinutesApproveInput,
): Promise<MinutesCommandAccepted> {
  await queue.publish(COMMANDS.minutesApprove, {
    type: COMMANDS.minutesApprove,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      minutesId,
      tenantId: ctx.tenantId,
      version: body.version,
      approverId: body.approverId ?? ctx.actorId,
      ...(body.comments !== undefined ? { comments: body.comments } : {}),
    },
  });
  await invalidateMinutes(ctx.tenantId, minutesId);
  return { id: minutesId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Reject the minutes (Req 7.6). Returns the draft to the secretary with the mandatory
 * rejection comments and increments the version. Optimistic-locked on `version`.
 */
export async function minutesReject(
  ctx: RequestContext,
  minutesId: string,
  body: MinutesRejectInput,
): Promise<MinutesCommandAccepted> {
  await queue.publish(COMMANDS.minutesReject, {
    type: COMMANDS.minutesReject,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      minutesId,
      tenantId: ctx.tenantId,
      version: body.version,
      rejectionComments: body.rejectionComments,
    },
  });
  await invalidateMinutes(ctx.tenantId, minutesId);
  return { id: minutesId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Apply the chairperson's DSC to the approved minutes (Req 8.1, 8.2). Produces a PKCS#7
 * detached signature and a verification QR payload. `signerId` defaults to the actor.
 */
export async function minutesSign(
  ctx: RequestContext,
  minutesId: string,
  body: MinutesSignInput,
): Promise<MinutesCommandAccepted> {
  await queue.publish(COMMANDS.minutesSign, {
    type: COMMANDS.minutesSign,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      minutesId,
      tenantId: ctx.tenantId,
      version: body.version,
      signerId: body.signerId ?? ctx.actorId,
    },
  });
  await invalidateMinutes(ctx.tenantId, minutesId);
  return { id: minutesId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Circulate the signed minutes (Req 8.3). An empty/omitted `recipientIds` circulates to the
 * default distribution (all meeting participants), resolved by the consumer.
 */
export async function minutesCirculate(
  ctx: RequestContext,
  minutesId: string,
  body: MinutesCirculateInput,
): Promise<MinutesCommandAccepted> {
  await queue.publish(COMMANDS.minutesCirculate, {
    type: COMMANDS.minutesCirculate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      minutesId,
      tenantId: ctx.tenantId,
      ...(body.recipientIds ? { recipientIds: body.recipientIds } : {}),
    },
  });
  await invalidateMinutes(ctx.tenantId, minutesId);
  return { id: minutesId, status: "accepted", correlationId: ctx.correlationId };
}
