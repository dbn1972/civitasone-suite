/**
 * jobs module — Drizzle schema in Postgres schema `reports`.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("reports");

export const jobs = domainSchema.table("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  reportType: varchar("report_type", { length: 64 }),
  status: varchar("status", { length: 24 }).notNull().default("queued"),
  format: varchar("format", { length: 16 }).notNull().default("pdf"),
  rowCount: integer("row_count"),
  requestedBy: uuid("requested_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  downloadUrl: varchar("download_url", { length: 1024 }),
  // Migration 0020: what the job detail screen shows.
  parameters: jsonb("parameters").$type<Record<string, string>>().notNull().default({}),
  resultColumns: jsonb("result_columns").$type<string[]>().notNull().default([]),
  resultRows: jsonb("result_rows").$type<Array<Record<string, string>>>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type JobRow = typeof jobs.$inferSelect;
export type JobInsert = typeof jobs.$inferInsert;

/** Job + the stored detail payload (GET /v1/reports/report-jobs/:id). */
export type JobDetailView = JobView & {
  parameters: Record<string, string>;
  resultColumns: string[];
  resultRows: Array<Record<string, string>>;
};

export type JobView = {
  id: string;
  tenantId: string;
  name: string;
  reportType: string | null;
  status: string;
  format: string;
  rowCount: number | null;
  requestedBy: string | null;
  completedAt: Date | null;
  createdAt: Date;
  downloadUrl: string | null;
  /** Optional request parameters (create path only; stored in reports.jobs.parameters). */
  parameters?: Record<string, string>;
  version: number;
};

export const schema = { jobs };
