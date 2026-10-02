import { uuid, varchar, bigint, date, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { employeeSchema } from "../employee/schema.js";
import type { DeputationMoneyTerms } from "./domain.js";

/**
 * PAY-PROFILES: effective-dated, maker-checker pay profile per employee
 * (migration 0166). No row (or no ACTIVE row covering a month) means
 * 'govt_scale' -- today's computation -- so existing employees are unchanged.
 */
export const hrmsPayProfiles = employeeSchema.table("hrms_pay_profiles", {
  id:                       uuid("id").primaryKey().defaultRandom(),
  tenantId:                 uuid("tenant_id").notNull(),
  employeeId:               uuid("employee_id").notNull(),
  payProfile:               varchar("pay_profile", { length: 32 }).notNull(),
  effectiveFrom:            date("effective_from").notNull(),
  effectiveTo:              date("effective_to"),
  status:                   varchar("status", { length: 16 }).notNull().default("pending"), // pending | active | rejected
  deputationId:             uuid("deputation_id"),
  consolidatedMonthlyMinor: bigint("consolidated_monthly_minor", { mode: "bigint" }),
  /** Deputation money terms approved with this profile (deputation profiles only). */
  deputationTerms:          jsonb("deputation_terms").$type<DeputationMoneyTerms>(),
  orderRef:                 varchar("order_ref", { length: 120 }),
  remarks:                  text("remarks"),
  requestedBy:              uuid("requested_by").notNull(),
  decidedBy:                uuid("decided_by"),
  decidedAt:                timestamp("decided_at", { withTimezone: true }),
  decisionNote:             varchar("decision_note", { length: 500 }),
  createdAt:                timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:                uuid("created_by").notNull(),
  updatedBy:                uuid("updated_by").notNull(),
  version:                  integer("version").notNull().default(1),
});

export type PayProfileDbRow = typeof hrmsPayProfiles.$inferSelect;
export type PayProfileInsert = typeof hrmsPayProfiles.$inferInsert;
