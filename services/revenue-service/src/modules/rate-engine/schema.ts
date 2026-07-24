/**
 * Rate Engine schema — configurable rate heads, slabs, penalty rules, rebate rules.
 *
 * PG schema: `rates`
 * _Requirements: SVC-136_
 */
import {
  pgSchema, uuid, text, integer, varchar, timestamp, date, bigint, boolean,
} from "drizzle-orm/pg-core";

export const ratesSchema = pgSchema("rates");

// ── rates.rate_heads ──────────────────────────────────────────────────────────
export const rateHeads = ratesSchema.table("rate_heads", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  code:         varchar("code", { length: 64 }).notNull(),
  name:         text("name").notNull(),
  category:     varchar("category", { length: 64 }).notNull(), // property_tax, water, sewerage
  unitOfMeasure: varchar("unit_of_measure", { length: 32 }),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

// ── rates.rate_slabs ──────────────────────────────────────────────────────────
export const rateSlabs = ratesSchema.table("rate_slabs", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  rateHeadId:   uuid("rate_head_id").notNull(),
  slabType:     varchar("slab_type", { length: 16 }).notNull(), // flat, band, ad_valorem
  bandFrom:     bigint("band_from", { mode: "bigint" }),
  bandTo:       bigint("band_to", { mode: "bigint" }),
  rateValue:    bigint("rate_value", { mode: "bigint" }).notNull(), // paise or bps depending on slabType
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo:  date("effective_to"),
  unitOfMeasure: varchar("unit_of_measure", { length: 32 }),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

// ── rates.penalty_rules ───────────────────────────────────────────────────────
export const penaltyRules = ratesSchema.table("penalty_rules", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  rateHeadId:   uuid("rate_head_id").notNull(),
  interestType: varchar("interest_type", { length: 16 }).notNull(), // simple, compound
  annualRateBps: integer("annual_rate_bps").notNull(), // basis points
  graceDays:    integer("grace_days").notNull().default(0),
  capMonths:    integer("cap_months"), // null = uncapped
  roundingMode: varchar("rounding_mode", { length: 16 }).notNull().default("round_half_up"),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

// ── rates.rebate_rules ────────────────────────────────────────────────────────
export const rebateRules = ratesSchema.table("rebate_rules", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  rateHeadId:   uuid("rate_head_id").notNull(),
  rebateType:   varchar("rebate_type", { length: 24 }).notNull(), // early_payment, category
  discountBps:  integer("discount_bps").notNull(), // basis points
  validUntilDaysBeforeDue: integer("valid_until_days_before_due"),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────────
export type RateHeadRow = typeof rateHeads.$inferSelect;
export type RateHeadInsert = typeof rateHeads.$inferInsert;
export type RateSlabRow = typeof rateSlabs.$inferSelect;
export type RateSlabInsert = typeof rateSlabs.$inferInsert;
export type PenaltyRuleRow = typeof penaltyRules.$inferSelect;
export type PenaltyRuleInsert = typeof penaltyRules.$inferInsert;
export type RebateRuleRow = typeof rebateRules.$inferSelect;
export type RebateRuleInsert = typeof rebateRules.$inferInsert;

export const schema = { rateHeads, rateSlabs, penaltyRules, rebateRules };
