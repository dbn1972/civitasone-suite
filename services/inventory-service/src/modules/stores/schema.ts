/**
 * stores module — physical store locations (godowns/sub-stores) that hold stock.
 * Stock balances and the ledger reference these stores.
 */
import { pgSchema, uuid, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const stores = domainSchema.table("stores", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      varchar("name", { length: 200 }).notNull(),
  code:      varchar("code", { length: 64 }).notNull(),
  location:  varchar("location", { length: 256 }),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type StoreRow    = typeof stores.$inferSelect;
export type StoreInsert = typeof stores.$inferInsert;

export const schema = { stores };
