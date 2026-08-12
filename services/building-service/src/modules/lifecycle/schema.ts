import { pgSchema, uuid, varchar, integer, bigint, boolean, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const buildingSchema = pgSchema("building");

export const buildingCertificates = buildingSchema.table("building_certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  permitId: uuid("permit_id").notNull(),
  certType: varchar("cert_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("issued"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  inspectionReport: jsonb("inspection_report").$type<Record<string, unknown>>(),
  verificationCode: varchar("verification_code", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const buildingRenewals = buildingSchema.table("building_renewals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  permitId: uuid("permit_id").notNull(),
  renewalType: varchar("renewal_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("submitted"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  feeCurrency: varchar("fee_currency", { length: 3 }).notNull().default("INR"),
  previousValidUntil: timestamp("previous_valid_until", { withTimezone: true }),
  newValidUntil: timestamp("new_valid_until", { withTimezone: true }),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BuildingCertificateRow = typeof buildingCertificates.$inferSelect;
export type BuildingCertificateInsert = typeof buildingCertificates.$inferInsert;
export type BuildingRenewalRow = typeof buildingRenewals.$inferSelect;
export type BuildingRenewalInsert = typeof buildingRenewals.$inferInsert;

export const schema = { buildingCertificates, buildingRenewals };
