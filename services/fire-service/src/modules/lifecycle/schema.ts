import { pgSchema, uuid, varchar, date, bigint, integer, timestamp } from "drizzle-orm/pg-core";

const fireLifecycle = pgSchema("fire_lifecycle");

export const fireRenewalsTable = fireLifecycle.table("fire_renewals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  nocId: uuid("noc_id").notNull(),
  renewalType: varchar("renewal_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("requested"),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  previousValidUntil: date("previous_valid_until"),
  newValidUntil: date("new_valid_until"),
  decision: varchar("decision", { length: 32 }),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type FireRenewalRow = typeof fireRenewalsTable.$inferSelect;
export type FireRenewalInsert = typeof fireRenewalsTable.$inferInsert;

export const schema = { fireRenewals: fireRenewalsTable };
