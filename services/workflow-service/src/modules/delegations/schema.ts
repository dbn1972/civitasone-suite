import { pgSchema, uuid, varchar, date, boolean, timestamp, text } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/**
 * L3 — persisted approval delegations (migration 0004_world_class). A delegate
 * may act on behalf of a delegator's role while a delegation is active and the
 * current date falls within [from_date, to_date].
 */
export const delegations = domainSchema.table("workflow_delegations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  delegatorId: uuid("delegator_id").notNull(),
  delegateId: uuid("delegate_id").notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date"),
  reason: varchar("reason", { length: 256 }),
  /**
   * Roles this delegation conveys. A delegation satisfies a task's roleRef gate
   * only if roleRef is listed here; the creator held every listed role at
   * creation time (checked against their token roles). Empty = conveys nothing.
   */
  roles: text("roles").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DelegationRow = typeof delegations.$inferSelect;
export type DelegationInsert = typeof delegations.$inferInsert;

export type DelegationView = {
  id: string;
  tenantId: string;
  delegatorId: string;
  delegateId: string;
  fromDate: string;
  toDate: string | null;
  reason: string | null;
  roles: string[];
  isActive: boolean;
  createdAt: string;
};

export const schema = { delegations };
