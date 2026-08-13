import { pgSchema, uuid, varchar, integer, timestamp, date } from "drizzle-orm/pg-core";

const sewerageSchema = pgSchema("civitas_sewerage");

export const sewerageBills = sewerageSchema.table("sewerage_bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  billNumber: varchar("bill_number", { length: 32 }).notNull(),
  billingPeriod: varchar("billing_period", { length: 24 }).notNull(),
  amountMinor: integer("amount_minor").notNull(),
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
