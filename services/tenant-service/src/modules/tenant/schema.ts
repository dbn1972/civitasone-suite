/**
 * tenant module — Drizzle schema. Lives in its OWN Postgres schema `tenant`.
 * L2 rule: this module's repo queries ONLY `tenant.*`. No other module may import this file.
 */
import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const tenantSchema = pgSchema("tenant");

export const tenants = tenantSchema.table("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  // tenantId == id for the tenant row itself, but kept for the uniform BaseEntity shape
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  domain: varchar("domain", { length: 253 }).notNull().unique(),
  edition: varchar("edition", { length: 32 }).notNull(), // govt | psu | private | ngo | section8 | cooperative | small_office
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  region: varchar("region", { length: 64 }).notNull(),
  residency: varchar("residency", { length: 64 }).notNull(),
  // Tiered multi-tenancy: 'pool' (shared DB + RLS) | 'silo' (dedicated DB).
  isolationTier: varchar("isolation_tier", { length: 8 }).notNull().default("pool"),
  dbDsnRef: text("db_dsn_ref"),   // secret-manager reference (silo), never plaintext
  kmsKeyRef: text("kms_key_ref"), // per-tenant encryption key reference (silo BYOK)
  // Tenant_Placement_Policy provenance (migration 0015_placement_policy.sql):
  // which policy version/reason produced isolationTier — NULL for tenants
  // onboarded before this feature or whose tier was set purely by manual
  // PATCH .../isolation.
  policyVersion: text("policy_version"),
  policyReason: varchar("policy_reason", { length: 24 }),
  orgCategory: text("org_category"), // richer classification (central_govt, state_psu, society, etc.)
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  // audit columns (CLAUDE.md §3.6)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TenantRow = typeof tenants.$inferSelect;
export type TenantInsert = typeof tenants.$inferInsert;

export const tenantQuotas = tenantSchema.table("tenant_quotas", {
  tenantId: uuid("tenant_id").primaryKey(),
  maxEmployees: integer("max_employees").notNull().default(500),
  maxFiles: integer("max_files").notNull().default(10000),
  maxApiCallsPerMin: integer("max_api_calls_per_min").notNull().default(200),
  maxStorageGb: integer("max_storage_gb").notNull().default(10),
  maxUsers: integer("max_users").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantQuotaRow = typeof tenantQuotas.$inferSelect;
export type TenantQuotaInsert = typeof tenantQuotas.$inferInsert;

export const schema = { tenants, tenantQuotas };
