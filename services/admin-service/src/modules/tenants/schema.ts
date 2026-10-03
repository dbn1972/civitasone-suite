import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const tenantsSchema = pgSchema("tenants");

export const adminTenants = tenantsSchema.table("admin_tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  domain: varchar("domain", { length: 253 }).notNull().unique(),
  edition: varchar("edition", { length: 32 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  region: varchar("region", { length: 64 }).notNull(),
  residency: varchar("residency", { length: 64 }).notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

// Migration 0038: maker-checker requests for tenant lifecycle actions.
// `tenantId` is the TARGET tenant (see the migration header).
export const tenantLifecycleRequests = tenantsSchema.table("tenant_lifecycle_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  kind: varchar("kind", { length: 24 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  reason: text("reason").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  requiredApprovals: integer("required_approvals").notNull().default(1),
  approverRoles: jsonb("approver_roles").$type<string[]>().notNull().default(["super_admin", "platform_admin"]),
  approvalsCount: integer("approvals_count").notNull().default(0),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  failureCode: varchar("failure_code", { length: 64 }),
  cancelledBy: uuid("cancelled_by"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  directExecution: boolean("direct_execution").notNull().default(false),
  version: integer("version").notNull().default(1),
});

export const tenantLifecycleApprovals = tenantsSchema.table("tenant_lifecycle_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  requestId: uuid("request_id").notNull(),
  approverId: uuid("approver_id").notNull(),
  approverRoles: jsonb("approver_roles").$type<string[]>().notNull().default([]),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminTenantRow = typeof adminTenants.$inferSelect;
export type AdminTenantInsert = typeof adminTenants.$inferInsert;
export type LifecycleRequestRow = typeof tenantLifecycleRequests.$inferSelect;
export type LifecycleRequestInsert = typeof tenantLifecycleRequests.$inferInsert;
export const schema = { adminTenants, tenantLifecycleRequests, tenantLifecycleApprovals };
