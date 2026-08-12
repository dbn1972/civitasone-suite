import { pgSchema, uuid, varchar, integer, bigint, boolean, timestamp, jsonb, date } from "drizzle-orm/pg-core";

export const advPermitsSchema = pgSchema("adv_permits");

export const advPermits = advPermitsSchema.table("adv_permits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  permitNumber: varchar("permit_number", { length: 64 }).notNull().unique(),
  applicationId: uuid("application_id").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("issued"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  validFrom: date("valid_from"),
  validUntil: date("valid_until"),
  location: jsonb("location").$type<{
    lat?: number;
    lng?: number;
    address: string;
    ward?: string;
    zone?: string;
  }>().notNull(),
  advertisementType: varchar("advertisement_type", { length: 32 }).notNull(),
  verificationCode: varchar("verification_code", { length: 32 }).notNull().unique(),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: varchar("suspension_reason", { length: 512 }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: varchar("cancellation_reason", { length: 512 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const advRenewals = advPermitsSchema.table("adv_renewals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  permitId: uuid("permit_id").notNull(),
  renewalType: varchar("renewal_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  previousValidUntil: date("previous_valid_until"),
  newValidUntil: date("new_valid_until"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AdvPermitRow = typeof advPermits.$inferSelect;
export type AdvPermitInsert = typeof advPermits.$inferInsert;
export type AdvRenewalRow = typeof advRenewals.$inferSelect;
export type AdvRenewalInsert = typeof advRenewals.$inferInsert;

export const schema = { advPermits, advRenewals };
