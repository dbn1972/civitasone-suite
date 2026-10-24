/**
 * identity-providers module — Drizzle schema (migration 0054).
 * Lives in its OWN Postgres schema `identity_providers`.
 */
import { pgSchema, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";

export const identityProvidersSchema = pgSchema("identity_providers");

export const identityProviders = identityProvidersSchema.table("providers", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  kind: varchar("kind", { length: 8 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  protocol: varchar("protocol", { length: 16 }).notNull(),
  entityId: varchar("entity_id", { length: 512 }).notNull().default(""),
  endpoint: varchar("endpoint", { length: 2048 }).notNull(),
  clientId: varchar("client_id", { length: 256 }),
  // AES-256-GCM sealed (enc:v2:...) — never plaintext, never returned by a route.
  clientSecretCiphertext: text("client_secret_ciphertext"),
  clientSecretLast4: varchar("client_secret_last4", { length: 8 }),
  status: varchar("status", { length: 16 }).notNull().default("inactive"),
  usersSynced: integer("users_synced").notNull().default(0),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export type IdentityProviderRow = typeof identityProviders.$inferSelect;
