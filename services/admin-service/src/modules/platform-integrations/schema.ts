/**
 * platform-integrations module — Drizzle schema (migration 0039).
 *
 * Two layers, deliberately separate:
 *
 *   1. PLATFORM CATALOGUE (`providers`) — global reference data owned by
 *      super_admin / platform_admin: which eSign / DSC / bank-API / PFMS
 *      providers CivitasOne supports, their capability list, their typed
 *      config schema (which fields, which are secret, per-environment
 *      endpoints), their status, and which tenants/editions may use them.
 *      No tenant_id (see migration 0039 for the RLS justification).
 *
 *   2. TENANT CONFIG (`tenant_integrations`, `production_switch_requests`,
 *      `tenant_integration_settings`) — tenant-scoped, FORCE RLS. A tenant
 *      picks a platform-enabled provider, fills the schema-driven form
 *      (secrets sealed at rest, never returned), and runs it in `sandbox`
 *      (default) or `production`. Switching to production is maker-checker.
 *
 * This is the schema-driven successor to the fixed-provider
 * `integration_settings` registry (AI/SMS/email/payments endpoints); it does
 * not replace it. The adapter ports live in @civitasone/connector-framework/ports.
 */
import { sql } from "drizzle-orm";
import {
  pgSchema, uuid, varchar, text, integer, boolean, jsonb, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";

export const platformIntegrationsSchema = pgSchema("platform_integrations");

export const INTEGRATION_CATEGORIES = ["esign", "dsc", "bank_api", "pfms"] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];
export const PROVIDER_STATUSES = ["available", "beta", "disabled"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
export const INTEGRATION_ENVIRONMENTS = ["sandbox", "production"] as const;
export type IntegrationEnvironment = (typeof INTEGRATION_ENVIRONMENTS)[number];

export type EndpointMap = { sandbox: string | null; production: string | null };

export const providers = platformIntegrationsSchema.table("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 64 }).notNull(),
  category: varchar("category", { length: 16 }).notNull().$type<IntegrationCategory>(),
  name: varchar("name", { length: 200 }).notNull(),
  vendor: varchar("vendor", { length: 200 }).notNull().default(""),
  description: text("description").notNull().default(""),
  /** string[] of capability keys, e.g. "esign.initiate". */
  capabilities: jsonb("capabilities").notNull().$type<string[]>().default([]),
  /** { fields: ConfigField[] } — see domain.ts ConfigField. */
  configSchema: jsonb("config_schema").notNull().$type<{ fields: unknown[] }>().default({ fields: [] }),
  endpoints: jsonb("endpoints").notNull().$type<EndpointMap>().default({ sandbox: null, production: null }),
  status: varchar("status", { length: 16 }).notNull().default("available").$type<ProviderStatus>(),
  /** all | restricted. restricted => tenant must be in allowedTenantIds OR its edition in allowedEditions. */
  availabilityMode: varchar("availability_mode", { length: 16 }).notNull().default("all"),
  allowedTenantIds: uuid("allowed_tenant_ids").array().notNull().default([]),
  allowedEditions: text("allowed_editions").array().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(100),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
}, (t) => ({
  keyUnique: uniqueIndex("uq_pi_providers_key").on(t.key),
  categoryIdx: index("idx_pi_providers_category").on(t.category, t.sortOrder),
}));

export const tenantIntegrations = platformIntegrationsSchema.table("tenant_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  providerKey: varchar("provider_key", { length: 64 }).notNull(),
  category: varchar("category", { length: 16 }).notNull().$type<IntegrationCategory>(),
  environment: varchar("environment", { length: 16 }).notNull().default("sandbox").$type<IntegrationEnvironment>(),
  enabled: boolean("enabled").notNull().default(true),
  /** Non-secret field values only. */
  config: jsonb("config").notNull().$type<Record<string, unknown>>().default({}),
  /** { field: "enc:v2:<keyid>:<b64>" } — sealed per field; plaintext never stored. */
  secrets: jsonb("secrets").notNull().$type<Record<string, string>>().default({}),
  lastTestStatus: varchar("last_test_status", { length: 16 }),
  lastTestCode: varchar("last_test_code", { length: 40 }),
  lastTestMessage: text("last_test_message"),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestEnvironment: varchar("last_test_environment", { length: 16 }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
}, (t) => ({
  tenantProviderUnique: uniqueIndex("uq_pi_tenant_integrations_tenant_provider").on(t.tenantId, t.providerKey),
  tenantCategoryIdx: index("idx_pi_tenant_integrations_tenant_category").on(t.tenantId, t.category),
}));

export const productionSwitchRequests = platformIntegrationsSchema.table("production_switch_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  integrationId: uuid("integration_id").notNull(),
  providerKey: varchar("provider_key", { length: 64 }).notNull(),
  /** pending | approved | rejected | cancelled */
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  reason: text("reason").notNull(),
  /** tenant_integrations.version the request was raised against. */
  baseVersion: integer("base_version").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  /** true when the tenant has approval switched OFF and the switch applied directly. */
  direct: boolean("direct").notNull().default(false),
}, (t) => ({
  tenantStatusIdx: index("idx_pi_switch_requests_tenant_status").on(t.tenantId, t.status),
  onePendingPerIntegration: uniqueIndex("uq_pi_switch_requests_one_pending").on(t.integrationId).where(sql`${t.status} = 'pending'`),
}));

/** Turning the production-approval policy OFF needs a second approver (migration 0041). */
export const policyChangeRequests = platformIntegrationsSchema.table("policy_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /** pending | approved | rejected | cancelled */
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  reason: text("reason").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
}, (t) => ({
  tenantStatusIdx: index("idx_pi_policy_requests_tenant_status").on(t.tenantId, t.status),
  onePendingPerTenant: uniqueIndex("uq_pi_policy_requests_one_pending").on(t.tenantId).where(sql`${t.status} = 'pending'`),
}));

export const tenantIntegrationSettings = platformIntegrationsSchema.table("tenant_integration_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  /** Production switch needs a second approver. Defaults ON; absent row == ON. */
  requireProductionApproval: boolean("require_production_approval").notNull().default(true),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
});

export type ProviderRow = typeof providers.$inferSelect;
export type TenantIntegrationRow = typeof tenantIntegrations.$inferSelect;
export type TenantIntegrationInsert = typeof tenantIntegrations.$inferInsert;
export type SwitchRequestRow = typeof productionSwitchRequests.$inferSelect;
export type SwitchRequestInsert = typeof productionSwitchRequests.$inferInsert;
export type PolicyRequestRow = typeof policyChangeRequests.$inferSelect;
export type TenantIntegrationSettingsRow = typeof tenantIntegrationSettings.$inferSelect;

export const schema = { providers, tenantIntegrations, productionSwitchRequests, tenantIntegrationSettings, policyChangeRequests };
