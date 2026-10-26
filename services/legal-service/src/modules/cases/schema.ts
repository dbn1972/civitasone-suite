import { pgSchema, uuid, text, integer, varchar, timestamp, date, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const casesSchema = pgSchema("cases");

export const legalCaseTypes = casesSchema.table("legal_case_types", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  code:      text("code").notNull(),
  name:      text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const legalCases = casesSchema.table("legal_cases", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  caseNo:     text("case_no").notNull(),
  title:      text("title").notNull(),
  court:      text("court").notNull(),
  // Owner decision #10: court-master code ('other' = free text), verified flag, filing date, department id (org hierarchy).
  courtCode:     text("court_code"),
  courtVerified: boolean("court_verified").notNull().default(false),
  filingDate:    date("filing_date"),
  departmentId:  uuid("department_id"),
  subject:    text("subject"),
  caseTypeId: uuid("case_type_id"),
  petitioner: text("petitioner"),
  counselRef: text("counsel_ref"),
  // Owner decision #8 (GAP-LEGAL-HEARINGS-05): the officers a case is assigned to;
  // reminder notifications go to them (creator cc'd).
  assignedOfficerIds: uuid("assigned_officer_ids").array().notNull().default(sql`'{}'::uuid[]`),
  status:     varchar("status", { length: 24 }).notNull().default("pending"),
  nextDate:   date("next_date"),
  disposition: text("disposition"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const legalParties = casesSchema.table("legal_parties", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  caseId:    uuid("case_id").notNull(),
  name:      text("name").notNull(),
  role:      varchar("role", { length: 32 }).notNull().default("respondent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type CaseRow = typeof legalCases.$inferSelect;
export type CaseInsert = typeof legalCases.$inferInsert;
export const schema = { legalCaseTypes, legalCases, legalParties };
