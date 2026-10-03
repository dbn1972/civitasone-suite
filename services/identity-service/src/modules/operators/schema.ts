import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

const usersSchema = pgSchema("users");

// Migration 0028: maker-checker requests against platform operators.
export const operatorChangeRequests = usersSchema.table("operator_change_requests", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  targetUserId: uuid("target_user_id").notNull(),
  fromRoleKey: varchar("from_role_key", { length: 64 }).notNull(),
  toRoleKey: varchar("to_role_key", { length: 64 }),
  reason: varchar("reason", { length: 500 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: varchar("decision_note", { length: 500 }),
  refusalReason: varchar("refusal_reason", { length: 200 }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  kcSync: varchar("kc_sync", { length: 16 }),
  version: integer("version").notNull().default(1),
});

export type OperatorRequestRow = typeof operatorChangeRequests.$inferSelect;
export const operatorsModuleSchema = { operatorChangeRequests };
