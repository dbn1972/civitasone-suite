import { pgSchema, uuid, bigint, varchar, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const procurementSchema = pgSchema("procurement");

// Maps the deployed procurement.three_way_match shape exactly.
export const threeWayMatch = procurementSchema.table("three_way_match", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  poId:               uuid("po_id").notNull(),
  grnId:              uuid("grn_id").notNull(),
  invoiceId:          uuid("invoice_id"),
  poAmountMinor:      bigint("po_amount_minor", { mode: "bigint" }).notNull().default(0n),
  grnAmountMinor:     bigint("grn_amount_minor", { mode: "bigint" }).notNull().default(0n),
  invoiceAmountMinor: bigint("invoice_amount_minor", { mode: "bigint" }),
  matchStatus:        varchar("match_status", { length: 16 }).notNull().default("pending"),
  variancePct:        numeric("variance_pct", { precision: 5, scale: 2 }),
  autoMatched:        boolean("auto_matched").notNull().default(false),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // DOM-011: applied thresholds + computed variances for the two new
  // independent axes, plus totalTolerancePct finally wiring up the
  // `tolerance_pct` column that has existed (unused) since 0006_world_class.sql
  // -- see migration 0033's comment. Nullable like variancePct: historical
  // rows predate these columns.
  qtyVariancePct:     numeric("qty_variance_pct", { precision: 5, scale: 2 }),
  priceVariancePct:   numeric("price_variance_pct", { precision: 5, scale: 2 }),
  qtyTolerancePct:    numeric("qty_tolerance_pct", { precision: 5, scale: 2 }),
  priceTolerancePct:  numeric("price_tolerance_pct", { precision: 5, scale: 2 }),
  totalTolerancePct:  numeric("tolerance_pct", { precision: 5, scale: 2 }).notNull().default("5.00"),
});

export type ThreeWayMatchRow    = typeof threeWayMatch.$inferSelect;
export type ThreeWayMatchInsert = typeof threeWayMatch.$inferInsert;

/**
 * DOM-011: per-tenant configurable match tolerance. `tenantId ===
 * '00000000-0000-0000-0000-000000000000'` is the platform-default sentinel
 * row (see migration 0033) -- architecture mirrors payroll-service's
 * statutory.statutory_config (DOM-008) exactly, minus effective-dating
 * (documented in the migration as a deliberate simplification, not an
 * oversight).
 */
export const threeWayMatchConfig = procurementSchema.table("three_way_match_config", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  qtyTolerancePct:   numeric("qty_tolerance_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  priceTolerancePct: numeric("price_tolerance_pct", { precision: 5, scale: 2 }).notNull().default("2"),
  totalTolerancePct: numeric("total_tolerance_pct", { precision: 5, scale: 2 }).notNull().default("5"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:         uuid("updated_by").notNull(),
});

export type ThreeWayMatchConfigRow    = typeof threeWayMatchConfig.$inferSelect;
export type ThreeWayMatchConfigInsert = typeof threeWayMatchConfig.$inferInsert;

export const schema = { threeWayMatch, threeWayMatchConfig };
