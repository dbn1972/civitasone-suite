import { pgSchema, uuid, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("analytics");

export type DashboardLayout = Record<string, unknown>;

export const dashboards = domainSchema.table("dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  ownerId: uuid("owner_id"),
  visibility: varchar("visibility", { length: 16 }).notNull().default("private"), // private | shared
  layout: jsonb("layout").$type<DashboardLayout>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const dashboardWidgets = domainSchema.table("dashboard_widgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  dashboardId: uuid("dashboard_id").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  vizType: varchar("viz_type", { length: 24 }).notNull().default("table"), // table | bar | line | stat
  spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const dashboardShares = domainSchema.table("dashboard_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  dashboardId: uuid("dashboard_id").notNull(),
  principalId: uuid("principal_id").notNull(),
  access: varchar("access", { length: 16 }).notNull().default("view"), // view | edit
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type DashboardRow = typeof dashboards.$inferSelect;
export type DashboardInsert = typeof dashboards.$inferInsert;
export type WidgetRow = typeof dashboardWidgets.$inferSelect;
export type WidgetInsert = typeof dashboardWidgets.$inferInsert;
export type ShareRow = typeof dashboardShares.$inferSelect;
export type ShareInsert = typeof dashboardShares.$inferInsert;

export type DashboardView = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  ownerId: string | null;
  visibility: string;
  layout: DashboardLayout;
  version: number;
};

export type WidgetView = {
  id: string;
  tenantId: string;
  dashboardId: string;
  title: string;
  vizType: string;
  spec: Record<string, unknown>;
  position: number;
  version: number;
};

export type ShareView = {
  id: string;
  dashboardId: string;
  principalId: string;
  access: string;
};

export const schema = { dashboards, dashboardWidgets, dashboardShares };
