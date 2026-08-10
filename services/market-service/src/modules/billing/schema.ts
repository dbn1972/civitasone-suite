import { pgSchema, uuid, varchar, integer, bigint, date, timestamp, text } from "drizzle-orm/pg-core";

const marketSchema = pgSchema("market");

export const marketDemands = marketSchema.table("market_demands", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  allotmentId: uuid("allotment_id").notNull(),
  demandMonth: varchar("demand_month", { length: 7 }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  lateFeeMinor: bigint("late_fee_minor", { mode: "bigint" }).notNull().default(0n),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  dueDate: date("due_date").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("generated"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentRef: text("payment_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DemandRow = typeof marketDemands.$inferSelect;
export type DemandInsert = typeof marketDemands.$inferInsert;

export const schema = { marketDemands };
