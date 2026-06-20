import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const pluginSchema = pgSchema("plugin");

export const items = pluginSchema.table("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  semver: varchar("semver", { length: 32 }).notNull(),
  description: varchar("description", { length: 500 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ItemRow = typeof items.$inferSelect;
export type ItemInsert = typeof items.$inferInsert;

export type ItemView = {
  id: string;
  tenantId: string;
  name: string;
  semver: string;
  description: string | null;
  status: string;
  version: number;
};

export const schema = { items };
