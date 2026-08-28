import { pgSchema, uuid, varchar, integer, bigint, timestamp, date } from "drizzle-orm/pg-core";

export const roadcutSchema = pgSchema("roadcut");

export const roadcutRestorations = roadcutSchema.table("roadcut_restorations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  // One restoration per permit is enforced at the DB level via a unique
  // index (migration 0002_permit_restoration_unique_constraints.sql) rather
  // than a plain column constraint here, for consistency with permits'
  // application_id (see that schema.ts) even though restoration has no
  // cancellation concept yet to carve out.
  permitId: uuid("permit_id").notNull(),
  restorationStartDate: date("restoration_start_date"),
  restorationEndDate: date("restoration_end_date"),
  quality: varchar("quality", { length: 32 }).notNull().default("pending"),
  depositRefundStatus: varchar("deposit_refund_status", { length: 32 }).notNull().default("held"),
  refundMinor: bigint("refund_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RestorationRow = typeof roadcutRestorations.$inferSelect;
export type RestorationInsert = typeof roadcutRestorations.$inferInsert;

export const schema = { roadcutRestorations };
