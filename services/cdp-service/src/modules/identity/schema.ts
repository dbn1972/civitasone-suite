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

/**
 * CR-CDP-02 — indexed phonetic keys for approximate name matching.
 *
 * `phoneticKey` is the sorted set of Soundex codes of the name's tokens (see
 * identity/phonetic-domain.ts) and `nameNormalized` is the diacritic-folded canonical
 * form. Both exist so Postgres can *retrieve* a bounded candidate window (equality on
 * the phonetic key, trigram similarity on the normalized name) while the score itself is
 * computed in the pure domain — a score computed in SQL could not be reproduced in a
 * unit test.
 *
 * The normalized name is personal data, so it is purged with the profile on a DSAR
 * erasure via the profile FK cascade.
 */
export const profileNameKeys = cdpSchema.table("profile_name_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  nameNormalized: varchar("name_normalized", { length: 200 }).notNull(),
  phoneticKey: varchar("phonetic_key", { length: 200 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ProfileNameKeyRow = typeof profileNameKeys.$inferSelect;
export type ProfileNameKeyInsert = typeof profileNameKeys.$inferInsert;

/**
 * CR-CDP-04 — anonymous visitor register for identity stitching.
 *
 * A device/cookie id is stored only as a SHA-256 hash (the same hashing the identity
 * graph uses for email/phone): it is a pseudonymous identifier under DPDP Act 2023, and
 * a hash is enough to recognise a returning visitor without holding the raw value.
 *
 * `anonymousProfileId` is the shell golden profile that carries the visitor's events
 * before they authenticate. On stitch it becomes a merged profile and
 * `mergedIntoProfileId` records the known profile that absorbed it, so the join is
 * auditable after the fact.
 */
export const anonymousVisitors = cdpSchema.table("anonymous_visitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  visitorKeyHash: varchar("visitor_key_hash", { length: 128 }).notNull(),
  anonymousProfileId: uuid("anonymous_profile_id").notNull(),
  mergedIntoProfileId: uuid("merged_into_profile_id"),
  status: varchar("status", { length: 16 }).notNull().default("anonymous"),
  deviceType: varchar("device_type", { length: 32 }).notNull().default("unknown"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  mergedAt: timestamp("merged_at", { withTimezone: true }),
  eventsMerged: integer("events_merged").notNull().default(0),
  identifiersMerged: integer("identifiers_merged").notNull().default(0),
  devicesMerged: integer("devices_merged").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AnonymousVisitorRow = typeof anonymousVisitors.$inferSelect;
export type AnonymousVisitorInsert = typeof anonymousVisitors.$inferInsert;

export const schema = { identityGraph, deviceTokens, profileNameKeys, anonymousVisitors };
