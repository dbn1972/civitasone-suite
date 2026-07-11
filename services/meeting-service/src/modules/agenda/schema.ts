/**
 * Agenda module — Drizzle table definitions (owns the `meeting.agenda_items` table).
 *
 * Mirrors migrations/0001_meeting_core.sql `meeting.agenda_items` column-for-column
 * (types, nullability, defaults). The migration is the source of truth for the DDL;
 * this file is the typed application-layer view of it.
 *
 * Module isolation (steering L2): each module owns its PG schema objects. `meetingSchema`
 * is a reference to the shared `meeting` PostgreSQL schema — calling `pgSchema("meeting")`
 * here produces the same schema binding used by sibling modules, without a cross-module
 * import dependency.
 *
 * _Requirements: 3.1, 3.2_
 */
import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

/**
 * `meeting.agenda_items` — a single topic proposed for / scheduled into a meeting.
 *
 * Ordering (Req 3.3): `sequence` is a contiguous 1..N ordinal within a meeting,
 * assigned so that `category` groups sort standing → arising_from_minutes → new_business,
 * stable within each group (see domain.ts `orderAgendaItems`).
 *
 * Lifecycle (Req 3.2): `status` ∈ proposed | accepted | deferred | withdrawn | carried_forward.
 * A deferred item carries forward to the next meeting of the same committee; `deferredTo`
 * points at the successor agenda item created on that meeting (see domain.ts `buildCarryForward`).
 */
export const agendaItems = meetingSchema.table("agenda_items", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  meetingId:            uuid("meeting_id").notNull(),
  sequence:             integer("sequence").notNull(),
  title:                text("title").notNull(),
  description:          text("description"),
  outcomeType:          varchar("outcome_type", { length: 16 }).notNull(),
  durationMinutes:      integer("duration_minutes").notNull().default(15),
  presenterId:          uuid("presenter_id"),
  status:               varchar("status", { length: 16 }).notNull().default("proposed"),
  confidentialityLevel: varchar("confidentiality_level", { length: 16 }).notNull().default("internal"),
  linkedDecisionId:     uuid("linked_decision_id"),
  fileReference:        text("file_reference"),
  submittedBy:          uuid("submitted_by"),
  submittedAt:          timestamp("submitted_at", { withTimezone: true }),
  deferredTo:           uuid("deferred_to"),
  category:             varchar("category", { length: 32 }),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
  version:              integer("version").notNull().default(1),
});

/** Drizzle schema map fragment — merged into shared/db.ts `schema` as this module lands. */
export const agendaModule = { agendaItems };

/** Row types inferred from the table for repo/consumer/query layers. */
export type AgendaItemRow = typeof agendaItems.$inferSelect;
export type AgendaItemInsert = typeof agendaItems.$inferInsert;
