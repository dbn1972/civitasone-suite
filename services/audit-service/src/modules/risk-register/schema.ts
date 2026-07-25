import { pgSchema, uuid, text, varchar, integer, timestamp, date } from "drizzle-orm/pg-core";

// Lives in the existing `risk` schema alongside risk.audit_risks.
export const riskSchema = pgSchema("risk");

/** SVC-099: a control mitigating one or more risks. */
export const riskControls = riskSchema.table("risk_controls", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  riskId:        uuid("risk_id").notNull(),
  controlCode:   text("control_code").notNull(),
  description:   text("description").notNull(),
  controlType:   varchar("control_type", { length: 16 }).notNull().default("preventive"),
  ownerRef:      text("owner_ref"),
  effectiveness: varchar("effectiveness", { length: 16 }).notNull().default("not_tested"),
  status:        varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

/** SVC-099: a test of a control's operating effectiveness. */
export const riskControlTests = riskSchema.table("risk_control_tests", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  controlId: uuid("control_id").notNull(),
  result:    varchar("result", { length: 16 }).notNull(),
  testedBy:  text("tested_by"),
  testDate:  date("test_date"),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

/** SVC-099: a risk incident / loss event. */
export const riskIncidents = riskSchema.table("risk_incidents", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  riskId:      uuid("risk_id"),
  title:       text("title").notNull(),
  description: text("description").notNull(),
  severity:    varchar("severity", { length: 16 }).notNull().default("minor"),
  status:      varchar("status", { length: 16 }).notNull().default("open"),
  occurredAt:  timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  reportedBy:  text("reported_by"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

/** SVC-099: a mitigation / treatment plan for a risk. */
export const riskMitigationPlans = riskSchema.table("risk_mitigation_plans", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  riskId:    uuid("risk_id").notNull(),
  action:    text("action").notNull(),
  ownerRef:  text("owner_ref"),
  dueDate:   date("due_date"),
  status:    varchar("status", { length: 16 }).notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

/** SVC-099: formal risk acceptance — maker-checker (requester != approver). */
export const riskAcceptances = riskSchema.table("risk_acceptances", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  riskId:        uuid("risk_id").notNull(),
  rationale:     text("rationale").notNull(),
  residualScore: integer("residual_score").notNull(),
  status:        varchar("status", { length: 16 }).notNull().default("proposed"),
  validUntil:    date("valid_until"),
  requestedBy:   uuid("requested_by").notNull(),
  decidedBy:     uuid("decided_by"),
  decidedAt:     timestamp("decided_at", { withTimezone: true }),
  remarks:       text("remarks"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:       integer("version").notNull().default(1),
});

/** SVC-099: periodic review-cycle record. */
export const riskReviews = riskSchema.table("risk_reviews", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  riskId:         uuid("risk_id").notNull(),
  outcome:        varchar("outcome", { length: 16 }).notNull().default("unchanged"),
  notes:          text("notes"),
  reviewedBy:     text("reviewed_by"),
  reviewedAt:     timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  nextReviewDate: date("next_review_date"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
});

export type ControlRow = typeof riskControls.$inferSelect;
export type ControlInsert = typeof riskControls.$inferInsert;
export type IncidentRow = typeof riskIncidents.$inferSelect;
export type MitigationRow = typeof riskMitigationPlans.$inferSelect;
export type AcceptanceRow = typeof riskAcceptances.$inferSelect;
export type AcceptanceInsert = typeof riskAcceptances.$inferInsert;

export const schema = {
  riskControls, riskControlTests, riskIncidents,
  riskMitigationPlans, riskAcceptances, riskReviews,
};
