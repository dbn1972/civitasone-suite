/**
 * Trade License schema — municipal trade/business licenses.
 *
 * PG schema: "revenue" (same as rate_heads, to avoid migration complexity).
 * _Requirements: SVC-TL-01_
 */
import { pgSchema, uuid, text, varchar, timestamp, integer, boolean, date } from "drizzle-orm/pg-core";

export const tradeLicenseSchema = pgSchema("revenue");

export const tradeLicenses = tradeLicenseSchema.table("trade_licenses", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  licenseNo:      varchar("license_no", { length: 64 }).notNull(),
  businessName:   text("business_name").notNull(),
  proprietorName: text("proprietor_name").notNull(),
  address:        text("address").notNull(),
  wardNo:         varchar("ward_no", { length: 16 }),
  businessType:   varchar("business_type", { length: 64 }).notNull(), // retail, manufacturing, service, hawker
  category:       varchar("category", { length: 32 }).notNull().default("A"), // A, B, C
  issuedDate:     date("issued_date"),
  expiryDate:     date("expiry_date"),
  status:         varchar("status", { length: 32 }).notNull().default("pending"), // pending, active, suspended, cancelled, expired
  feeMinor:       text("fee_minor").notNull().default("0"), // paise as text (bigint)
  feePaidMinor:   text("fee_paid_minor").notNull().default("0"),
  renewalCount:   integer("renewal_count").notNull().default(0),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type TradeLicenseRow = typeof tradeLicenses.$inferSelect;
export type TradeLicenseInsert = typeof tradeLicenses.$inferInsert;
export const schema = { tradeLicenses };

// ── revenue.waivers ───────────────────────────────────────────────────────────
export const waivers = tradeLicenseSchema.table('waivers', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull(),
  demandId:        uuid('demand_id').notNull(),
  amountMinor:     text('amount_minor').notNull(),
  reason:          text('reason').notNull(),
  status:          varchar('status', { length: 32 }).notNull().default('pending'),
  requestedBy:     uuid('requested_by').notNull(),
  decidedBy:       uuid('decided_by'),
  decidedAt:       timestamp('decided_at', { withTimezone: true }),
  decisionRemarks: text('decision_remarks'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WaiverRow = typeof waivers.$inferSelect;
export type WaiverInsert = typeof waivers.$inferInsert;
