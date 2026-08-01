/**
 * identity module — Drizzle schema. Identity graph for cross-source resolution.
 */
import { pgSchema, uuid, varchar, integer, timestamp, numeric } from "drizzle-orm/pg-core";

export const cdpSchema = pgSchema("cdp");

export const identityGraph = cdpSchema.table("identity_graph", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  identifierType: varchar("identifier_type", { length: 64 }).notNull(),
  identifierHash: varchar("identifier_hash", { length: 256 }).notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull().default("1.0000"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type IdentityGraphRow = typeof identityGraph.$inferSelect;
export type IdentityGraphInsert = typeof identityGraph.$inferInsert;

/**
 * CDP-007 — cross-device identity graph.
 * `deviceToken` is an opaque, revocable token minted by the collecting client. A raw
 * device fingerprint is never stored: under DPDP Act 2023 a fingerprint is identifying
 * personal data that cannot be rotated, whereas a token can be revoked and purged on
 * a DSAR erasure.
 */
export const deviceTokens = cdpSchema.table("device_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  deviceToken: varchar("device_token", { length: 256 }).notNull(),
  deviceType: varchar("device_type", { length: 32 }).notNull().default("unknown"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type DeviceTokenRow = typeof deviceTokens.$inferSelect;
export type DeviceTokenInsert = typeof deviceTokens.$inferInsert;

export const schema = { identityGraph, deviceTokens };
