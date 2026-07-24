/**
 * Collection schema — receipts, refunds, adjustments.
 *
 * PG schema: `collection`
 * _Requirements: SVC-133, SVC-135_
 */
import {
  pgSchema, uuid, text, integer, varchar, timestamp, bigint, boolean,
} from "drizzle-orm/pg-core";

export const collectionSchema = pgSchema("collection");

// ── collection.receipts ───────────────────────────────────────────────────────
export const receipts = collectionSchema.table("receipts", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  demandId:       uuid("demand_id").notNull(),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull(),
  channel:        varchar("channel", { length: 16 }).notNull(), // online, counter, cheque, dd, pos
  reference:      text("reference"), // UTR / transaction ref
  instrumentNo:   varchar("instrument_no", { length: 64 }),
  bankName:       varchar("bank_name", { length: 128 }),
  receiptNo:      varchar("receipt_no", { length: 32 }),
  status:         varchar("status", { length: 16 }).notNull().default("captured"), // captured, reconciled, reversed
  reconciled:     boolean("reconciled").notNull().default(false),
  reconciledAt:   timestamp("reconciled_at", { withTimezone: true }),
  reconLineId:    uuid("recon_line_id"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ── collection.refunds ────────────────────────────────────────────────────────
export const refunds = collectionSchema.table("refunds", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  receiptId:      uuid("receipt_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull(),
  reason:         text("reason").notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("pending"), // pending, approved, rejected, processed
  makerUserId:    uuid("maker_user_id").notNull(),
  checkerUserId:  uuid("checker_user_id"),
  decidedAt:      timestamp("decided_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:        integer("version").notNull().default(1),
});

// ── collection.adjustments ────────────────────────────────────────────────────
export const adjustments = collectionSchema.table("adjustments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  fromDemandId:   uuid("from_demand_id").notNull(),
  toDemandId:     uuid("to_demand_id").notNull(),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull(),
  reason:         text("reason").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type ReceiptRow = typeof receipts.$inferSelect;
export type ReceiptInsert = typeof receipts.$inferInsert;
export type RefundRow = typeof refunds.$inferSelect;
export type RefundInsert = typeof refunds.$inferInsert;
export type AdjustmentRow = typeof adjustments.$inferSelect;
export type AdjustmentInsert = typeof adjustments.$inferInsert;

export const schema = { receipts, refunds, adjustments };
