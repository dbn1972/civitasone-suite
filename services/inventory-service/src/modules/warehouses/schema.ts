/**
 * warehouses module — canonical warehouse model for the unified inventory domain.
 *
 * Part of the stock-service / inventory-service unification (Req 14.1).
 * Warehouses represent the physical storage locations at a higher level than
 * stores (godowns/sub-stores). This is the canonical model that replaces
 * the stock-service `stock_warehouses` table.
 *
 * All tables are tenant-scoped with optimistic locking via `version`.
 */
import { pgSchema, uuid, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const warehouses = domainSchema.table("warehouses", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      varchar("name", { length: 200 }).notNull(),
  code:      varchar("code", { length: 64 }).notNull(),
  address:   varchar("address", { length: 512 }),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type WarehouseRow    = typeof warehouses.$inferSelect;
export type WarehouseInsert = typeof warehouses.$inferInsert;

export const schema = { warehouses };
