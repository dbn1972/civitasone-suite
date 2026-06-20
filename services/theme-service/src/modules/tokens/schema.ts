import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const themeSchema = pgSchema("theme");

export const tokens = themeSchema.table("tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  value: varchar("value", { length: 512 }).notNull(),
  category: varchar("category", { length: 64 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TokenRow = typeof tokens.$inferSelect;
export type TokenInsert = typeof tokens.$inferInsert;

export type TokenView = {
  id: string;
  tenantId: string;
  name: string;
  value: string;
  category: string | null;
  status: string;
  version: number;
};

export const schema = { tokens };
