/**
 * Calendar module — Drizzle table definitions (owns `meeting.rooms` and `meeting.room_bookings`).
 *
 * Mirrors migrations/0001_meeting_core.sql column-for-column (types, nullability, defaults).
 * The migration is the source of truth for the DDL; this file is the typed application-layer
 * view of it. Note the migration also declares a `btree_gist` EXCLUDE constraint
 * (`room_bookings_no_overlap`) that prevents two `confirmed` bookings for the same room from
 * having overlapping `[start_at, end_at)` ranges (Req 14.3, property P28) — that guard lives in
 * the database and cannot be expressed in the Drizzle table shape, so it is documented here.
 *
 * Module isolation (steering L2): each module owns its PG schema objects. `meetingSchema` is a
 * reference to the shared `meeting` PostgreSQL schema — calling `pgSchema("meeting")` here
 * produces the same schema binding used by sibling modules, without a cross-module import.
 *
 * _Requirements: 14.2, 14.3_
 */
import { pgSchema, uuid, text, integer, boolean, jsonb, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

/**
 * `meeting.rooms` — a physical meeting venue (Req 14.2).
 *
 * `capacity` is the seating count; `equipment` is an opaque JSONB list of AV/facility items;
 * `accessibility` flags step-free / assisted-access venues. `status` ∈ active | inactive |
 * maintenance (see domain.ts `ROOM_STATUSES`) gates whether a room may be booked.
 */
export const rooms = meetingSchema.table("rooms", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  name:          text("name").notNull(),
  capacity:      integer("capacity").notNull(),
  location:      text("location"),
  floor:         varchar("floor", { length: 8 }),
  building:      text("building"),
  equipment:     jsonb("equipment"),
  accessibility: boolean("accessibility").notNull().default(false),
  status:        varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

/**
 * `meeting.room_bookings` — a reservation of a room for a meeting over `[start_at, end_at)`.
 *
 * Half-open interval semantics: a booking ending exactly when another begins does NOT conflict
 * (see domain.ts `intervalsOverlap`). `status` ∈ confirmed | cancelled (see domain.ts
 * `ROOM_BOOKING_STATUSES`); only `confirmed` bookings participate in the database double-booking
 * exclusion constraint and in conflict detection (Req 14.3, P28).
 */
export const roomBookings = meetingSchema.table("room_bookings", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  roomId:    uuid("room_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  startAt:   timestamp("start_at", { withTimezone: true }).notNull(),
  endAt:     timestamp("end_at", { withTimezone: true }).notNull(),
  status:    varchar("status", { length: 16 }).notNull().default("confirmed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

/** Row types inferred from the tables for repo/consumer/query layers. */
export type RoomRow = typeof rooms.$inferSelect;
export type RoomInsert = typeof rooms.$inferInsert;
export type RoomBookingRow = typeof roomBookings.$inferSelect;
export type RoomBookingInsert = typeof roomBookings.$inferInsert;

/** Module schema map — merged into the Drizzle client in shared/db.ts as this module lands. */
export const schema = { rooms, roomBookings };
