import { pgSchema, uuid, varchar, integer, bigint, boolean, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const vendorSchema = pgSchema("vendor");

export const vendorRegistrations = vendorSchema.table("vendor_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  registrationNumber: varchar("registration_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  vendorName: varchar("vendor_name", { length: 256 }).notNull(),
  vendorAadhaar: varchar("vendor_aadhaar", { length: 12 }).notNull(),
  vendorPhone: varchar("vendor_phone", { length: 15 }).notNull(),
  vendorPhoto: text("vendor_photo"),
  category: varchar("category", { length: 32 }).notNull(),
  preferredZone: text("preferred_zone"),
  allocatedZone: text("allocated_zone"),
  allocatedSpot: text("allocated_spot"),
  documents: jsonb("documents").$type<Array<{ docType: string; fileId: string; uploadedAt: string }>>().notNull().default([]),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  feeCurrency: varchar("fee_currency", { length: 3 }).notNull().default("INR"),
  feePaid: boolean("fee_paid").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type VendorRegistrationRow = typeof vendorRegistrations.$inferSelect;
export type VendorRegistrationInsert = typeof vendorRegistrations.$inferInsert;

export const schema = { vendorRegistrations };
