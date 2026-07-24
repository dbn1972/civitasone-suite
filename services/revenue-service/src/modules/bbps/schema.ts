/**
 * BBPS Biller adapter schema — biller registration & transaction log.
 *
 * PG schema: `bbps`
 * _Requirements: SVC-134_
 */
import {
  pgSchema, uuid, text, integer, varchar, timestamp, bigint, boolean,
} from "drizzle-orm/pg-core";

export const bbpsSchema = pgSchema("bbps");

export const billerConfig = bbpsSchema.table("biller_config", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  billerCode:     varchar("biller_code", { length: 32 }).notNull(),
  billerName:     text("biller_name").notNull(),
  billerCategory: varchar("biller_category", { length: 32 }).notNull(), // municipal_tax, water
  apiEndpoint:    text("api_endpoint"),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version:        integer("version").notNull().default(1),
});

export const bbpsTransactions = bbpsSchema.table("bbps_transactions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  bbpsTxnId:      varchar("bbps_txn_id", { length: 64 }).notNull(),
  assesseeId:     uuid("assessee_id"),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull(),
  channel:        varchar("channel", { length: 16 }).notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("pending"), // pending, success, failed
  receiptId:      uuid("receipt_id"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:        integer("version").notNull().default(1),
});

export type BillerConfigRow = typeof billerConfig.$inferSelect;
export type BbpsTransactionRow = typeof bbpsTransactions.$inferSelect;

export const schema = { billerConfig, bbpsTransactions };
