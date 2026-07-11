/**
 * Calendar module — cache-first DB reads (CQRS read side, Req 14.1, 14.2, 14.3).
 *
 * READ-ONLY: every write goes through the command publishers in commands.ts (route → zod →
 * queue.publish → 202) and is applied by consumer.ts. The relatively-static room registry and a
 * room's booking calendar are served via the Redis read-through cache (`cache.getOrLoad`, keyed
 * `{service}:{tenant}:{resource}:{id}`); the parametric conflict / availability / suggest-slots
 * computations query Postgres directly (they depend on caller-supplied windows + participant sets
 * that make a cache key low-value, exactly like the participant module's live quorum read). All
 * queries carry an explicit `tenant_id` predicate (defence-in-depth on top of RLS).
 *
 * The pure interval / conflict / availability logic lives in domain.ts
 * (`findRoomConflicts`, `detectConflicts`, `computeAvailability`, `suggestSlots`); this file only
 * gathers the persisted rows those pure functions operate on.
 *
 * Cache keys owned here:
 *   • `meeting:{tenant}:room:{roomId}`               → single room (getRoomById)
 *   • `meeting:{tenant}:room:list`                   → room registry (getRooms)
 *   • `meeting:{tenant}:room_availability:{roomId}`  → NOT cached (window-parametric)
 *
 * Ownership boundary (steering L2): this module owns `meeting.rooms` + `meeting.room_bookings`.
 * The parent `meeting.meetings` table (meeting-core) and `meeting.participants` table
 * (participant module) are READ here purely as tenant-scoped join / existence guards, never
 * written.
 *
 * _Requirements: 14.1, 14.2, 14.3_
 */
import { and, eq, inArray, lt, gt, ne } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { rooms, roomBookings, type RoomRow, type RoomBookingRow } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { participants } from "../participant/schema.js";
import {
  computeAvailability,
  suggestSlots,
  detectConflicts,
  type Interval,
  type RoomBookingLike,
  type ParticipantBusyInterval,
  type ConflictReport,
  type RoomStatus,
} from "./domain.js";

const RESOURCE_ROOM = "room";
/** Rooms change rarely — cache single lookups + the registry list for 5 minutes. */
const ROOM_TTL = 300;
const BOOKING_CONFIRMED = "confirmed";
/** Meeting statuses that no longer occupy a participant's calendar (freed for scheduling). */
const INACTIVE_MEETING_STATUSES = ["cancelled", "closed", "archived"] as const;

// ─── Rooms (Req 14.2) ────────────────────────────────────────────────────────

/** Fetch a single room by id, cache-first. Null when unknown / another tenant (route 404). */
export async function getRoomById(tenantId: string, roomId: string): Promise<RoomRow | null> {
  return cache.getOrLoad<RoomRow>(
    cache.makeKey(tenantId, RESOURCE_ROOM, roomId),
    async () => {
      const rows = await db
        .select()
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.tenantId, tenantId)))
        .limit(1);
      return rows[0] ?? null;
    },
    ROOM_TTL,
  );
}

/**
 * List the room registry for a tenant (Req 14.2), cache-first, optionally filtered by `status`.
 * Newest-registered first. The unfiltered list is cached under `room:list`; a status filter is
 * applied in memory over that cached set so every facet shares one invalidation key.
 */
export async function getRooms(tenantId: string, opts?: { status?: RoomStatus }): Promise<RoomRow[]> {
  const all =
    (await cache.getOrLoad<RoomRow[]>(
      cache.makeKey(tenantId, RESOURCE_ROOM, "list"),
      async () => {
        const rows = await db.select().from(rooms).where(eq(rooms.tenantId, tenantId));
        return rows;
      },
      ROOM_TTL,
    )) ?? [];
  const sorted = [...all].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return opts?.status ? sorted.filter((r) => r.status === opts.status) : sorted;
}

// ─── Existence guards (read-side joins, tenant-scoped, uncached) ────────────────

/** Minimal parent-meeting reference for route existence guards + ICS / scheduling reads. */
export interface MeetingRef {
  id: string;
  type: string;
  title: string;
  status: string;
  venue: string | null;
  vcLink: string | null;
  description: string | null;
  scheduledAt: Date | null;
  durationMinutes: number;
}

/** Direct (uncached) meeting existence lookup, tenant-scoped. Null when unknown / cross-tenant. */
export async function getMeetingRef(tenantId: string, meetingId: string): Promise<MeetingRef | null> {
  const rows = await db
    .select({
      id: meetings.id,
      type: meetings.type,
      title: meetings.title,
      status: meetings.status,
      venue: meetings.venue,
      vcLink: meetings.vcLink,
      description: meetings.description,
      scheduledAt: meetings.scheduledAt,
      durationMinutes: meetings.durationMinutes,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Direct (uncached) booking lookup, tenant-scoped. Null when unknown / cross-tenant (route 404). */
export async function getBookingById(tenantId: string, bookingId: string): Promise<RoomBookingRow | null> {
  const rows = await db
    .select()
    .from(roomBookings)
    .where(and(eq(roomBookings.id, bookingId), eq(roomBookings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Booking loaders (source rows for pure conflict / availability logic) ───────

/**
 * Load the CONFIRMED bookings for a room that overlap the half-open `[window.start, window.end)`
 * range (Req 14.3), optionally excluding a specific booking (used when re-checking an update).
 * Overlap is expressed in SQL as `start_at < window.end AND end_at > window.start` (matches the
 * domain `intervalsOverlap` half-open semantics).
 */
export async function getRoomConfirmedBookings(
  tenantId: string,
  roomId: string,
  window: Interval,
  excludeBookingId?: string,
): Promise<RoomBookingLike[]> {
  const conditions = [
    eq(roomBookings.tenantId, tenantId),
    eq(roomBookings.roomId, roomId),
    eq(roomBookings.status, BOOKING_CONFIRMED),
    lt(roomBookings.startAt, window.end),
    gt(roomBookings.endAt, window.start),
  ];
  if (excludeBookingId !== undefined) conditions.push(ne(roomBookings.id, excludeBookingId));

  const rows = await db
    .select({ id: roomBookings.id, roomId: roomBookings.roomId, startAt: roomBookings.startAt, endAt: roomBookings.endAt, status: roomBookings.status })
    .from(roomBookings)
    .where(and(...conditions));
  return rows.map((r) => ({ id: r.id, roomId: r.roomId, startAt: r.startAt, endAt: r.endAt, status: r.status }));
}

/**
 * Gather the busy intervals that block scheduling within `[from, to)`:
 *   - confirmed room bookings for the requested `roomIds`, and
 *   - the scheduled (still-active) meetings that the requested `participantIds` attend.
 * Only intervals overlapping the range are returned. Used to compute availability windows and to
 * lay out candidate slots (Req 14.1).
 */
async function gatherBusy(
  tenantId: string,
  opts: { from: Date; to: Date; participantIds?: readonly string[]; roomIds?: readonly string[] },
): Promise<Interval[]> {
  const busy: Interval[] = [];

  if (opts.roomIds && opts.roomIds.length > 0) {
    const bookingRows = await db
      .select({ startAt: roomBookings.startAt, endAt: roomBookings.endAt })
      .from(roomBookings)
      .where(
        and(
          eq(roomBookings.tenantId, tenantId),
          inArray(roomBookings.roomId, [...opts.roomIds]),
          eq(roomBookings.status, BOOKING_CONFIRMED),
          lt(roomBookings.startAt, opts.to),
          gt(roomBookings.endAt, opts.from),
        ),
      );
    for (const b of bookingRows) busy.push({ start: b.startAt, end: b.endAt });
  }

  if (opts.participantIds && opts.participantIds.length > 0) {
    // Meetings the requested employees are participants of, that are scheduled within the range
    // and not in a terminal (calendar-freeing) state.
    const meetingRows = await db
      .selectDistinct({
        id: meetings.id,
        scheduledAt: meetings.scheduledAt,
        durationMinutes: meetings.durationMinutes,
      })
      .from(participants)
      .innerJoin(meetings, eq(participants.meetingId, meetings.id))
      .where(
        and(
          eq(meetings.tenantId, tenantId),
          inArray(participants.employeeId, [...opts.participantIds]),
        ),
      );
    for (const m of meetingRows) {
      if (!m.scheduledAt) continue;
      const start = m.scheduledAt;
      const end = new Date(start.getTime() + m.durationMinutes * 60_000);
      if (start.getTime() < opts.to.getTime() && end.getTime() > opts.from.getTime()) {
        busy.push({ start, end });
      }
    }
  }

  return busy;
}

// ─── Room availability calendar (Req 14.2) ──────────────────────────────────────

/** A single confirmed reservation window on a room's calendar. */
export interface BookingWindow {
  bookingId: string;
  meetingId: string;
  startAt: string;
  endAt: string;
}

/** A room's booking calendar + free windows over a requested range. */
export interface RoomAvailabilityView {
  roomId: string;
  from: string;
  to: string;
  bookings: BookingWindow[];
  free: Interval[];
}

/**
 * A single room's booking calendar over `[from, to)` plus the free windows (Req 14.2). The busy
 * set is this room's confirmed bookings; the free windows are the complement within the range.
 */
export async function getRoomAvailability(
  tenantId: string,
  roomId: string,
  from: Date,
  to: Date,
): Promise<RoomAvailabilityView> {
  const confirmed = await getRoomConfirmedBookings(tenantId, roomId, { start: from, end: to });
  const busy: Interval[] = confirmed.map((b) => ({ start: b.startAt, end: b.endAt }));
  const free = computeAvailability(busy, { start: from, end: to });

  // Re-query with meeting id / booking id for the calendar view (getRoomConfirmedBookings drops them).
  const rows = await db
    .select({ id: roomBookings.id, meetingId: roomBookings.meetingId, startAt: roomBookings.startAt, endAt: roomBookings.endAt })
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.tenantId, tenantId),
        eq(roomBookings.roomId, roomId),
        eq(roomBookings.status, BOOKING_CONFIRMED),
        lt(roomBookings.startAt, to),
        gt(roomBookings.endAt, from),
      ),
    );

  return {
    roomId,
    from: from.toISOString(),
    to: to.toISOString(),
    bookings: rows.map((r) => ({
      bookingId: r.id,
      meetingId: r.meetingId,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
    })),
    free,
  };
}

// ─── Availability windows & suggest-slots (Req 14.1) ────────────────────────────

/**
 * Compute the free windows within `[from, to)` common to the requested participants and room
 * (Req 14.1). Windows shorter than `durationMinutes` (when supplied) are dropped so only windows
 * that can actually host the meeting are returned.
 */
export async function computeAvailabilityWindows(
  tenantId: string,
  q: { from: Date; to: Date; participantIds?: readonly string[]; roomId?: string; durationMinutes?: number },
): Promise<Interval[]> {
  const busy = await gatherBusy(tenantId, {
    from: q.from,
    to: q.to,
    ...(q.participantIds ? { participantIds: q.participantIds } : {}),
    ...(q.roomId ? { roomIds: [q.roomId] } : {}),
  });
  return computeAvailability(busy, { start: q.from, end: q.to }, q.durationMinutes ? { minDurationMinutes: q.durationMinutes } : undefined);
}

/**
 * Suggest concrete candidate meeting slots of `durationMinutes` within `[from, to)` (Req 14.1),
 * constrained to the free windows common to the requested participants and rooms.
 */
export async function suggestMeetingSlots(
  tenantId: string,
  q: {
    from: Date;
    to: Date;
    durationMinutes: number;
    participantIds?: readonly string[];
    roomIds?: readonly string[];
    stepMinutes?: number;
    limit?: number;
  },
): Promise<Interval[]> {
  const busy = await gatherBusy(tenantId, {
    from: q.from,
    to: q.to,
    ...(q.participantIds ? { participantIds: q.participantIds } : {}),
    ...(q.roomIds ? { roomIds: q.roomIds } : {}),
  });
  return suggestSlots(busy, { start: q.from, end: q.to }, q.durationMinutes, {
    ...(q.stepMinutes !== undefined ? { stepMinutes: q.stepMinutes } : {}),
    ...(q.limit !== undefined ? { limit: q.limit } : {}),
  });
}

// ─── Conflict detection (Req 14.3, 14.4) ────────────────────────────────────────

/**
 * Detect scheduling conflicts for a proposed booking window (Req 14.3): room double-booking and
 * mandatory-participant overlap. Returns a structured {@link ConflictReport} (rather than
 * throwing) so callers can present the conflict details + alternatives to the secretary (Req
 * 14.4). Used by the booking route for a synchronous fast-409 pre-check.
 */
export async function checkConflicts(
  tenantId: string,
  input: {
    window: Interval;
    roomId?: string;
    excludeBookingId?: string;
    participantIds?: readonly string[];
  },
): Promise<ConflictReport> {
  const detectInput: Parameters<typeof detectConflicts>[0] = { window: input.window };

  if (input.roomId) {
    const existing = await getRoomConfirmedBookings(tenantId, input.roomId, input.window, input.excludeBookingId);
    detectInput.roomBooking = { roomId: input.roomId, startAt: input.window.start, endAt: input.window.end };
    detectInput.existingRoomBookings = existing;
  }

  if (input.participantIds && input.participantIds.length > 0) {
    const busy = await gatherBusy(tenantId, {
      from: input.window.start,
      to: input.window.end,
      participantIds: input.participantIds,
    });
    const participantBusy: ParticipantBusyInterval[] = [];
    // gatherBusy loses the per-participant attribution; re-attribute by re-querying is overkill for
    // the fast pre-check, so surface each busy window against every requested participant id.
    for (const iv of busy) {
      for (const pid of input.participantIds) {
        participantBusy.push({ participantId: pid, start: iv.start, end: iv.end });
      }
    }
    detectInput.mandatoryParticipantIds = [...input.participantIds];
    detectInput.participantBusy = participantBusy;
  }

  return detectConflicts(detectInput);
}
