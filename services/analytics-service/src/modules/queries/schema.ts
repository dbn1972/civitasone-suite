import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
export const domainSchema = pgSchema("analytics");
export const queryRuns = domainSchema.table("query_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  dashboardId: uuid("dashboard_id"),
  queryName: varchar("query_name", { length: 200 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("running"),
  resultRows: integer("result_rows").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});
export type QueryRunRow = typeof queryRuns.$inferSelect;
export type QueryRunInsert = typeof queryRuns.$inferInsert;
export type QueryRunView = { id: string; tenantId: string; dashboardId: string | null; queryName: string; status: string; resultRows: number; version: number };
export const schema = { queryRuns };
