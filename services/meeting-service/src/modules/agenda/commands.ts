/**
 * Agenda module — command publishing helpers (CQRS write path).
 *
 * Routes (task 5.3) call these helpers after zod validation to publish a write intent
 * onto the queue and return `202 Accepted`; the agenda consumer (see consumer.ts) does
 * the actual DB write inside a single transaction. This keeps the HTTP layer free of any
 * Postgres access (steering: "routes never write to Postgres directly").
 *
 * Each helper wraps the validated body in the standard CommandEnvelope and publishes to the
 * matching `COMMANDS.agenda*` topic (contract documented in src/topics.ts). Read caches for
 * the affected meeting's agenda are invalidated best-effort so a subsequent read re-loads
 * from the DB rather than serving a pre-write snapshot (the bounded TTL is the backstop).
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  AgendaItemSubmitInput,
  AgendaItemUpdateInput,
  AgendaItemWithdrawInput,
  AgendaReorderInput,
  AgendaLockInput,
} from "./validators.js";

/** Standard queued-write acknowledgement returned to the route (→ HTTP 202). */
export interface AgendaCommandAccepted {
  /** The primary resource id the client can poll (agenda item id, or meeting id for meeting-scoped commands). */
  id: string;
  status: "accepted";
  correlationId: string;
}

const SCHEMA_VERSION = "1.0";

/** Cache key for a meeting's agenda listing (repo task 5.3 reads via this key). */
function agendaKey(tenantId: string, meetingId: string): string {
  return cache.makeKey(tenantId, "agenda", meetingId);
}

/** Best-effort invalidation of a meeting's agenda read cache after a write is queued. */
async function invalidateAgenda(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(agendaKey(tenantId, meetingId));
}

/**
 * Submit a new agenda-item proposal (Req 3.1). The item id is minted here and reused as the
 * message id so the write is naturally idempotent and the client gets a stable id to poll.
 */
export async function agendaItemSubmit(
  ctx: RequestContext,
  meetingId: string,
  body: AgendaItemSubmitInput,
): Promise<AgendaCommandAccepted> {
  const agendaItemId = randomUUID();
  await queue.publish(COMMANDS.agendaItemSubmit, {
    messageId: agendaItemId,
    type: COMMANDS.agendaItemSubmit,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { agendaItemId, meetingId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateAgenda(ctx.tenantId, meetingId);
  return { id: agendaItemId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Update an existing agenda item (Req 3.1, 3.2). Optimistic-locked on `version`; a `deferred`
 * status change triggers carry-forward to the next committee meeting inside the consumer.
 */
export async function agendaItemUpdate(
  ctx: RequestContext,
  meetingId: string,
  body: AgendaItemUpdateInput,
): Promise<AgendaCommandAccepted> {
  await queue.publish(COMMANDS.agendaItemUpdate, {
    type: COMMANDS.agendaItemUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { meetingId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateAgenda(ctx.tenantId, meetingId);
  return { id: body.agendaItemId, status: "accepted", correlationId: ctx.correlationId };
}

/** Withdraw an agenda item (Req 3.2). Optimistic-locked; optional reason carried for audit. */
export async function agendaItemWithdraw(
  ctx: RequestContext,
  meetingId: string,
  body: AgendaItemWithdrawInput,
): Promise<AgendaCommandAccepted> {
  await queue.publish(COMMANDS.agendaItemWithdraw, {
    type: COMMANDS.agendaItemWithdraw,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { meetingId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateAgenda(ctx.tenantId, meetingId);
  return { id: body.agendaItemId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Reorder the whole agenda (Req 3.3, 3.4). The payload must be a 1..N bijection over the
 * meeting's items — shape is checked at the route, structural bijection in the consumer.
 */
export async function agendaReorder(
  ctx: RequestContext,
  meetingId: string,
  body: AgendaReorderInput,
): Promise<AgendaCommandAccepted> {
  await queue.publish(COMMANDS.agendaReorder, {
    type: COMMANDS.agendaReorder,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { meetingId, tenantId: ctx.tenantId, order: body.order },
  });
  await invalidateAgenda(ctx.tenantId, meetingId);
  return { id: meetingId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Lock or unlock the agenda (Req 3.4). Locking moves the meeting into `agenda_locked`;
 * unlocking (chairperson-only, enforced at the route) reverts it to `scheduled`.
 * Optimistic-locked on the meeting's `version`.
 */
export async function agendaLock(
  ctx: RequestContext,
  meetingId: string,
  body: AgendaLockInput,
): Promise<AgendaCommandAccepted> {
  await queue.publish(COMMANDS.agendaLock, {
    type: COMMANDS.agendaLock,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { meetingId, tenantId: ctx.tenantId, version: body.version, locked: body.locked },
  });
  await invalidateAgenda(ctx.tenantId, meetingId);
  await cache.invalidate(cache.makeKey(ctx.tenantId, "meeting", meetingId));
  return { id: meetingId, status: "accepted", correlationId: ctx.correlationId };
}
