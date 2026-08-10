import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const swmSchema = pgSchema("civitas_swm");

export const swmBulkGenerators = swmSchema.table("swm_bulk_generators", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  registrationNumber: varchar("registration_number", { length: 32 }).notNull(),
  generatorName: varchar("generator_name", { length: 128 }).notNull(),
  generatorType: varchar("generator_type", { length: 32 }).notNull(),
  address: jsonb("address").$type<Record<string, unknown>>(),
  estimatedWasteKgPerDay: integer("estimated_waste_kg_per_day"),
  category: varchar("category", { length: 16 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("registered"),
  feeMinor: integer("fee_minor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BulkGeneratorRow = typeof swmBulkGenerators.$inferSelect;
export type BulkGeneratorInsert = typeof swmBulkGenerators.$inferInsert;
export const schema = { swmBulkGenerators };
