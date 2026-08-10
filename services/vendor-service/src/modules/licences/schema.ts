import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const vendorSchema = pgSchema("vendor");

export const vendorLicences = vendorSchema.table("vendor_licences", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  licenceNumber: varchar("licence_number", { length: 64 }).notNull().unique(),
  registrationId: uuid("registration_id").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  zone: text("zone"),
  spotNumber: text("spot_number"),
  verificationCode: varchar("verification_code", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type VendorLicenceRow = typeof vendorLicences.$inferSelect;
export type VendorLicenceInsert = typeof vendorLicences.$inferInsert;

export const schema = { vendorLicences };
