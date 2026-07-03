import { pgSchema, uuid, varchar, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";

export const pincodeSchema = pgSchema("pincode");

// Global reference data — no tenantId (shared across all tenants).
// Pincodes are sourced from India Post and serve as a read-only lookup for all tenants.
export const pincodes = pincodeSchema.table("pincodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  pincode: varchar("pincode", { length: 6 }).notNull(),
  postOffice: varchar("post_office", { length: 200 }).notNull(),
  district: varchar("district", { length: 120 }).notNull(),
  state: varchar("state", { length: 120 }).notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type PincodeRow = typeof pincodes.$inferSelect;
export type PincodeInsert = typeof pincodes.$inferInsert;

export type PincodeView = {
  id: string;
  pincode: string;
  postOffice: string;
  district: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
};

export const schema = { pincodes };
