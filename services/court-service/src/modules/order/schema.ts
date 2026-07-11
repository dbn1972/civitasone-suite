/**
 * order — Drizzle table definitions.
 *
 * This table lives in the `court` PostgreSQL schema and mirrors, column-for-column,
 * the DDL created by migrations/0001_court_core.sql.
 *
 * Scope: orders. dsc_signature holds the detached Digital Signature Certificate
 * signature blob for the signed order.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, text, integer, date, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Orders ────────────────────────────────────────────────────────────────────

export const orders = courtSchema.table("orders", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  caseId:       uuid("case_id").notNull(),
  hearingId:    uuid("hearing_id"),
  orderType:    varchar("order_type", { length: 32 }),
  orderText:    text("order_text"),
  signedBy:     uuid("signed_by"),
  dscSignature: text("dsc_signature"),
  orderDate:    date("order_date"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by"),
  updatedBy:    uuid("updated_by"),
  version:      integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type OrderRow    = typeof orders.$inferSelect;
export type OrderInsert = typeof orders.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const orderSchema = {
  orders,
};
