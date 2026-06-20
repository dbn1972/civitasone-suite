import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
export const domainSchema = pgSchema("analytics");
export const dashboards = domainSchema.table("dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});
export type DashboardRow = typeof dashboards.$inferSelect;
export type DashboardView = { id: string; tenantId: string; name: string; description: string | null; status: string; version: number };
export const schema = { dashboards };
