import { pgSchema, uuid, varchar, bigint, integer, timestamp, boolean, text, char } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

/** Recovery policies — configurable goodwill entitlement rules per tenant. */
export const recoveryPolicies = helpdeskSchema.table("recovery_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  severityThreshold: varchar("severity_threshold", { length: 24 }).notNull(),
  productCode: varchar("product_code", { length: 64 }),
  maxGoodwillMinor: bigint("max_goodwill_minor", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  approverRole: varchar("approver_role", { length: 64 }).notNull().default("helpdesk_manager"),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Action types for recovery actions. */
export type RecoveryActionType = "goodwill_credit" | "replacement" | "priority_service" | "apology_comm";

/** Status lifecycle for recovery actions. */
export type RecoveryActionStatus = "pending_approval" | "approved" | "rejected" | "executed";

/** Recovery actions — per-ticket goodwill recommendations with approval workflow. */
export const recoveryActions = helpdeskSchema.table("recovery_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  policyId: uuid("policy_id").notNull(),
  actionType: varchar("action_type", { length: 24 }).notNull().$type<RecoveryActionType>(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  status: varchar("status", { length: 24 }).notNull().default("pending_approval").$type<RecoveryActionStatus>(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  reason: text("reason"),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RecoveryPolicyRow = typeof recoveryPolicies.$inferSelect;
export type RecoveryPolicyInsert = typeof recoveryPolicies.$inferInsert;
export type RecoveryActionRow = typeof recoveryActions.$inferSelect;
export type RecoveryActionInsert = typeof recoveryActions.$inferInsert;

export const schema = { recoveryPolicies, recoveryActions };
