/**
 * Calendar module — HTTP routes (Fastify plugin `calendarRoutes`).
 *
 * Follows the suite CQRS convention exactly (structure.md, mirroring the sibling voting /
 * document route shape):
 *   - writes  → resolveContext → requireRole → require X-Idempotency-Key → zod parse →
 *               (booking) synchronous conflict pre-check → command publish → 202 { data }
 *   - reads   → resolveContext → requireRole → repo (cache-first / computed) → 200 { data }
 *   - errors  → HttpError (400 validation / missing idempotency key, 401 unauthenticated,
 *               403 forbidden, 404 not-found, 409 ROOM_DOUBLE_BOOKED) mapped to the standard
 *               envelope by the app-level schema error handler.
 *
 * Double-booking (Req 14.3, P28): the booking route runs a synchronous conflict pre-check against
 * the confirmed bookings overlapping the requested window and answers `409 ROOM_DOUBLE_BOOKED`
 * fast, before publishing. The consumer + the database `room_bookings_no_overlap` EXCLUDE
 * constraint remain the ultimate guard against races (CQRS: accept → enforce at write time).
 *
 * Reschedule / cancel (Req 14.8): cancelling a booking publishes `room.book_cancel`; the consumer
 * flips the booking and immediately notifies every meeting participant.
 *
 * Idempotency (steering: API Design Standards): `X-Idempotency-Key` is REQUIRED on every write
 * (POST rooms / PATCH rooms / POST bookings / DELETE bookings). A missing key is rejected 400
 * before any command is published. The availability / suggest-slots / ICS reads are POST/GET reads
 * and do not require it.
 *
 * Endpoints (9):
 *   POST   /v1/meetings/calendar/availability                     free windows for participants/room
 *   POST   /v1/meetings/calendar/suggest-slots                    candidate meeting slots
 *   GET    /v1/meetings/calendar/rooms                            room registry (optional ?status)
 *   POST   /v1/meetings/calendar/rooms                            register a room
 *   PATCH  /v1/meetings/calendar/rooms/:roomId                    update a room
 *   GET    /v1/meetings/calendar/rooms/:roomId/availability       a room's booking calendar
 *   POST   /v1/meetings/calendar/bookings                         book a room for a meeting
 *   DELETE /v1/meetings/calendar/bookings/:bookingId              cancel a booking
 *   GET    /v1/meetings/:meetingId/calendar/ics                   ICS (RFC 5545) for a meeting
 *
 * _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6, 14.7, 14.8_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError, httpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { generateIcs, ROOM_STATUSES, type IcsEvent } from "./domain.js";
import {
  createRoomSchema,
  updateRoomSchema,
  bookRoomSchema,
  cancelBookingSchema,
  availabilityQuerySchema,
  suggestSlotsQuerySchema,
  roomAvailabilityQuerySchema,
  roomIdParam,
  bookingIdParam,
  meetingIdParam,
} from "./validators.js";

// ─── RBAC (design § Access Control Matrix) ───────────────────────────────────
// The secretariat curates rooms + bookings (write); everyone associated with a meeting may read
// availability / the room registry / a meeting's calendar file.
const WRITE_ROLES = ["meeting_admin", "committee_secretary", "tenant_admin", "super_admin"];
const READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "tenant_admin",
  "super_admin",
];

/** Optional `?status=` filter on the room registry list. */
const roomListQuery = z.object({ status: z.enum(ROOM_STATUSES).optional() });

/**
 * Enforce the mandatory `X-Idempotency-Key` on writes (steering: idempotency REQUIRED on all
 * POST/PATCH/DELETE that trigger a queued write). Rejected 400 before any command is published.
 */
function requireIdempotencyKey(ctx: RequestContext): void {
  if (!ctx.idempotencyKey || ctx.idempotencyKey.trim().length === 0) {
    throw new HttpError(400, "VALIDATION_FAILED", "X-Idempotency-Key header is required for this operation");
  }
}

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  // ── Availability — free windows for participants/room (Req 14.1) ────────────
  app.post("/v1/meetings/calendar/availability", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = availabilityQuerySchema.parse(req.body);
    const free = await repo.computeAvailabilityWindows(ctx.tenantId, {
      from: new Date(q.from),
      to: new Date(q.to),
      ...(q.participantIds ? { participantIds: q.participantIds } : {}),
      ...(q.roomId ? { roomId: q.roomId } : {}),
      ...(q.durationMinutes !== undefined ? { durationMinutes: q.durationMinutes } : {}),
    });
    return reply.send({ data: { from: q.from, to: q.to, free } });
  });

  // ── Suggest slots — candidate meeting slots (Req 14.1) ──────────────────────
  app.post("/v1/meetings/calendar/suggest-slots", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = suggestSlotsQuerySchema.parse(req.body);
    const slots = await repo.suggestMeetingSlots(ctx.tenantId, {
      from: new Date(q.from),
      to: new Date(q.to),
      durationMinutes: q.durationMinutes,
      ...(q.participantIds ? { participantIds: q.participantIds } : {}),
      ...(q.roomIds ? { roomIds: q.roomIds } : {}),
      ...(q.stepMinutes !== undefined ? { stepMinutes: q.stepMinutes } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    return reply.send({ data: { from: q.from, to: q.to, durationMinutes: q.durationMinutes, slots } });
  });

  // ── Room registry (Req 14.2) ────────────────────────────────────────────────
  app.get("/v1/meetings/calendar/rooms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { status } = roomListQuery.parse(req.query ?? {});
    const rows = await repo.getRooms(ctx.tenantId, status ? { status } : undefined);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  // ── Register a room (Req 14.2) ──────────────────────────────────────────────
  app.post("/v1/meetings/calendar/rooms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const body = createRoomSchema.parse(req.body);
    const accepted = await commands.roomCreate(ctx, body);
    reply.header("location", `/v1/meetings/calendar/rooms/${accepted.id}`);
    return reply.code(202).send({ data: accepted });
  });

  // ── Update a room (Req 14.2) ────────────────────────────────────────────────
  app.patch("/v1/meetings/calendar/rooms/:roomId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { roomId } = roomIdParam.parse(req.params);
    const body = updateRoomSchema.parse(req.body);
    const room = await repo.getRoomById(ctx.tenantId, roomId);
    if (!room) throw httpError("MEETING_NOT_FOUND", "room not found");
    const accepted = await commands.roomUpdate(ctx, roomId, body.version, body.patch);
    return reply.code(202).send({ data: accepted });
  });

  // ── A room's booking calendar (Req 14.2) ────────────────────────────────────
  app.get("/v1/meetings/calendar/rooms/:roomId/availability", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { roomId } = roomIdParam.parse(req.params);
    const q = roomAvailabilityQuerySchema.parse(req.query ?? {});
    const room = await repo.getRoomById(ctx.tenantId, roomId);
    if (!room) throw httpError("MEETING_NOT_FOUND", "room not found");
    const view = await repo.getRoomAvailability(ctx.tenantId, roomId, new Date(q.from), new Date(q.to));
    return reply.send({ data: view });
  });

  // ── Book a room for a meeting (Req 14.3, P28) ───────────────────────────────
  app.post("/v1/meetings/calendar/bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const body = bookRoomSchema.parse(req.body);

    // Parent references must exist (404 before publishing).
    const meeting = await repo.getMeetingRef(ctx.tenantId, body.meetingId);
    if (!meeting) throw httpError("MEETING_NOT_FOUND", "meeting not found");
    const room = await repo.getRoomById(ctx.tenantId, body.roomId);
    if (!room) throw httpError("MEETING_NOT_FOUND", "room not found");

    // Synchronous fast conflict pre-check (Req 14.3, P28): a room double-booking → 409, always
    // (hard block; the consumer + the DB EXCLUDE constraint remain the ultimate race guard). A
    // mandatory-PARTICIPANT clash is also a 409 by default — but only a WARNING the caller must
    // explicitly acknowledge to proceed (`acknowledgeConflicts`), mirroring this service's
    // existing warn-with-waiver precedent for short-notice scheduling
    // (`meeting-core`'s `shortNoticeWaiver`) rather than a hard, unconditional block: unlike a
    // room, a person's OWN calendar conflict is their call to accept (double-booked chairs are
    // common in practice), so "blocking is the safer default... unless acknowledged" fits better
    // here than an unconditional hard block.
    const report = await repo.checkConflicts(ctx.tenantId, {
      window: { start: new Date(body.startAt), end: new Date(body.endAt) },
      roomId: body.roomId,
      ...(body.participantIds && body.participantIds.length > 0 ? { participantIds: body.participantIds } : {}),
    });
    if (report.room.length > 0) {
      throw httpError("ROOM_DOUBLE_BOOKED", "room is already booked for an overlapping period", {
        roomId: body.roomId,
        conflicts: report.room.map((c) => ({ bookingId: c.id ?? null, startAt: c.startAt.toISOString(), endAt: c.endAt.toISOString() })),
      });
    }
    if (report.participants.length > 0 && !body.acknowledgeConflicts) {
      throw httpError(
        "CALENDAR_CONFLICT",
        "one or more mandatory participants have a conflicting commitment in this window; pass acknowledgeConflicts to book anyway",
        {
          conflicts: report.participants.map((c) => ({
            participantId: c.participantId,
            startAt: c.start.toISOString(),
            endAt: c.end.toISOString(),
            ...(c.ref ? { ref: c.ref } : {}),
          })),
        },
      );
    }

    const accepted = await commands.roomBook(ctx, body);
    reply.header("location", `/v1/meetings/calendar/bookings/${accepted.id}`);
    return reply.code(202).send({ data: accepted });
  });

  // ── Cancel a booking (Req 14.8) ─────────────────────────────────────────────
  app.delete("/v1/meetings/calendar/bookings/:bookingId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { bookingId } = bookingIdParam.parse(req.params);
    const body = cancelBookingSchema.parse(req.body ?? {});
    const booking = await repo.getBookingById(ctx.tenantId, bookingId);
    if (!booking) throw httpError("MEETING_NOT_FOUND", "booking not found");
    const accepted = await commands.roomBookCancel(ctx, bookingId, body.version, body.reason);
    return reply.code(202).send({ data: accepted });
  });

  // ── ICS (RFC 5545) for a meeting (Req 14.7) ─────────────────────────────────
  app.get("/v1/meetings/:meetingId/calendar/ics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const meeting = await repo.getMeetingRef(ctx.tenantId, meetingId);
    if (!meeting) throw httpError("MEETING_NOT_FOUND", "meeting not found");
    if (!meeting.scheduledAt) {
      throw httpError("VALIDATION_FAILED", "meeting has no scheduled time to export");
    }
    const start = meeting.scheduledAt;
    const end = new Date(start.getTime() + meeting.durationMinutes * 60_000);
    const event: IcsEvent = {
      uid: `${meeting.id}@meeting.civitasone`,
      start,
      end,
      summary: meeting.title,
      ...(meeting.description !== null ? { description: meeting.description } : {}),
      ...(meeting.venue !== null ? { location: meeting.venue } : {}),
      ...(meeting.vcLink !== null ? { url: meeting.vcLink } : {}),
    };
    const ics = generateIcs([event], { calName: "CivitasOne Meetings" });
    reply.header("content-type", "text/calendar; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="meeting-${meeting.id}.ics"`);
    return reply.send(ics);
  });
}
