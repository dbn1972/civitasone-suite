import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const apikeysSchema = pgSchema("apikeys");

export const apiKeys = apikeysSchema.table("api_keys", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  name:        varchar("name", { length: 200 }).notNull(),
  keyPrefix:   varchar("key_prefix", { length: 32 }).notNull(),
  secretHash:  varchar("secret_hash", { length: 64 }).notNull(),
  scopes:      jsonb("scopes").$type<string[]>().notNull().default([]),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  keyVersion:  integer("key_version").notNull().default(1),
  lastUsedAt:  timestamp("last_used_at", { withTimezone: true }),
  expiresAt:   timestamp("expires_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  revokedAt:   timestamp("revoked_at", { withTimezone: true }),
  version:     integer("version").notNull().default(1),
});

export const apiKeyAudit = apikeysSchema.table("api_key_audit", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  apiKeyId:   uuid("api_key_id").notNull(),
  action:     varchar("action", { length: 24 }).notNull(),
  actorId:    uuid("actor_id").notNull(),
  detail:     varchar("detail", { length: 500 }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApiKeyRow    = typeof apiKeys.$inferSelect;
export type ApiKeyInsert = typeof apiKeys.$inferInsert;

export const apiKeysModuleSchema = { apiKeys, apiKeyAudit };
