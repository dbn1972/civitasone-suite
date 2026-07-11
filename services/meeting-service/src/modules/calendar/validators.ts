/**
 * Calendar module — Zod request validators (route boundary).
 *
 * Every write route parses its body through one of these before publishing a command
 * (route → zod → queue.publish → 202); read routes parse their query/body the same way.
 * The `roomBook` / `roomBookCancel` shapes mirror the `COMMANDS.room*` payload contracts in
 * src/topics.ts (`roomBook: { meetingId, roomId, startAt, endAt }`,
 * `roomBookCancel: { bookingId, version, reason? }`). Path params (`roomId`, `bookingId`,
 * `meetingId`) are supplied by the route and merged into the command envelope.
 *
 * _Requirements: 14.1, 14.2, 14.3, 14.6, 14.7, 14.8_
 */
import { z } from "zod";
import { ROOM_STATUSES } from "./domain.js";

const uuid = z.string().uuid();
/** Optimistic-lock version (steering: every mutable entity carries a `version`). */
const version = z.number().int().nonnegative();
/** ISO-8601 instant with timezone (matches Drizzle `timestamptz` columns). */
const isoDateTime = z.string().datetime({ offset: true });
/** Meeting/booking duration in minutes: at least 1, capped at a 24-hour day. */
const durationMinutes = z.number().int().positive().max(24 * 60);
const roomStatus = z.enum(ROOM_STATUSES);

/** AV / facility equipment list stored as JSONB on the room (Req 14.2). */
const equipment = z.array(z.string().trim().min(1).max(120)).max(100);

// ─── Rooms (Req 14.2) ──────────────────────────────────────────────────────────

/**
 * Create a room in the booking registry (Req 14.2). `capacity` is the seating count; `equipment`
 * is the AV/facility list; `accessibility` flags step-free / assisted-access venues. New rooms
 * default to `active`.
 */
export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(500),
  capacity: z.number().int().positive().max(100_000),
  location: z.string().trim().max(1_000).optional(),
  floor: z.string().trim().max(8).optional(),
  building: z.string().trim().max(1_000).optional(),
  equipment: equipment.optional(),
  accessibility: z.boolean().optional(),
  status: roomStatus.optional(),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

/** Update a room — all fields optional; at least one must be supplied. Optimistic-locked. */
export const roomPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    capacity: z.number().int().positive().max(100_000),
    location: z.string().trim().max(1_000).nullable(),
    floor: z.string().trim().max(8).nullable(),
    building: z.string().trim().max(1_000).nullable(),
    equipment: equipment.nullable(),
    accessibility: z.boolean(),
    status: roomStatus,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "patch must contain at least one field" });
export type RoomPatch = z.infer<typeof roomPatchSchema>;

export const updateRoomSchema = z.object({
  version,
  patch: roomPatchSchema,
});
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

// ─── Room booking (Req 14.3 · COMMANDS.roomBook / roomBookCancel) ───────────────

/**
 * Book a room for a meeting over `[startAt, endAt)` (Req 14.3). `endAt` must be strictly after
 * `startAt`. The consumer additionally checks the database exclusion constraint / domain
 * `assertNoRoomConflict` so overlapping confirmed bookings are rejected (P28).
 */
export const bookRoomSchema = z
  .object({
    meetingId: uuid,
    roomId: uuid,
    startAt: isoDateTime,
    endAt: isoDateTime,
  })
  .refine((b) => Date.parse(b.endAt) > Date.parse(b.startAt), {
    message: "endAt must be strictly after startAt",
    path: ["endAt"],
  });
export type BookRoomInput = z.infer<typeof bookRoomSchema>;

/** Cancel a room booking (Req 14.8); optimistic-locked, optional reason for the audit trail. */
export const cancelBookingSchema = z.object({
  version,
  reason: z.string().trim().max(2_000).optional(),
});
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

// ─── Availability & suggest-slots queries (Req 14.1) ────────────────────────────

/**
 * Check availability across mandatory participants and/or a room within a date range (Req 14.1).
 * Complex multi-condition read → POST body per the API-design standard. `from`/`to` bound the
 * search range; `to` must be after `from`. Optional `durationMinutes` filters out windows too
 * short to host the meeting.
 */
export const availabilityQuerySchema = z
  .object({
    from: isoDateTime,
    to: isoDateTime,
    participantIds: z.array(uuid).max(500).optional(),
    roomId: uuid.optional(),
    durationMinutes: durationMinutes.optional(),
  })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), {
    message: "to must be after from",
    path: ["to"],
  });
export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;

/**
 * Suggest candidate meeting slots of `durationMinutes` within `[from, to)` (Req 14.1). Optionally
 * constrained to a set of mandatory participants and/or specific rooms. `stepMinutes` controls the
 * gap between successive candidate starts (defaults to the slot length); `limit` caps the number
 * of suggestions returned.
 */
export const suggestSlotsQuerySchema = z
  .object({
    from: isoDateTime,
    to: isoDateTime,
    durationMinutes,
    participantIds: z.array(uuid).max(500).optional(),
    roomIds: z.array(uuid).max(200).optional(),
    stepMinutes: z.number().int().positive().max(24 * 60).optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), {
    message: "to must be after from",
    path: ["to"],
  });
export type SuggestSlotsQueryInput = z.infer<typeof suggestSlotsQuerySchema>;

// ─── Room availability calendar query (Req 14.2) ────────────────────────────────

/** Query a single room's booking calendar over a date range (GET /rooms/:roomId/availability). */
export const roomAvailabilityQuerySchema = z
  .object({
    from: isoDateTime,
    to: isoDateTime,
  })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), {
    message: "to must be after from",
    path: ["to"],
  });
export type RoomAvailabilityQueryInput = z.infer<typeof roomAvailabilityQuerySchema>;

// ─── Path params ────────────────────────────────────────────────────────────────

export const roomIdParam = z.object({ roomId: uuid });
export const bookingIdParam = z.object({ bookingId: uuid });
export const meetingIdParam = z.object({ meetingId: uuid });
