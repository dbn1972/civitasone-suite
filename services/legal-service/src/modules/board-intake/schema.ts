import {
  pgSchema, uuid, varchar, text, date, timestamp, integer,
} from "drizzle-orm/pg-core";

// Board-decision intake lives under the cases schema alongside legal matters.
export const boardIntakeSchema = pgSchema("cases");

/**
 * Board-decision intake (cross-service choreography, action side).
 *
 * meeting-service publishes `meeting.decision.legal` when a board/committee
 * records a free-text legal decision ("action arising from board resolution").
 * Because the decision is FREE TEXT it CANNOT be auto-executed into a real legal
 * matter. This table is a human-triage inbox: the consumer opens a
 * PENDING_REVIEW item and a competent legal officer reviews it, then actions it
 * through the service's own controlled flow (case / notice / opinion / etc.).
 * Accepting an item only marks it reviewed.
 */
export const legalBoardDecisionIntake = boardIntakeSchema.table("legal_board_decision_intake", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  source:        varchar("source", { length: 24 }).notNull().default("meeting"),
  decisionId:    uuid("decision_id").notNull(),
  meetingId:     uuid("meeting_id").notNull(),
  committeeId:   uuid("committee_id"),
  text:          text("text").notNull(),
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

export type BoardDecisionIntakeRow = typeof legalBoardDecisionIntake.$inferSelect;
export type BoardDecisionIntakeInsert = typeof legalBoardDecisionIntake.$inferInsert;

export const schema = { legalBoardDecisionIntake };
