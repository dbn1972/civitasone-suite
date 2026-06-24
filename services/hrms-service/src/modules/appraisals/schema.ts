import {
  pgSchema, uuid, varchar, numeric, integer, text, date, timestamp,
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

export const schema = { hrmsAppraisals };
