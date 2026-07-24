/**
 * Assessee (subject) master schema — property/water connection owners.
 *
 * PG schema: `assessee`
 * _Requirements: SVC-131_
 */
import {
  pgSchema, uuid, text, integer, varchar, timestamp, bigint, boolean,
} from "drizzle-orm/pg-core";

export const assesseeSchema = pgSchema("assessee");

export const assessees = assesseeSchema.table("assessees", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeType:   varchar("assessee_type", { length: 32 }).notNull(), // property, water_connection
  identifierNo:   varchar("identifier_no", { length: 64 }).notNull(), // property ID / connection no
  ownerName:      text("owner_name").notNull(),
  address:        text("address").notNull(),
  wardNo:         varchar("ward_no", { length: 16 }),
  zoneNo:         varchar("zone_no", { length: 16 }),
  connectionSize: varchar("connection_size", { length: 16 }), // water: 0.5", 0.75", 1"
  propertyType:   varchar("property_type", { length: 32 }), // residential, commercial, industrial
  builtUpArea:    bigint("built_up_area", { mode: "bigint" }), // sq ft
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type AssesseeRow = typeof assessees.$inferSelect;
export type AssesseeInsert = typeof assessees.$inferInsert;

export const schema = { assessees };
