import { pgSchema, uuid, text, bigint, char, varchar, timestamp, date, integer } from "drizzle-orm/pg-core";

export const securitySchema = pgSchema("security");

// EMD / bid-security: collect → (forfeit | refund).
export const procurementEmd = securitySchema.table("procurement_emd", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  emdNo:         text("emd_no").notNull(),
  tenderId:      uuid("tender_id"),
  bidId:         uuid("bid_id"),
  vendorId:      uuid("vendor_id").notNull(),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  instrument:    varchar("instrument", { length: 24 }).notNull().default("bank_guarantee"),
  status:        varchar("status", { length: 16 }).notNull().default("collected"),
  forfeitReason: text("forfeit_reason"),
  collectedAt:   timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt:    timestamp("resolved_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

// Performance security (PBG): active → (forfeit | release). Collected on award.
export const procurementPbg = securitySchema.table("procurement_pbg", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  pbgNo:         text("pbg_no").notNull(),
  poRef:         text("po_ref"),
  tenderId:      uuid("tender_id"),
  vendorId:      uuid("vendor_id").notNull(),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  instrument:    varchar("instrument", { length: 24 }).notNull().default("bank_guarantee"),
  validUntil:    date("valid_until"),
  status:        varchar("status", { length: 16 }).notNull().default("active"),
  forfeitReason: text("forfeit_reason"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt:    timestamp("resolved_at", { withTimezone: true }),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type EmdRow    = typeof procurementEmd.$inferSelect;
export type EmdInsert = typeof procurementEmd.$inferInsert;
export type PbgRow    = typeof procurementPbg.$inferSelect;
export type PbgInsert = typeof procurementPbg.$inferInsert;

export const schema = { procurementEmd, procurementPbg };
