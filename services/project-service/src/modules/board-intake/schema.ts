import {
  pgSchema, uuid, varchar, text, date, timestamp, integer,
} from "drizzle-orm/pg-core";

// Board-decision intake lives under the project schema alongside project records.
export const boardIntakeSchema = pgSchema("project");

/**
 * Board-decision intake (cross-service choreography, action side).
 *
 * meeting-service publishes `meeting.decision.project` when a board/committee
 * records a free-text project decision ("action arising from board resolution"),
 * optionally referencing a project (projectRef). Because the decision is FREE
 * TEXT it CANNOT be auto-executed into a real project record. This table is a
 * human-triage inbox: the consumer opens a PENDING_REVIEW item and a competent
 * project officer reviews it, then actions it through the service's own
 * controlled flow. Accepting an item only marks it reviewed.
 */
export const projectBoardDecisionIntake = boardIntakeSchema.table("project_board_decision_intake", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  source:        varchar("source", { length: 24 }).notNull().default("meeting"),
  decisionId:    uuid("decision_id").notNull(),
  meetingId:     uuid("meeting_id").notNull(),
  committeeId:   uuid("committee_id"),
  text:          text("text").notNull(),
  // Free-text external reference to a project the board named (may not resolve
  // to a project_projects row — a human confirms the linkage on review).
  projectRef:    text("project_ref"),
  authority:     varchar("authority", { length: 200 }),
  effectiveDate: date("effective_date"),
  status:        varchar("status", { length: 16 }).notNull().default("pending_review"),
  reviewedBy:    uuid("reviewed_by"),
  reviewedAt:    timestamp("reviewed_at", { withTimezone: true }),
  note:          text("note"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:       integer("version").notNull().default(1),
});

export type BoardDecisionIntakeRow = typeof projectBoardDecisionIntake.$inferSelect;
export type BoardDecisionIntakeInsert = typeof projectBoardDecisionIntake.$inferInsert;

export const schema = { projectBoardDecisionIntake };
