import {
  pgSchema, uuid, varchar, integer, text, date, timestamp, numeric,
} from "drizzle-orm/pg-core";

export const senioritySchema = pgSchema("seniority");

/**
 * A generated point-in-time seniority list snapshot. `status` moves
 * generated -> approved (one-way; a re-generate for the same filter/asOf
 * creates a new row rather than mutating an approved one).
 */
export const hrmsSeniorityLists = senioritySchema.table("hrms_seniority_lists", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  departmentId:   uuid("department_id"),
  designationId:  uuid("designation_id"),
  asOf:           date("as_of").notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("generated"),
  entryCount:     integer("entry_count").notNull().default(0),
  generatedBy:    uuid("generated_by").notNull(),
  generatedAt:    timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  approvedBy:     uuid("approved_by"),
  approvedAt:     timestamp("approved_at", { withTimezone: true }),
  remarks:        text("remarks"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:        integer("version").notNull().default(1),
});

/** Ranked entries captured at generation time — the immutable snapshot rows. */
export const hrmsSeniorityListEntries = senioritySchema.table("hrms_seniority_list_entries", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  seniorityListId:  uuid("seniority_list_id").notNull(),
  rank:             integer("rank").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  employeeNo:       text("employee_no").notNull(),
  fullName:         text("full_name").notNull(),
  designationId:    uuid("designation_id").notNull(),
  departmentId:     uuid("department_id").notNull(),
  dateOfJoining:    date("date_of_joining").notNull(),
  dateOfBirth:      date("date_of_birth"),
  meritGrade:       numeric("merit_grade", { precision: 4, scale: 2 }),
  qualifyingYears:  numeric("qualifying_years", { precision: 6, scale: 2 }).notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeniorityListRow = typeof hrmsSeniorityLists.$inferSelect;
export type SeniorityListInsert = typeof hrmsSeniorityLists.$inferInsert;
export type SeniorityListEntryRow = typeof hrmsSeniorityListEntries.$inferSelect;
export type SeniorityListEntryInsert = typeof hrmsSeniorityListEntries.$inferInsert;

export const schema = { hrmsSeniorityLists, hrmsSeniorityListEntries };
