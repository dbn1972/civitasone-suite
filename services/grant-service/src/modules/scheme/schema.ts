import {
  pgSchema, uuid, text, varchar, char, bigint, integer, timestamp, boolean,
} from "drizzle-orm/pg-core";
// NOTE: boolean imported but not yet used below — retained for future schema additions

export const schemeSchema = pgSchema("scheme");

export const grantSchemes = schemeSchema.table("grant_schemes", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  code:            text("code").notNull(),
  name:            text("name").notNull(),
  sanctionRef:     text("sanction_ref"),          // opaque "finance_sanction:UUID"
  budgetMinor:     bigint("budget_minor", { mode: "bigint" }).notNull().default(0n),
  disbursedMinor:  bigint("disbursed_minor", { mode: "bigint" }).notNull().default(0n),
  minAmountMinor:  bigint("min_amount_minor", { mode: "bigint" }).notNull().default(0n),
  maxAmountMinor:  bigint("max_amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  status:                 varchar("status", { length: 24 }).notNull().default("draft"),
  reportingFrequencyDays: integer("reporting_frequency_days").default(90),  // Quarterly=90, Half-yearly=180, Annual=365
  openAt:                 timestamp("open_at", { withTimezone: true }),
  closeAt:                timestamp("close_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const grantEligibilityCriteria = schemeSchema.table("grant_eligibility_criteria", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  schemeId:       uuid("scheme_id").notNull(),
  criterionKey:   varchar("criterion_key", { length: 32 }).notNull(), // age|income|category|geography
  minValue:       text("min_value"),
  maxValue:       text("max_value"),
  allowedValues:  text("allowed_values").array(),
  description:    text("description"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type SchemeRow    = typeof grantSchemes.$inferSelect;
export type SchemeInsert = typeof grantSchemes.$inferInsert;
export type CriterionRow    = typeof grantEligibilityCriteria.$inferSelect;
export type CriterionInsert = typeof grantEligibilityCriteria.$inferInsert;

export const schema = { grantSchemes, grantEligibilityCriteria };
