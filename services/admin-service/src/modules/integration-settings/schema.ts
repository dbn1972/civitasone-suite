/**
 * integration-settings module — Drizzle schema.
 *
 * A tenant-scoped registry of external-endpoint integrations (AI, messaging,
 * email/push, payments, files/OCR). Secrets are NEVER stored in plaintext:
 * the secret bundle for a provider is encrypted with AES-256-GCM (reusing the
 * central-config crypto + CONFIG_ENC_KEY) into `secret_ciphertext`, and only a
 * masked `secret_last4` is kept for display.
 *
 * Lives in its OWN Postgres schema `integration_settings` (L2 rule: this
 * module's repo queries ONLY `integration_settings.*`).
 *
 * Two tables:
 *   - integration_settings          → the live, applied config per provider×env.
 *   - integration_setting_changes   → maker-checker workflow (propose → approve/reject).
 */
import { pgSchema, uuid, varchar, text, boolean, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const integrationSettingsSchema = pgSchema("integration_settings");

/** The live, approved integration config for one provider in one env-scope. */
export const integrationSettings = integrationSettingsSchema.table("integration_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  provider: varchar("provider", { length: 40 }).notNull(),
  envScope: varchar("env_scope", { length: 16 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  endpointUrl: text("endpoint_url").notNull().default(""),
  // Non-secret settings only. Secret fields are stripped out before storage.
  config: jsonb("config").notNull().$type<Record<string, unknown>>().default({}),
  // AES-256-GCM ciphertext of the JSON secret bundle ({field: value, ...}).
  secretCiphertext: text("secret_ciphertext"),
  // Last 4 chars of the primary secret, for masked display (••••1234).
  secretLast4: varchar("secret_last4", { length: 8 }),
  // unconfigured | connected | failed
  status: varchar("status", { length: 16 }).notNull().default("unconfigured"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastError: text("last_error"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
}, (t) => ({
  providerEnvUnique: uniqueIndex("integration_settings_tenant_provider_env_key").on(t.tenantId, t.provider, t.envScope),
}));

/** Maker-checker change request against a provider×env integration. */
export const integrationSettingChanges = integrationSettingsSchema.table("integration_setting_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  provider: varchar("provider", { length: 40 }).notNull(),
  envScope: varchar("env_scope", { length: 16 }).notNull(),
  // Proposed applied state.
  enabled: boolean("enabled").notNull().default(false),
  endpointUrl: text("endpoint_url").notNull().default(""),
  config: jsonb("config").notNull().$type<Record<string, unknown>>().default({}),
  // Ciphertext of proposed secret bundle. Null means "leave existing secret".
  secretCiphertext: text("secret_ciphertext"),
  secretLast4: varchar("secret_last4", { length: 8 }),
  // Whether the proposal changes the secret at all (vs. keeping the current one).
  secretChanged: boolean("secret_changed").notNull().default(false),
  note: text("note"),
  // pending | approved | rejected
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  proposedBy: uuid("proposed_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  // The live version this proposal was based on (optimistic concurrency).
  baseVersion: integer("base_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pendingIdx: index("integration_setting_changes_tenant_status_idx").on(t.tenantId, t.status),
}));

export type IntegrationSettingRow = typeof integrationSettings.$inferSelect;
export type IntegrationSettingInsert = typeof integrationSettings.$inferInsert;
export type IntegrationChangeRow = typeof integrationSettingChanges.$inferSelect;
export type IntegrationChangeInsert = typeof integrationSettingChanges.$inferInsert;

export const schema = { integrationSettings, integrationSettingChanges };
