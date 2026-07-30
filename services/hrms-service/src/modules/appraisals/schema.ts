import {
  pgSchema, uuid, varchar, numeric, integer, boolean, text, date, timestamp,
} from "drizzle-orm/pg-core";

export const appraisalSchema = pgSchema("appraisal");

export const hrmsAppraisals = appraisalSchema.table("hrms_appraisals", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  employeeId:      uuid("employee_id").notNull(),
  appraisalPeriod: varchar("appraisal_period", { length: 16 }).notNull(),
  rating:          numeric("rating", { precision: 3, scale: 1 }),
  status:          varchar("status", { length: 24 }).notNull().default("pending"),
  reviewerId:      uuid("reviewer_id"),
  // --- APAR / SPARROW multi-authority workflow (migration 0017) ---
  reportingOfficerId:   uuid("reporting_officer_id"),
  reviewingOfficerId:   uuid("reviewing_officer_id"),
  acceptingAuthorityId: uuid("accepting_authority_id"),
  selfAppraisal:        text("self_appraisal"),
  reportingPenPicture:  text("reporting_pen_picture"),
  reviewingRemarks:     text("reviewing_remarks"),
  acceptingRemarks:     text("accepting_remarks"),
  overallGrade:         numeric("overall_grade", { precision: 4, scale: 2 }),
  overallBand:          varchar("overall_band", { length: 16 }),
  disclosedAt:          timestamp("disclosed_at", { withTimezone: true }),
  representation:       text("representation"),
  representationDue:    date("representation_due"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type AppraisalRow    = typeof hrmsAppraisals.$inferSelect;
export type AppraisalInsert = typeof hrmsAppraisals.$inferInsert;

// ── Sprint 5: Performance & APAR completion (T30–T34) ─────────────────────

// T30 (P&T-PKA-0394/0399): 360-degree feedback.
export const hrms360Feedback = appraisalSchema.table("hrms_360_feedback", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  appraisalId:   uuid("appraisal_id").notNull(),
  reviewerId:    uuid("reviewer_id").notNull(),
  relationship:  varchar("relationship", { length: 24 }).notNull(),
  ratings:       text("ratings"),
  comments:      text("comments"),
  submittedAt:   timestamp("submitted_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// T31 (P&T-PKA-0396/0397): calibration committee.
export const hrmsCalibrationSessions = appraisalSchema.table("hrms_calibration_sessions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  periodId:      uuid("period_id"),
  status:        varchar("status", { length: 16 }).notNull().default("open"),
  conductedAt:   timestamp("conducted_at", { withTimezone: true }),
  conductedBy:   uuid("conducted_by"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});

// T32 (P&T-PKA-0400): bell-curve / forced distribution analytics (query view, no separate table needed — but store results).
export const hrmsBellCurveResults = appraisalSchema.table("hrms_bell_curve_results", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  sessionId:     uuid("session_id").notNull(),
  band:          varchar("band", { length: 24 }).notNull(),
  targetPercent: integer("target_percent").notNull(),
  actualCount:   integer("actual_count").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// T33 (P&T-PKA-0406/0407): APAR disclosure to employee + representation.
export const hrmsAparDisclosures = appraisalSchema.table("hrms_apar_disclosures", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  appraisalId:   uuid("appraisal_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  disclosedAt:   timestamp("disclosed_at", { withTimezone: true }).notNull().defaultNow(),
  representationFiled: boolean("representation_filed").notNull().default(false),
  representationText: text("representation_text"),
  representationAt: timestamp("representation_at", { withTimezone: true }),
  outcome:       varchar("outcome", { length: 16 }),
  decidedBy:     uuid("decided_by"),
  decidedAt:     timestamp("decided_at", { withTimezone: true }),
  version:       integer("version").notNull().default(1),
});

// T34 (P&T-PKA-0411/0412): rating appeal + PIP linkage.
export const hrmsRatingAppeals = appraisalSchema.table("hrms_rating_appeals", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  appraisalId:   uuid("appraisal_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  appealReason:  text("appeal_reason").notNull(),
  status:        varchar("status", { length: 16 }).notNull().default("filed"),
  pipLinked:     boolean("pip_linked").notNull().default(false),
  pipPlanId:     uuid("pip_plan_id"),
  filedAt:       timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy:     uuid("decided_by"),
  decidedAt:     timestamp("decided_at", { withTimezone: true }),
  outcome:       varchar("outcome", { length: 16 }),
  version:       integer("version").notNull().default(1),
});

export const schema = { hrmsAppraisals, hrms360Feedback, hrmsCalibrationSessions, hrmsBellCurveResults, hrmsAparDisclosures, hrmsRatingAppeals };
