import {
  pgSchema, uuid, varchar, text, date, timestamp, integer,
} from "drizzle-orm/pg-core";

// Board-decision intake lives under the lifecycle schema alongside the other
// HR-order source records (transfers, promotions, deputations).
export const boardIntakeSchema = pgSchema("lifecycle");

/**
 * Board-decision intake (cross-service choreography, action side).
 *
 * meeting-service publishes `meeting.decision.hr` when a committee/board records
 * a free-text HR decision ("action arising from board resolution"). Because the
 * decision is FREE TEXT, it CANNOT be auto-executed into a real HR order. This
 * table is a human-triage inbox: the consumer opens a PENDING_REVIEW item and a
 * competent HR officer reviews it, then actions it through the service's own
 * controlled flow (transfer / promotion / disciplinary / etc.).
 *
 * Accepting an intake item only marks it reviewed — it never creates the HR
 * order itself (see routes.ts accept handler and its TODO hook).
 */
export const hrmsBoardDecisionIntake = boardIntakeSchema.table("hrms_board_decision_intake", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  source:        varchar("source", { length: 24 }).notNull().default("meeting"),
  // Idempotency key from the publisher — unique per tenant (see migration).
  decisionId:    uuid("decision_id").notNull(),
  meetingId:     uuid("meeting_id").notNull(),
  committeeId:   uuid("committee_id"),
  text:          text("text").notNull(),
  authority:     varchar("authority", { length: 200 }),
  effectiveDate: date("effective_date"),
  // pending_review | accepted | rejected
  status:        varchar("status", { length: 16 }).notNull().default("pending_review"),
  reviewedBy:    uuid("reviewed_by"),
  reviewedAt:    timestamp("reviewed_at", { withTimezone: true }),
  note:          text("note"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:       integer("version").notNull().default(1),
});

export type BoardDecisionIntakeRow = typeof hrmsBoardDecisionIntake.$inferSelect;
export type BoardDecisionIntakeInsert = typeof hrmsBoardDecisionIntake.$inferInsert;

export const schema = { hrmsBoardDecisionIntake };
