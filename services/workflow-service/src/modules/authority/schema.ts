import { pgSchema, uuid, varchar, bigint, date, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/** CAP-025 — effective-dated financial/administrative authority limits. */
export const authorityLimits = domainSchema.table("authority_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  scopeType: varchar("scope_type", { length: 16 }).notNull(),
  scopeRef: varchar("scope_ref", { length: 128 }).notNull(),
  authorityType: varchar("authority_type", { length: 16 }).notNull().default("financial"),
  currency: varchar("currency", { length: 8 }).notNull().default("INR"),
  maxAmount: bigint("max_amount", { mode: "number" }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  escalateToScopeType: varchar("escalate_to_scope_type", { length: 16 }),
  escalateToRef: varchar("escalate_to_ref", { length: 128 }),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  reason: varchar("reason", { length: 256 }),
  createdBy: uuid("created_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuthorityLimitRow = typeof authorityLimits.$inferSelect;
export type AuthorityLimitInsert = typeof authorityLimits.$inferInsert;

export const schema = { authorityLimits };
