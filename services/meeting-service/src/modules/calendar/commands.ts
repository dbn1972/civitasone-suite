/**
 * Calendar module — command publishing helpers (CQRS write side, Req 14.2, 14.3, 14.8).
 *
 * Routes (routes.ts) call these helpers after zod validation to publish a write intent onto the
 * queue and return `202 Accepted` immediately — routes NEVER write to Postgres directly
 * (steering: "routes never write to Postgres directly"). The matching consumer handlers live in
 * consumer.ts.
 *
 * Id minting (mirrors the sibling document / voting modules): the route mints the room / booking
 * id up front and it doubles as the command `messageId`, so the value is:
 *   - known synchronously (returned in the 202 body + `Location` header),
 *   - idempotent end-to-end — a command redelivery is deduped by `markProcessed(tx, messageId)`
 *     and the INSERT reuses the same primary key.
 *
 * Envelope contract (see @civitasone/queue `PublishInput` / `CommandEnvelope`): each helper wraps
 * the validated body in the standard envelope and publishes to the matching `COMMANDS.room*`
 * topic (payload contract documented in src/topics.ts).
 *
 * _Requirements: 14.2, 14.3, 14.8_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateRoomInput, RoomPatch, BookRoomInput } from "./validators.js";

/** Standard 202-accepted result returned by every command helper. */
export interface CalendarCommandAccepted {
  /** The primary resource id the client can poll (room id / booking id). */
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

// ─── Rooms (Req 14.2) ────────────────────────────────────────────────────────

/**
 * Publish `meeting.room.create` (Req 14.2). Mints the room id (also the message id) so the room
 * the consumer inserts has a stable, caller-known identity and a redelivery is idempotent.
 */
export async function roomCreate(ctx: RequestContext, input: CreateRoomInput): Promise<CalendarCommandAccepted> {
  const roomId = randomUUID();
  await queue.publish(COMMANDS.roomCreate, {
    ...envelopeBase(ctx, roomId, COMMANDS.roomCreate),
    payload: {
      roomId,
      tenantId: ctx.tenantId,
      name: input.name,
      capacity: input.capacity,
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.floor !== undefined ? { floor: input.floor } : {}),
      ...(input.building !== undefined ? { building: input.building } : {}),
      ...(input.equipment !== undefined ? { equipment: input.equipment } : {}),
      ...(input.accessibility !== undefined ? { accessibility: input.accessibility } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  return { id: roomId, status: "accepted", correlationId: ctx.correlationId };
}

/** Publish `meeting.room.update` — optimistic-locked partial update of a room (Req 14.2). */
export async function roomUpdate(
  ctx: RequestContext,
  roomId: string,
  version: number,
  patch: RoomPatch,
): Promise<CalendarCommandAccepted> {
  await queue.publish(COMMANDS.roomUpdate, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.roomUpdate),
    payload: { roomId, tenantId: ctx.tenantId, version, patch },
  });
  return { id: roomId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Room booking (Req 14.3, 14.8) ─────────────────────────────────────────────

/**
 * Publish `meeting.room.book` (Req 14.3). Mints the booking id (also the message id). The route
 * has already run a synchronous conflict pre-check (fast 409); the consumer re-checks against the
 * database `room_bookings_no_overlap` exclusion constraint (the ultimate race guard, P28).
 */
export async function roomBook(ctx: RequestContext, input: BookRoomInput): Promise<CalendarCommandAccepted> {
  const bookingId = randomUUID();
  await queue.publish(COMMANDS.roomBook, {
    ...envelopeBase(ctx, bookingId, COMMANDS.roomBook),
    payload: {
      bookingId,
      tenantId: ctx.tenantId,
      meetingId: input.meetingId,
      roomId: input.roomId,
      startAt: input.startAt,
      endAt: input.endAt,
    },
  });
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `meeting.room.book_cancel` (Req 14.8). Optimistic-locked; the consumer flips the booking
 * to `cancelled` and immediately notifies all meeting participants of the change.
 */
export async function roomBookCancel(
  ctx: RequestContext,
  bookingId: string,
  version: number,
  reason?: string,
): Promise<CalendarCommandAccepted> {
  await queue.publish(COMMANDS.roomBookCancel, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.roomBookCancel),
    payload: { bookingId, tenantId: ctx.tenantId, version, ...(reason !== undefined ? { reason } : {}) },
  });
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}
