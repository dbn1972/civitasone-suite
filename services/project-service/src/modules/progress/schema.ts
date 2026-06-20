import { pgSchema, uuid, text, integer, bigint, char, varchar, numeric, timestamp, date, jsonb } from "drizzle-orm/pg-core";

export const progressSchema = pgSchema("progress");

export const projectPhysicalProgress = progressSchema.table("project_physical_progress", {
  id:             uuid("id").primaryKey().defaultRandom(),
  projectId:      uuid("project_id").notNull(),
  componentId:    uuid("component_id"),
  tenantId:       uuid("tenant_id").notNull(),
  periodDate:     date("period_date").notNull(),
  physicalPct:    numeric("physical_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  cumulativePct:  numeric("cumulative_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  reportedBy:     uuid("reported_by").notNull(),
  notes:          text("notes"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const projectFinancialProgress = progressSchema.table("project_financial_progress", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  projectId:          uuid("project_id").notNull(),
  tenantId:           uuid("tenant_id").notNull(),
  periodDate:         date("period_date").notNull(),
  expenditureMinor:   bigint("expenditure_minor", { mode: "bigint" }).notNull().default(0n),
  cumulativeMinor:    bigint("cumulative_minor", { mode: "bigint" }).notNull().default(0n),
  currency:           char("currency", { length: 3 }).notNull().default("INR"),
  reportedBy:         uuid("reported_by").notNull(),
  notes:              text("notes"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

export const projectDprs = progressSchema.table("project_dprs", {
  id:           uuid("id").primaryKey().defaultRandom(),
  projectId:    uuid("project_id").notNull(),
  tenantId:     uuid("tenant_id").notNull(),
  dprNo:        text("dpr_no").notNull(),
  dprDate:      date("dpr_date").notNull(),
  status:       varchar("status", { length: 24 }).notNull().default("submitted"),
  content:      jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
  submittedBy:  uuid("submitted_by").notNull(),
  submittedAt:  timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type PhysicalProgressRow    = typeof projectPhysicalProgress.$inferSelect;
export type PhysicalProgressInsert = typeof projectPhysicalProgress.$inferInsert;
export type FinancialProgressRow   = typeof projectFinancialProgress.$inferSelect;
export type DprRow                 = typeof projectDprs.$inferSelect;
export type DprInsert              = typeof projectDprs.$inferInsert;

export const schema = { projectPhysicalProgress, projectFinancialProgress, projectDprs };
