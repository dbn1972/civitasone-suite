import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const marketSchema = pgSchema("market");

export const marketProperties = marketSchema.table("market_properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  propertyCode: text("property_code").notNull().unique(),
  marketName: text("market_name").notNull(),
  propertyType: varchar("property_type", { length: 32 }).notNull(),
  location: jsonb("location").$type<{ address?: string; ward?: string; zone?: string; lat?: number; lng?: number }>(),
  area: text("area"),
  areaUnit: varchar("area_unit", { length: 16 }).notNull().default("sqft"),
  floorNumber: integer("floor_number"),
  monthlyRentMinor: bigint("monthly_rent_minor", { mode: "bigint" }),
  // Added in the re-review pass: this is now the sole authoritative source for
  // an allotment's deposit (see allotments/routes.ts) — previously there was no
  // property-level deposit at all, so a citizen's self-declared
  // securityDepositMinor on POST /allotments went straight to the DB unchecked.
  // Safe to add now: market-service's first migration has not shipped yet.
  securityDepositMinor: bigint("security_deposit_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  status: varchar("status", { length: 32 }).notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PropertyRow = typeof marketProperties.$inferSelect;
export type PropertyInsert = typeof marketProperties.$inferInsert;

export const schema = { marketProperties };
