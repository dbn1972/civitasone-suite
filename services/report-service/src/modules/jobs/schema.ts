/**
 * jobs module — Drizzle schema in Postgres schema `reports`.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type JobRow = typeof jobs.$inferSelect;
export type JobInsert = typeof jobs.$inferInsert;

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
  downloadUrl: string | null;
  version: number;
};

export const schema = { jobs };
