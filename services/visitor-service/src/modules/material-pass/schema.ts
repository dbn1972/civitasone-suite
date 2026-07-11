/**
 * visitor-service: material-pass Drizzle schema (migration 0004).
 *
 * Mirrors `services/visitor-service/migrations/0004_material_vehicle_passes.sql`
 * exactly (column names, types, defaults, nullability, checks) for
 * `visitor.material_passes`.
 *
 * `visitorSchema` is defined here via its own `pgSchema("visitor")` call —
 * per the established CivitasOne pattern, multiple module `schema.ts` files
 * each call `pgSchema("visitor")` independently (see e.g.
 * `modules/digital-pass/schema.ts`); Drizzle treats same-named `pgSchema()`
 * calls as referring to the same Postgres schema.
 */
import { pgSchema, uuid, varchar, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const visitorSchema = pgSchema("visitor");

export const materialPasses = visitorSchema.table("material_passes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  passId: uuid("pass_id").notNull(),
  locationId: uuid("location_id").notNull(),
  itemDescription: text("item_description").notNull(),
  serialNumber: varchar("serial_number", { length: 64 }),
  quantity: integer("quantity").notNull().default(1),
  direction: varchar("direction", { length: 4 }).notNull(),
  // direction: in | out
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  discrepancy: boolean("discrepancy").notNull().default(false),
  incidentId: uuid("incident_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type MaterialPassRow = typeof materialPasses.$inferSelect;
export type MaterialPassInsert = typeof materialPasses.$inferInsert;

export const schema = { materialPasses };
