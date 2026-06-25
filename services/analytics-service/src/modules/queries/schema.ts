import { pgSchema, uuid, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("analytics");

export const queryRuns = domainSchema.table("query_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  dashboardId: uuid("dashboard_id"),
  queryName: varchar("query_name", { length: 200 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("running"), // running | completed | failed
  kind: varchar("kind", { length: 16 }).notNull().default("adhoc"), // adhoc | scheduled
  spec: jsonb("spec").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  resultRows: integer("result_rows").notNull().default(0),
  error: varchar("error", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const scheduledQueries = domainSchema.table("scheduled_queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
  cadence: varchar("cadence", { length: 16 }).notNull().default("daily"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const exportJobs = domainSchema.table("export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  queryRunId: uuid("query_run_id"),
  format: varchar("format", { length: 8 }).notNull().default("csv"),
  status: varchar("status", { length: 16 }).notNull().default("queued"),
  rowCount: integer("row_count"),
  downloadUrl: varchar("download_url", { length: 1024 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type QueryRunRow = typeof queryRuns.$inferSelect;
export type QueryRunInsert = typeof queryRuns.$inferInsert;
export type ScheduledRow = typeof scheduledQueries.$inferSelect;
export type ScheduledInsert = typeof scheduledQueries.$inferInsert;
export type ExportRow = typeof exportJobs.$inferSelect;
export type ExportInsert = typeof exportJobs.$inferInsert;

export type QueryRunView = {
  id: string;
  tenantId: string;
  dashboardId: string | null;
  queryName: string;
  status: string;
  kind: string;
  spec: Record<string, unknown>;
  result: Record<string, unknown> | null;
  resultRows: number;
  error: string | null;
  version: number;
};

export type ScheduledView = {
  id: string;
  tenantId: string;
  name: string;
  spec: Record<string, unknown>;
  cadence: string;
  enabled: boolean;
  version: number;
};

export type ExportView = {
  id: string;
  tenantId: string;
  queryRunId: string | null;
  format: string;
  status: string;
  rowCount: number | null;
  downloadUrl: string | null;
  version: number;
};

export const schema = { queryRuns, scheduledQueries, exportJobs };
