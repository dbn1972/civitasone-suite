import { pgSchema, uuid, varchar, integer, timestamp, bigint } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("loyalty");

export const accruals = domainSchema.table("accruals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  memberId: uuid("member_id").notNull(),
  points: bigint("points", { mode: "bigint" }).notNull(),
  source: varchar("source", { length: 100 }).notNull(),
  sourceRef: varchar("source_ref", { length: 200 }),
  accrualDate: timestamp("accrual_date", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type AccrualRow = typeof accruals.$inferSelect;
export type AccrualInsert = typeof accruals.$inferInsert;

export const schema = { accruals };
