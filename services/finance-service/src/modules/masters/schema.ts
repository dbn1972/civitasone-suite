import { pgSchema, uuid, text, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const paymentsSchema = pgSchema("payments");

export const financePao = paymentsSchema.table("finance_pao", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  paoCode:   varchar("pao_code", { length: 12 }).notNull(),
  name:      text("name").notNull(),
  ministry:  text("ministry"),
  isActive:  boolean("is_active").notNull().default(true),
  version:   integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeDdo = paymentsSchema.table("finance_ddo", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  ddoCode:   varchar("ddo_code", { length: 12 }).notNull(),
  name:      text("name").notNull(),
  paoCode:   varchar("pao_code", { length: 12 }),
  isActive:  boolean("is_active").notNull().default(true),
  version:   integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Vendor master — backs apps/web finance/vendors (list + [id] detail pages).
// Follows the same conventions as financePao/financeDdo above: tenant-scoped,
// soft-active flag, version + audit columns, full RLS tenant isolation
// (migrations/0065_vendor_master.sql). pan/gstin are plain (not encryptedText)
// so UNIQUE(tenant_id, pan) can enforce uniqueness on the stored value —
// encrypting pan with a random-IV scheme would defeat that. bankAccountNo/
// ifsc carry no such constraint, so they ARE encryptedText, matching
// masters/bank-routes.ts's finance_bank_accounts (the org's own accounts) —
// this is real vendor payment-routing data and shouldn't sit behind a
// weaker bar than the org's own. Format validation for these two moved to
// the Zod layer in routes.ts (a DB CHECK can't see past ciphertext).
export const financeVendors = paymentsSchema.table("finance_vendors", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  name:          text("name").notNull(),
  category:      text("category").notNull(),
  pan:           varchar("pan", { length: 10 }).notNull(),
  gstin:         varchar("gstin", { length: 15 }),
  address:       text("address").notNull(),
  contactPerson: text("contact_person"),
  phone:         varchar("phone", { length: 20 }),
  email:         text("email"),
  bankName:      text("bank_name").notNull(),
  bankAccountNo: encryptedText("bank_account_no").notNull(),
  ifsc:          encryptedText("ifsc").notNull(),
  isActive:      boolean("is_active").notNull().default(true),
  version:       integer("version").notNull().default(1),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaoRow = typeof financePao.$inferSelect;
export type DdoRow = typeof financeDdo.$inferSelect;
export type VendorRow = typeof financeVendors.$inferSelect;

export const schema = { financePao, financeDdo, financeVendors };
