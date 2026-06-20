import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp,
} from "drizzle-orm/pg-core";

export const maintenanceSchema = pgSchema("maintenance");

export const assetMaintenancePlans = maintenanceSchema.table("asset_maintenance_plans", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  assetId:     uuid("asset_id").notNull(),
  frequency:   varchar("frequency", { length: 16 }).notNull().default("monthly"),
  nextDue:     date("next_due"),
  lastDone:    date("last_done"),
  description: text("description"),
  status:      varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const assetWorkOrders = maintenanceSchema.table("asset_work_orders", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  assetId:       uuid("asset_id").notNull(),
  planId:        uuid("plan_id"),
  scheduledDate: date("scheduled_date").notNull(),
  completedDate: date("completed_date"),
  status:        varchar("status", { length: 16 }).notNull().default("open"),
  costMinor:     bigint("cost_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type MaintenancePlanRow    = typeof assetMaintenancePlans.$inferSelect;
export type MaintenancePlanInsert = typeof assetMaintenancePlans.$inferInsert;
export type WorkOrderRow          = typeof assetWorkOrders.$inferSelect;
export type WorkOrderInsert       = typeof assetWorkOrders.$inferInsert;

export const schema = { assetMaintenancePlans, assetWorkOrders };
