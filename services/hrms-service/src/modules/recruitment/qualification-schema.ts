import { uuid, varchar, integer, numeric, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import { recruitmentSchema } from "./schema.js";

export const hrmsQualificationRequirements = recruitmentSchema.table("hrms_qualification_requirements", {
  id:                        uuid("id").primaryKey().defaultRandom(),
  tenantId:                  uuid("tenant_id").notNull(),
  jobOpeningId:              uuid("job_opening_id").notNull(),
  minTotalYears:             numeric("min_total_years", { precision: 4, scale: 1 }),
  minRelevantYears:          numeric("min_relevant_years", { precision: 4, scale: 1 }),
  maxGapMonths:              integer("max_gap_months"),
  minEducationLevel:         varchar("min_education_level", { length: 24 }),
  requiredDisciplines:       jsonb("required_disciplines").$type<string[]>().notNull().default([]),
  minPercentage:             numeric("min_percentage", { precision: 5, scale: 2 }),
  recognisedInstitutionsOnly: boolean("recognised_institutions_only").notNull().default(false),
  createdBy:                 uuid("created_by").notNull(),
  updatedBy:                 uuid("updated_by").notNull(),
  version:                   integer("version").notNull().default(1),
  createdAt:                 timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                 timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QualRequirementRow = typeof hrmsQualificationRequirements.$inferSelect;
export type QualRequirementInsert = typeof hrmsQualificationRequirements.$inferInsert;

export const schema = { hrmsQualificationRequirements };
