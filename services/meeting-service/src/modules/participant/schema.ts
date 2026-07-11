/**
 * Participant module — Drizzle table definitions (owns the `meeting.participants` table).
 *
 * Mirrors migrations/0001_meeting_core.sql `meeting.participants` column-for-column
 * (types, nullability, defaults). The migration is the source of truth for the DDL;
 * this file is the typed application-layer view of it.
 *
 * PII (DPDP Act 2023, Req 15.3): `personal_email` and `personal_phone` are stored as
 * AES-256-GCM ciphertext via the shared `encryptedText()` custom type. At the DB layer
 * they are plain `TEXT` columns (see migration) holding the "enc:v2:…" envelope; the
 * codec transparently encrypts on write / decrypts on read so repo/consumer code always
 * sees CLEARTEXT while the column at rest holds CIPHERTEXT.
 *
 * Module isolation (steering L2): each module owns its PG schema objects. `meetingSchema`
 * is a reference to the shared `meeting` PostgreSQL schema — calling `pgSchema("meeting")`
 * here produces the same schema binding used by sibling modules, without a cross-module
 * import dependency.
 *
 * _Requirements: 5.1, 5.5, 5.7, 15.3_
 */
import { pgSchema, uuid, text, integer, boolean, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

/**
 * `meeting.participants` — a person associated with a meeting in a defined role (Req 5.1).
 *
 * Roles (Req 5.1): chairperson | member | secretary | special_invitee | observer | presenter
 * (see domain.ts `PARTICIPANT_ROLES`). `is_mandatory` distinguishes members whose presence
 * bears on quorum from optional attendees.
 *
 * Invitation lifecycle (Req 5.2, 5.3, 5.6): `invitation_status` ∈ pending | accepted |
 * tentative | declined; `decline_reason` captures the rationale when a participant declines.
 *
 * Proxy/nominee (Req 5.5): `nominee_id` references the approved alternate a member designates
 * when they cannot attend (validated against the committee's approved nominee list in domain).
 *
 * Special invitee item scoping (Req 5.7): `agenda_item_ids` (JSONB array of agenda item uuids)
 * restricts a `special_invitee` to the specific items they were invited for (see domain.ts
 * `canAccessAgendaItem`). NULL / absent means no item-level restriction.
 */
export const participants = meetingSchema.table("participants", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  meetingId:        uuid("meeting_id").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  role:             varchar("role", { length: 32 }).notNull(),
  isMandatory:      boolean("is_mandatory").notNull().default(true),
  invitationStatus: varchar("invitation_status", { length: 16 }).notNull().default("pending"),
  declineReason:    text("decline_reason"),
  attendanceMode:   varchar("attendance_mode", { length: 16 }),
  nomineeId:        uuid("nominee_id"),
  agendaItemIds:    jsonb("agenda_item_ids").$type<string[]>(),
  // ── PII (AES-256-GCM at rest via encryptedText) ──
  personalEmail:    encryptedText("personal_email"),
  personalPhone:    encryptedText("personal_phone"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

/** Drizzle schema map fragment — merged into shared/db.ts `schema` as this module lands. */
export const participantModule = { participants };

/** Row types inferred from the table for repo/consumer/query layers. */
export type ParticipantRow = typeof participants.$inferSelect;
export type ParticipantInsert = typeof participants.$inferInsert;
