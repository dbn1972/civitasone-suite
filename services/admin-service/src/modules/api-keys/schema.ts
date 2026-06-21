import { pgSchema, uuid, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";

export const apiKeysSchema = pgSchema("api_keys");

export const adminApiKeys = apiKeysSchema.table("admin_api_keys", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  keyName:     text("key_name").notNull(),
  keyPrefix:   varchar("key_prefix", { length: 16 }).notNull(),
  keyHash:     text("key_hash").notNull(),
  scopes:      text("scopes").array().notNull().default([]),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  lastUsedAt:  timestamp("last_used_at", { withTimezone: true }),
  expiresAt:   timestamp("expires_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type ApiKeyRow = typeof adminApiKeys.$inferSelect;
export const schema = { adminApiKeys };
