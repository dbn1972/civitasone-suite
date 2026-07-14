/**
 * Resolution Indent Intake — schema.
 *
 * Cross-service choreography (Req 22.1): meeting-service publishes
 * `meeting.decision.procurement` when a board/committee records a procurement
 * decision. This service opens a PENDING REVIEW item ("action arising from board
 * resolution"). A competent procurement officer reviews it and actions it through
 * the normal indent flow — this intake row NEVER auto-creates a real indent
 * (GFR / maker-checker authorization is preserved).
 *
 * Lives in the `indent` schema so it reuses `indent.current_tenant_id()` for RLS,
 * mirroring `indent.procurement_indents`.
 */
import { uuid, text, varchar, timestamp, date, integer } from "drizzle-orm/pg-core";
import { indentSchema } from "../indent/schema.js";

export const procurementResolutionIndentIntake = indentSchema.table("procurement_resolution_indent_intake", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  /** Origin system — currently only board meetings. */
  source:        varchar("source", { length: 16 }).notNull().default("meeting"),
  /** meeting-service decision id — unique per tenant (idempotent intake). */
  decisionId:    uuid("decision_id").notNull(),
  meetingId:     uuid("meeting_id"),
  committeeId:   uuid("committee_id"),
  title:         text("title"),
  text:          text("text").notNull(),
  authority:     text("authority"),
  effectiveDate: date("effective_date"),
  /** pending_review | accepted | rejected */
  status:        varchar("status", { length: 24 }).notNull().default("pending_review"),
  reviewedBy:    uuid("reviewed_by"),
  reviewedAt:    timestamp("reviewed_at", { withTimezone: true }),
  note:          text("note"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:       integer("version").notNull().default(1),
});

export type ResolutionIndentIntakeRow    = typeof procurementResolutionIndentIntake.$inferSelect;
export type ResolutionIndentIntakeInsert = typeof procurementResolutionIndentIntake.$inferInsert;

export const schema = { procurementResolutionIndentIntake };
