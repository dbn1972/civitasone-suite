import { pgSchema, uuid, varchar, timestamp, bigint } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("loyalty");

export const accruals = domainSchema.table("accruals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  enrolmentId: uuid("enrolment_id").notNull(),
  points: bigint("points", { mode: "bigint" }).notNull(),
  source: varchar("source", { length: 100 }).notNull(),
  sourceRef: varchar("source_ref", { length: 200 }),
  txType: varchar("tx_type", { length: 50 }).notNull().default("purchase"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  accrualDate: timestamp("accrual_date", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type AccrualRow = typeof accruals.$inferSelect;
export type AccrualInsert = typeof accruals.$inferInsert;

export const schema = { accruals };
