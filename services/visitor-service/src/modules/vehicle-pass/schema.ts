/**
 * visitor-service: vehicle-pass Drizzle schema (migration 0004).
 *
 * Mirrors `services/visitor-service/migrations/0004_material_vehicle_passes.sql`
 * exactly (column names, types, defaults, nullability, checks) for
 * `visitor.vehicle_passes`.
 *
 * `driverName` is an encrypted PII column (nullable) — stored as TEXT holding
 * the AES-256-GCM ciphertext envelope produced by `encryptedText()`, matching
 * the convention used elsewhere in this schema (e.g.
 * `visitor.visit_requests` visitorName/visitorPhone) per DPDP Requirement
 * 18.2.
 *
 * `visitorSchema` is defined here via its own `pgSchema("visitor")` call —
 * per the established CivitasOne pattern, multiple module `schema.ts` files
 * each call `pgSchema("visitor")` independently (see e.g.
 * `modules/digital-pass/schema.ts`); Drizzle treats same-named `pgSchema()`
 * calls as referring to the same Postgres schema.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const visitorSchema = pgSchema("visitor");

export const vehiclePasses = visitorSchema.table("vehicle_passes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  passId: uuid("pass_id").notNull(),
  locationId: uuid("location_id").notNull(),
  registrationNumber: varchar("registration_number", { length: 20 }).notNull(),
  vehicleType: varchar("vehicle_type", { length: 16 }).notNull(),
  // vehicle_type: two_wheeler | car | suv | bus | truck
  driverName: encryptedText("driver_name"), // encrypted PII, nullable
  parkingSlotId: uuid("parking_slot_id"),
  status: varchar("status", { length: 12 }).notNull().default("active"),
  // status: active | checked_in | checked_out | expired
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type VehiclePassRow = typeof vehiclePasses.$inferSelect;
export type VehiclePassInsert = typeof vehiclePasses.$inferInsert;

export const schema = { vehiclePasses };
