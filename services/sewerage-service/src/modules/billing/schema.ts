import { pgSchema, uuid, varchar, integer, bigint, timestamp, date } from "drizzle-orm/pg-core";

const sewerageSchema = pgSchema("civitas_sewerage");

export const sewerageBills = sewerageSchema.table("sewerage_bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  billNumber: varchar("bill_number", { length: 32 }).notNull(),
  billingPeriod: varchar("billing_period", { length: 24 }).notNull(),
  // Money minor units (paise), stored as bigint (see migrations/
  // 0002_money_bigint_paise.sql) — was `integer`, which both caps at ~2.147bn
  // and, combined with the old route-facing z.number().int() with no upper
  // bound, allowed an already-precision-lost JS number through. Route layer
  // now uses @civitasone/schemas' zMoneyMinorStringNonNeg codec (see
  // billing/routes.ts) so the value crosses every boundary as an exact
  // base-10 string, never a JS `number`.
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  dueDate: date("due_date").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("generated"),
  paymentRef: varchar("payment_ref", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BillRow = typeof sewerageBills.$inferSelect;
export type BillInsert = typeof sewerageBills.$inferInsert;
export const schema = { sewerageBills };
