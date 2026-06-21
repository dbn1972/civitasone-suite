import {
  pgSchema, uuid, varchar, numeric, integer, timestamp,
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
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type AppraisalRow    = typeof hrmsAppraisals.$inferSelect;
export type AppraisalInsert = typeof hrmsAppraisals.$inferInsert;

export const schema = { hrmsAppraisals };
