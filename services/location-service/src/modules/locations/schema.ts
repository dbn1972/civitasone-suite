import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const locationSchema = pgSchema("location");

export const locations = locationSchema.table("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  addressLine: varchar("address_line", { length: 500 }),
  city: varchar("city", { length: 120 }),
  postalCode: varchar("postal_code", { length: 16 }),
  // Branch-office hierarchy: self-referential parent (null = top-level / HQ).
  parentId: uuid("parent_id"),
  type: varchar("type", { length: 24 }).notNull().default("office"),
  lgdCode: varchar("lgd_code", { length: 32 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type LocationRow = typeof locations.$inferSelect;
export type LocationInsert = typeof locations.$inferInsert;

export type LocationView = {
  id: string;
  tenantId: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  parentId: string | null;
  type: string;
  lgdCode: string | null;
  status: string;
  version: number;
};

export const schema = { locations };
