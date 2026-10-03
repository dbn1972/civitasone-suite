import { pgSchema, uuid, varchar, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

const employeeSchema = pgSchema("employee");

// Migration 0186. One row per (tenant, key); no row == the registry default.
export const hrmsPolicySettings = employeeSchema.table("hrms_policy_settings", {
  tenantId:  uuid("tenant_id").notNull(),
  key:       varchar("key", { length: 64 }).notNull(),
  value:     jsonb("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});
