import { pgSchema, uuid, varchar, integer, bigint, numeric, timestamp } from "drizzle-orm/pg-core";

const works = pgSchema("works");

export const measurementBooks = works.table("measurement_books", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  awardId: uuid("award_id").notNull(),
  mbNumber: varchar("mb_number", { length: 64 }).notNull(),
  issuedBy: uuid("issued_by").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  // draft|so_finalized|sdo_finalized|estimator_finalized|do_finalized
  version: integer("version").notNull().default(1),
});

export const measurements = works.table("measurements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  mbId: uuid("mb_id").notNull(),
  boqItemId: uuid("boq_item_id").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  numberVal: numeric("number_val", { precision: 12, scale: 4 }),
  lengthVal: numeric("length_val", { precision: 12, scale: 4 }),
  breadthVal: numeric("breadth_val", { precision: 12, scale: 4 }),
  depthVal: numeric("depth_val", { precision: 12, scale: 4 }),
  remarks: varchar("remarks", { length: 2048 }),
  version: integer("version").notNull().default(1),
});

export const bills = works.table("bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  awardId: uuid("award_id").notNull(),
  mbId: uuid("mb_id"),
  billMode: varchar("bill_mode", { length: 16 }).notNull(), // abstract | e_mb
  billNumber: varchar("bill_number", { length: 64 }).notNull(),
  grossAmountMinor: bigint("gross_amount_minor", { mode: "bigint" }).notNull(),
  deductionsMinor: bigint("deductions_minor", { mode: "bigint" }).notNull().default(0n),
  netPayableMinor: bigint("net_payable_minor", { mode: "bigint" }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  // draft|so_finalized|sdo_finalized|auditor_finalized|dao_finalized|do_finalized|submitted
  ifmsRef: varchar("ifms_ref", { length: 128 }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billItems = works.table("bill_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  billId: uuid("bill_id").notNull(),
  boqItemId: uuid("boq_item_id").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  rate: bigint("rate", { mode: "bigint" }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  version: integer("version").notNull().default(1),
});

export const billRecoveries = works.table("bill_recoveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  billId: uuid("bill_id").notNull(),
  recoveryType: varchar("recovery_type", { length: 64 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  remarks: varchar("remarks", { length: 2048 }),
  version: integer("version").notNull().default(1),
});

export const accountCompilations = works.table("account_compilations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("draft"), // draft|compiled|submitted
  submittedTo: varchar("submitted_to", { length: 256 }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  dagRef: varchar("dag_ref", { length: 128 }),
  version: integer("version").notNull().default(1),
});

export const schema = { measurementBooks, measurements, bills, billItems, billRecoveries, accountCompilations };
