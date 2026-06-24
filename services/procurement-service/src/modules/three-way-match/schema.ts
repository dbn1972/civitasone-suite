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
});

export type ThreeWayMatchRow    = typeof threeWayMatch.$inferSelect;
export type ThreeWayMatchInsert = typeof threeWayMatch.$inferInsert;

export const schema = { threeWayMatch };
