import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

// SEC-007: per-tenant SCIM bearer tokens. See migrations/0022_scim_per_tenant_tokens.sql
// for the full rationale (including why this table deliberately carries no RLS policy).
export const scimSchemaNs = pgSchema("scim");

export const scimTokens = scimSchemaNs.table("scim_tokens", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  name:        varchar("name", { length: 200 }).notNull(),
  tokenPrefix: varchar("token_prefix", { length: 32 }).notNull(),
  secretHash:  varchar("secret_hash", { length: 64 }).notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  lastUsedAt:  timestamp("last_used_at", { withTimezone: true }),
  expiresAt:   timestamp("expires_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  revokedAt:   timestamp("revoked_at", { withTimezone: true }),
  version:     integer("version").notNull().default(1),
});

export type ScimTokenStatus = "active" | "revoked";
export type ScimTokenRow    = typeof scimTokens.$inferSelect;
export type ScimTokenInsert = typeof scimTokens.$inferInsert;

export const scimModuleSchema = { scimTokens };
