/**
 * order — Drizzle table definitions.
 *
 * This table lives in the `court` PostgreSQL schema and mirrors, column-for-column,
 * the DDL created by migrations/0001_court_core.sql (base columns) plus the
 * issuance-workflow columns added by migrations/0007_court_order_issuance.sql.
 *
 * Scope: orders. dsc_signature holds the detached Digital Signature Certificate
 * signature blob for the signed order.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 *
 * Issuance workflow (§23 + §35.5 "AI never auto-issues"): status, approvedBy,
 * issuedAt, recallReason implement the maker-checker approval + DSC pronouncement
 * lifecycle (draft → pending_approval → issued → recalled). The approver
 * (approvedBy) is HARD-enforced to differ from the maker (createdBy / signedBy)
 * in the order-issuance consumer; issuance is a human, DSC-signed act.
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
  // ── Issuance workflow (0007_court_order_issuance.sql) ──────────────────────────
  // status: draft | pending_approval | issued | recalled. approvedBy is the checker
  // (enforced ≠ maker). issuedAt stamps the DSC pronouncement instant. recallReason
  // records why an issued order was recalled.
  status:       varchar("status", { length: 24 }).notNull().default("draft"),
  approvedBy:   uuid("approved_by"),
  issuedAt:     timestamp("issued_at", { withTimezone: true }),
  recallReason: text("recall_reason"),
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
