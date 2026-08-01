import { uuid, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { helpdeskSchema } from "../tickets/schema.js";

export const categories = helpdeskSchema.table("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  parentId: uuid("parent_id"),
  ordinal: integer("ordinal").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type CategoryRow = typeof categories.$inferSelect;
export type CategoryInsert = typeof categories.$inferInsert;
