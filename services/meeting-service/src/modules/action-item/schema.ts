/**
 * action-item module — Drizzle table definitions (schema `meeting`).
 *
 * Mirrors migrations/0001_meeting_core.sql column-for-column for the two action-item tables:
 *   meeting.action_items, meeting.action_progress (types, nullability, defaults). The migration
 *   is the source of truth for the DDL; this file is the typed application-layer view of it.
 *
 * Module isolation (steering L2): each module owns its PG schema objects. `meetingSchema` is a
 * reference to the shared `meeting` PostgreSQL schema — calling `pgSchema("meeting")` here
 * produces the same schema binding used by sibling modules, without a cross-module import.
 *
 * Timestamps (steering: Migration Safety): every temporal column is `timestamptz`
 * (`withTimezone: true`) so instants round-trip in UTC and are rendered in the tenant locale at
 * the edge — never a naive `timestamp`.
 *
 * _Requirements: 9.1, 9.2, 9.5, 9.6, 9.7, 10.1_
 */
import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

// ─── action_items ─────────────────────────────────────────────────────────────

/**
 * `meeting.action_items` — a task assigned during (or arising from) a meeting to a specific
 * person, with a deadline, SLA, escalation state, and completion evidence (Req 9.1).
 *
 * Lineage: `decisionId` / `agendaItemId` link the action back to the decision it implements and
 * the agenda item it arose under (both nullable — an action can be recorded standalone).
 *
 * SLA + escalation (Req 9.5, 9.6): `slaHours` records the assignment→deadline window; when the
 * deadline lapses the item moves to `overdue` and `escalationLevel` climbs (1→supervisor,
 * 2→department head, 3→chairperson) with `nextEscalationAt` timing the following rung. See
 * domain.ts for the pure computation (`computeSlaHours`, `resolveEscalationState`).
 *
 * Verification (Req 9.7, P22): a transition to `verified` requires `evidenceUrl` OR
 * `evidenceNote` to be present (see domain.ts `assertEvidenceBeforeVerification`).
 */
export const actionItems = meetingSchema.table("action_items", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  meetingId:        uuid("meeting_id").notNull(),
  decisionId:       uuid("decision_id"),
  agendaItemId:     uuid("agenda_item_id"),
  description:      text("description").notNull(),
  assigneeId:       uuid("assignee_id").notNull(),
  deadline:         timestamp("deadline", { withTimezone: true }).notNull(),
  priority:         varchar("priority", { length: 8 }).notNull().default("medium"),
  slaHours:         integer("sla_hours"),
  escalationLevel:  integer("escalation_level").notNull().default(0),
  status:           varchar("status", { length: 16 }).notNull().default("assigned"),
  evidenceUrl:      text("evidence_url"),
  evidenceNote:     text("evidence_note"),
  verifiedBy:       uuid("verified_by"),
  verifiedAt:       timestamp("verified_at", { withTimezone: true }),
  completedAt:      timestamp("completed_at", { withTimezone: true }),
  acknowledgedAt:   timestamp("acknowledged_at", { withTimezone: true }),
  overdueAt:        timestamp("overdue_at", { withTimezone: true }),
  nextEscalationAt: timestamp("next_escalation_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// ─── action_progress ────────────────────────────────────────────────────────

/**
 * `meeting.action_progress` — an append-only progress note on an action item (Req 9.x, 10.2).
 *
 * Each row is one update from the assignee: free-text `updateText` plus a completion
 * `percentage` (0–100). The history feeds the ATR "evidence summary" column and the progress
 * timeline view (see repo.ts `getProgressHistory` in task 11.3).
 */
export const actionProgress = meetingSchema.table("action_progress", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  actionItemId: uuid("action_item_id").notNull(),
  updateText:   text("update_text").notNull(),
  percentage:   integer("percentage").notNull().default(0),
  updatedBy:    uuid("updated_by").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Inferred row/insert types ───────────────────────────────────────────────

export type ActionItemRow        = typeof actionItems.$inferSelect;
export type ActionItemInsert     = typeof actionItems.$inferInsert;
export type ActionProgressRow    = typeof actionProgress.$inferSelect;
export type ActionProgressInsert = typeof actionProgress.$inferInsert;

/** Module schema map — merged into the Drizzle client in shared/db.ts as this module lands. */
export const schema = { actionItems, actionProgress };
