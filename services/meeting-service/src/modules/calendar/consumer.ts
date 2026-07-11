/**
 * Calendar module — SQS / RabbitMQ consumer handlers (CQRS write side, Req 14.2, 14.3, 14.8).
 *
 * Every handler follows the mandatory order (steering: Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — if it returns false the message was already
 *      processed, so we skip (idempotency; P30).
 *   3. Business write (INSERT room / booking; optimistic-locked `versionedUpdate` for updates).
 *   4. Emit domain EVENTS + an audit fact (+ participant notifications on cancel) via the
 *      transactional outbox (same tx, so "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, invalidate the read-through caches.
 *
 * Double-booking guard (Req 14.3, P28): `room.book` is defended in TWO layers — an in-transaction
 * application pre-check (`assertNoRoomConflict` over the confirmed bookings overlapping the
 * window) AND the database `room_bookings_no_overlap` btree_gist EXCLUDE constraint, which is the
 * ultimate race guard. A conflict from either layer is a PERMANENT rejection for this message
 * (retrying will not change the persisted bookings), so it is re-thrown as a `NonRetryableError`
 * (→ DLQ) carrying the `ROOM_DOUBLE_BOOKED` reason.
 *
 * Cancel (Req 14.8): flips the booking to `cancelled` (optimistic-locked) and IMMEDIATELY notifies
 * every meeting participant of the change via the canonical `notification.send` contract.
 *
 * Ownership boundary (steering L2): this module owns `meeting.rooms` + `meeting.room_bookings`.
 * The parent `meeting.meetings` (meeting-core) and `meeting.participants` (participant module)
 * tables are READ here as tenant-scoped guards / notification recipients, never written.
 *
 * Registration: `registerCalendarConsumers(register)` maps each calendar COMMANDS topic to its
 * handler. worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 14.2, 14.3, 14.8_
 */
import { and, eq } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { rooms, roomBookings } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { participants } from "../participant/schema.js";
import { assertNoRoomConflict, ROOM_STATUSES, type RoomBookingLike } from "./domain.js";
import { HttpError } from "../../shared/context.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE_ROOM = "room";
const CACHE_RESOURCE_ROOM_AVAIL = "room_availability";
const BOOKING_CONFIRMED = "confirmed";
const BOOKING_CANCELLED = "cancelled";
/** SQLSTATE 23P01 = exclusion_violation — raised by the room_bookings_no_overlap constraint. */
const PG_EXCLUSION_VIOLATION = "23P01";
const ROOM_OVERLAP_CONSTRAINT = "room_bookings_no_overlap";

// ─── Command payload contracts (mirror topics.ts COMMANDS.room*) ────────────────

interface RoomCreatePayload {
  roomId: string;
  tenantId: string;
  name: string;
  capacity: number;
  location?: string;
  floor?: string;
  building?: string;
  equipment?: string[];
  accessibility?: boolean;
  status?: string;
}

interface RoomUpdatePayload {
  roomId: string;
  tenantId: string;
  version: number;
  patch: {
    name?: string;
    capacity?: number;
    location?: string | null;
    floor?: string | null;
    building?: string | null;
    equipment?: string[] | null;
    accessibility?: boolean;
    status?: string;
  };
}

interface RoomBookPayload {
  bookingId: string;
  tenantId: string;
  meetingId: string;
  roomId: string;
  startAt: string;
  endAt: string;
}

interface RoomBookCancelPayload {
  bookingId: string;
  tenantId: string;
  version: number;
  reason?: string;
}

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Emit a standard audit fact for every mutation (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: MsgMeta,
  action: string,
  resourceType: string,
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
      resourceType,
      resourceId,
      outcome: "success",
      ...(metadata ? { metadata } : {}),
    },
  });
}

/** True when `err` is the Postgres exclusion-constraint violation from double-booking a room. */
function isRoomOverlapViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint_name?: string };
  return e.code === PG_EXCLUSION_VIOLATION || e.constraint_name === ROOM_OVERLAP_CONSTRAINT;
}

/** Invalidate the room single + registry caches after a room write. */
async function invalidateRoom(tenantId: string, roomId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE_ROOM, roomId));
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE_ROOM, "list"));
  await cache.invalidateResource(tenantId, CACHE_RESOURCE_ROOM);
}

/** Invalidate a room's availability calendar cache after a booking write. */
async function invalidateRoomAvailability(tenantId: string, roomId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE_ROOM_AVAIL, roomId));
  await cache.invalidateResource(tenantId, CACHE_RESOURCE_ROOM_AVAIL);
}

// ─── room.create (Req 14.2) ────────────────────────────────────────────────────

async function handleRoomCreate(msg: CommandEnvelope<RoomCreatePayload>): Promise<void> {
  const p = msg.payload;
  const status = (ROOM_STATUSES as readonly string[]).includes(p.status ?? "") ? (p.status as string) : "active";

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    await tx.insert(rooms).values({
      id: p.roomId,
      tenantId: p.tenantId,
      name: p.name,
      capacity: p.capacity,
      location: p.location ?? null,
      floor: p.floor ?? null,
      building: p.building ?? null,
      equipment: p.equipment ?? null,
      accessibility: p.accessibility ?? false,
      status,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await enqueue(tx, {
      topic: EVENTS.roomCreated,
      eventType: EVENTS.roomCreated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { roomId: p.roomId, name: p.name, capacity: p.capacity },
    });
    await audit(tx, msg, "room_create", "room", p.roomId, { name: p.name, capacity: p.capacity });
  });

  await invalidateRoom(msg.tenantId, p.roomId);
}

// ─── room.update (Req 14.2) ────────────────────────────────────────────────────

async function handleRoomUpdate(msg: CommandEnvelope<RoomUpdatePayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const existing = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.id, p.roomId), eq(rooms.tenantId, p.tenantId)))
      .limit(1);
    if (!existing[0]) throw new NonRetryableError(`room ${p.roomId} not found`);

    const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
    if (p.patch.name !== undefined) set.name = p.patch.name;
    if (p.patch.capacity !== undefined) set.capacity = p.patch.capacity;
    if (p.patch.location !== undefined) set.location = p.patch.location;
    if (p.patch.floor !== undefined) set.floor = p.patch.floor;
    if (p.patch.building !== undefined) set.building = p.patch.building;
    if (p.patch.equipment !== undefined) set.equipment = p.patch.equipment;
    if (p.patch.accessibility !== undefined) set.accessibility = p.patch.accessibility;
    if (p.patch.status !== undefined && (ROOM_STATUSES as readonly string[]).includes(p.patch.status)) {
      set.status = p.patch.status;
    }

    await versionedUpdate(tx, rooms, {
      id: p.roomId,
      tenantId: p.tenantId,
      expectedVersion: p.version,
      set,
      entity: "room",
    });

    await enqueue(tx, {
      topic: EVENTS.roomUpdated,
      eventType: EVENTS.roomUpdated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { roomId: p.roomId },
    });
    await audit(tx, msg, "room_update", "room", p.roomId);
  });

  await invalidateRoom(msg.tenantId, p.roomId);
}

// ─── room.book (Req 14.3 · P28) ─────────────────────────────────────────────────

async function handleRoomBook(msg: CommandEnvelope<RoomBookPayload>): Promise<void> {
  const p = msg.payload;
  const startAt = new Date(p.startAt);
  const endAt = new Date(p.endAt);

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    // Parent references must exist (permanent failure otherwise → DLQ).
    const meetingRows = await tx
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(eq(meetings.id, p.meetingId), eq(meetings.tenantId, p.tenantId)))
      .limit(1);
    if (!meetingRows[0]) throw new NonRetryableError(`meeting ${p.meetingId} not found`);

    const roomRows = await tx
      .select({ id: rooms.id, status: rooms.status })
      .from(rooms)
      .where(and(eq(rooms.id, p.roomId), eq(rooms.tenantId, p.tenantId)))
      .limit(1);
    const room = roomRows[0];
    if (!room) throw new NonRetryableError(`room ${p.roomId} not found`);
    if (room.status !== "active") {
      throw new NonRetryableError(`room ${p.roomId} is not bookable (status=${room.status})`);
    }

    // Application-layer double-booking pre-check (Req 14.3, P28) — mirrors the DB EXCLUDE guard.
    const overlapping = await tx
      .select({ id: roomBookings.id, roomId: roomBookings.roomId, startAt: roomBookings.startAt, endAt: roomBookings.endAt, status: roomBookings.status })
      .from(roomBookings)
      .where(and(eq(roomBookings.tenantId, p.tenantId), eq(roomBookings.roomId, p.roomId), eq(roomBookings.status, BOOKING_CONFIRMED)));
    const existing: RoomBookingLike[] = overlapping.map((b) => ({ id: b.id, roomId: b.roomId, startAt: b.startAt, endAt: b.endAt, status: b.status }));
    try {
      assertNoRoomConflict(existing, { id: p.bookingId, roomId: p.roomId, startAt, endAt, status: BOOKING_CONFIRMED });
    } catch (err) {
      // A conflict is permanent for this message — do not retry.
      const reason = err instanceof HttpError ? err.message : String(err);
      throw new NonRetryableError(`ROOM_DOUBLE_BOOKED: ${reason}`, err);
    }

    // INSERT — the database EXCLUDE constraint is the ultimate race guard (P28). A concurrent
    // insert that slips past the pre-check surfaces here as 23P01 → permanent rejection.
    try {
      await tx.insert(roomBookings).values({
        id: p.bookingId,
        tenantId: p.tenantId,
        roomId: p.roomId,
        meetingId: p.meetingId,
        startAt,
        endAt,
        status: BOOKING_CONFIRMED,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
    } catch (err) {
      if (isRoomOverlapViolation(err)) {
        throw new NonRetryableError(`ROOM_DOUBLE_BOOKED: room ${p.roomId} overlapping booking`, err);
      }
      throw err;
    }

    await enqueue(tx, {
      topic: EVENTS.roomBooked,
      eventType: EVENTS.roomBooked,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { bookingId: p.bookingId, roomId: p.roomId, meetingId: p.meetingId, startAt: p.startAt, endAt: p.endAt },
    });
    await audit(tx, msg, "room_book", "room_booking", p.bookingId, { roomId: p.roomId, meetingId: p.meetingId });
  });

  await invalidateRoomAvailability(msg.tenantId, p.roomId);
}

// ─── room.book_cancel (Req 14.8) ────────────────────────────────────────────────

async function handleRoomBookCancel(msg: CommandEnvelope<RoomBookCancelPayload>): Promise<void> {
  const p = msg.payload;
  let roomIdForCache: string | null = null;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const bookingRows = await tx
      .select({ id: roomBookings.id, roomId: roomBookings.roomId, meetingId: roomBookings.meetingId, status: roomBookings.status })
      .from(roomBookings)
      .where(and(eq(roomBookings.id, p.bookingId), eq(roomBookings.tenantId, p.tenantId)))
      .limit(1);
    const booking = bookingRows[0];
    if (!booking) throw new NonRetryableError(`booking ${p.bookingId} not found`);
    roomIdForCache = booking.roomId;
    if (booking.status === BOOKING_CANCELLED) return; // idempotent no-op

    await versionedUpdate(tx, roomBookings, {
      id: p.bookingId,
      tenantId: p.tenantId,
      expectedVersion: p.version,
      set: { status: BOOKING_CANCELLED, updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "room_booking",
    });

    // Req 14.8: immediately notify all meeting participants of the cancellation.
    const attendees = await tx
      .select({ employeeId: participants.employeeId })
      .from(participants)
      .where(and(eq(participants.meetingId, booking.meetingId), eq(participants.tenantId, p.tenantId)));
    for (const a of attendees) {
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.roomBookingCancelled,
          recipient: a.employeeId,
          recipientId: a.employeeId,
          channel: "in_app",
          variables: {
            meetingId: booking.meetingId,
            bookingId: p.bookingId,
            ...(p.reason !== undefined ? { reason: p.reason } : {}),
          },
        }),
      });
    }

    await enqueue(tx, {
      topic: EVENTS.roomBookingCancelled,
      eventType: EVENTS.roomBookingCancelled,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        bookingId: p.bookingId,
        roomId: booking.roomId,
        meetingId: booking.meetingId,
        ...(p.reason !== undefined ? { reason: p.reason } : {}),
      },
    });
    await audit(tx, msg, "room_book_cancel", "room_booking", p.bookingId, {
      roomId: booking.roomId,
      meetingId: booking.meetingId,
      ...(p.reason !== undefined ? { reason: p.reason } : {}),
    });
  });

  if (roomIdForCache) await invalidateRoomAvailability(msg.tenantId, roomIdForCache);
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every calendar command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`. Exposes room CRUD + room booking/cancel.
 */
export function registerCalendarConsumers(register: RegisterConsumer): void {
  register(COMMANDS.roomCreate, handleRoomCreate);
  register(COMMANDS.roomUpdate, handleRoomUpdate);
  register(COMMANDS.roomBook, handleRoomBook);
  register(COMMANDS.roomBookCancel, handleRoomBookCancel);
}
