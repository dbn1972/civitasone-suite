/**
 * matching module — Drizzle schema for three-way match records.
 *
 * Records the outcome of PO × GRN × Invoice verification, including
 * variance details and payment authorization status.
 *
 * All money is stored as bigint paise. Every table is tenant-scoped with
 * optimistic locking via `version`.
 */
import { pgSchema, uuid, varchar, integer, bigint, timestamp, text, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const threeWayMatches = domainSchema.table("three_way_matches", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  poId:              uuid("po_id").notNull(),
  poLineId:          uuid("po_line_id"),
  grnId:             uuid("grn_id").notNull(),
  invoiceId:         uuid("invoice_id").notNull(),
  poQty:             integer("po_qty").notNull(),
  poRatePaise:       bigint("po_rate_paise", { mode: "bigint" }).notNull(),
  grnQty:            integer("grn_qty").notNull(),
  invoiceQty:        integer("invoice_qty").notNull(),
  invoiceRatePaise:  bigint("invoice_rate_paise", { mode: "bigint" }).notNull(),
  status:            varchar("status", { length: 32 }).notNull().default("pending"),
  paymentBlocked:    integer("payment_blocked").notNull().default(0),
  tolerancePct:      integer("tolerance_pct").notNull().default(5),
  toleranceAbsPaise: bigint("tolerance_abs_paise", { mode: "bigint" }),
  qtyVariances:      jsonb("qty_variances"),
  rateVariances:     jsonb("rate_variances"),
  summary:           text("summary"),
  resolvedBy:        uuid("resolved_by"),
  resolvedAt:        timestamp("resolved_at", { withTimezone: true }),
  resolutionNote:    text("resolution_note"),
  createdBy:         uuid("created_by").notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export type ThreeWayMatchRow = typeof threeWayMatches.$inferSelect;
export type ThreeWayMatchInsert = typeof threeWayMatches.$inferInsert;

export const schema = { threeWayMatches };
