import { pgSchema, uuid, text, integer, varchar, timestamp, date } from "drizzle-orm/pg-core";

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
  subject:    text("subject"),
  caseTypeId: uuid("case_type_id"),
  petitioner: text("petitioner"),
  counselRef: text("counsel_ref"),
  status:     varchar("status", { length: 24 }).notNull().default("pending"),
  nextDate:   date("next_date"),
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
