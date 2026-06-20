import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp } from "drizzle-orm/pg-core";

export const paymentsSchema = pgSchema("payments");

export const procurementAdvances = paymentsSchema.table("procurement_advances", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  poRef:         text("po_ref").notNull(),
  vendorId:      uuid("vendor_id").notNull(),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  advanceType:   varchar("advance_type", { length: 32 }).notNull().default("mobilisation"),
  status:        varchar("status", { length: 24 }).notNull().default("pending"),
  recoveryMinor: bigint("recovery_minor", { mode: "bigint" }).notNull().default(0n),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const procurementDebitNotes = paymentsSchema.table("procurement_debit_notes", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  grnRef:      text("grn_ref").notNull(),
  vendorId:    uuid("vendor_id").notNull(),
  reason:      text("reason").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  status:      varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type AdvanceRow    = typeof procurementAdvances.$inferSelect;
export type AdvanceInsert = typeof procurementAdvances.$inferInsert;

export const schema = { procurementAdvances, procurementDebitNotes };
