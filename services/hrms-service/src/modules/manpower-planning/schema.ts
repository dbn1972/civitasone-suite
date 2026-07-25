import {
  pgSchema, uuid, varchar, integer, text, timestamp,
} from "drizzle-orm/pg-core";

export const manpowerSchema = pgSchema("manpower");

/** One manpower plan per (unit, cadre, plan_year). Maker-checker approved. */
export const manpowerPlans = manpowerSchema.table("plans", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  planYear:           integer("plan_year").notNull(),
  unitId:             uuid("unit_id").notNull(),
  cadre:              varchar("cadre", { length: 120 }).notNull(),
  designationId:      uuid("designation_id"),
  requiredStrength:   integer("required_strength").notNull().default(0),
  sanctionedStrength: integer("sanctioned_strength").notNull().default(0),
  filledStrength:     integer("filled_strength").notNull().default(0),
  remarks:            text("remarks"),
  status:             varchar("status", { length: 24 }).notNull().default("draft"),
  createdBy:          uuid("created_by").notNull(),
  approvedBy:         uuid("approved_by"),
  submittedAt:        timestamp("submitted_at", { withTimezone: true }),
  approvedAt:         timestamp("approved_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:            integer("version").notNull().default(1),
});

/** Category-wise reservation-roster inputs for a plan. */
export const manpowerPlanRoster = manpowerSchema.table("plan_roster", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  planId:        uuid("plan_id").notNull(),
  category:      varchar("category", { length: 8 }).notNull(),
  reservedCount: integer("reserved_count").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Recruitment requisition generated FROM an approved plan. */
export const manpowerRequisitions = manpowerSchema.table("requisitions", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  planId:             uuid("plan_id").notNull(),
  requisitionNo:      text("requisition_no").notNull(),
  unitId:             uuid("unit_id").notNull(),
  cadre:              varchar("cadre", { length: 120 }).notNull(),
  designationId:      uuid("designation_id"),
  requestedVacancies: integer("requested_vacancies").notNull().default(0),
  filledCount:        integer("filled_count").notNull().default(0),
  jobOpeningId:       uuid("job_opening_id").notNull(),
  advertisementRef:   varchar("advertisement_ref", { length: 200 }),
  status:             varchar("status", { length: 24 }).notNull().default("emitted"),
  createdBy:          uuid("created_by").notNull(),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:            integer("version").notNull().default(1),
});

export type ManpowerPlanRow = typeof manpowerPlans.$inferSelect;
export type ManpowerPlanInsert = typeof manpowerPlans.$inferInsert;
export type PlanRosterRow = typeof manpowerPlanRoster.$inferSelect;
export type RequisitionRow = typeof manpowerRequisitions.$inferSelect;

export const schema = { manpowerPlans, manpowerPlanRoster, manpowerRequisitions };
