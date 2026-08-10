import { pgSchema, uuid, varchar, integer, bigint, boolean, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const vendorSchema = pgSchema("vendor");

export const vendorRenewals = vendorSchema.table("vendor_renewals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  licenceId: uuid("licence_id").notNull(),
  renewalType: varchar("renewal_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("submitted"),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  feeCurrency: varchar("fee_currency", { length: 3 }).notNull().default("INR"),
  previousValidUntil: timestamp("previous_valid_until", { withTimezone: true }),
  newValidUntil: timestamp("new_valid_until", { withTimezone: true }),
  details: jsonb("details").$type<Record<string, unknown>>(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type VendorRenewalRow = typeof vendorRenewals.$inferSelect;
export type VendorRenewalInsert = typeof vendorRenewals.$inferInsert;

export const schema = { vendorRenewals };
