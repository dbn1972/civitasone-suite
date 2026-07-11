/**
 * visitor-service: blacklist / watchlist Drizzle schema (migration 0003).
 *
 * Mirrors `services/visitor-service/migrations/0003_check_ins_blacklist_watchlist.sql`
 * exactly (column names, types, defaults, nullability) for
 * `visitor.blacklist_entries` and `visitor.watchlist_entries`.
 *
 * `personName` is DPDP-encrypted PII (AES-256-GCM envelope via
 * `encryptedText()`); `identityDocHash` is a deterministic HMAC blind index
 * (plain hex text, NOT encrypted) so screening lookups can match on the hash
 * without decrypting any PII — see `./blind-index.ts`.
 *
 * `visitorSchema` (the shared `visitor` Postgres schema) is defined here
 * since this is the first module schema file scaffolded; other modules'
 * `schema.ts` files import it from here.
 */
import { pgSchema, uuid, varchar, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const visitorSchema = pgSchema("visitor");

export const blacklistEntries = visitorSchema.table("blacklist_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id"), // null = all locations
  personName: encryptedText("person_name").notNull(), // encrypted (enc:v2:... envelope)
  identityDocType: varchar("identity_doc_type", { length: 24 }),
  identityDocHash: text("identity_doc_hash"), // HMAC blind index, plain hex (not encrypted)
  reason: text("reason").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  // status: pending | active | expired | archived
  approvedBy: uuid("approved_by"), // maker-checker: second officer
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const watchlistEntries = visitorSchema.table("watchlist_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id"), // null = all locations
  personName: encryptedText("person_name").notNull(), // encrypted (enc:v2:... envelope)
  identityDocType: varchar("identity_doc_type", { length: 24 }),
  identityDocHash: text("identity_doc_hash"), // HMAC blind index, plain hex (not encrypted)
  riskLevel: varchar("risk_level", { length: 8 }).notNull().default("medium"),
  // risk_level: low | medium | high
  specialInstructions: text("special_instructions"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BlacklistEntryRow = typeof blacklistEntries.$inferSelect;
export type BlacklistEntryInsert = typeof blacklistEntries.$inferInsert;
export type WatchlistEntryRow = typeof watchlistEntries.$inferSelect;
export type WatchlistEntryInsert = typeof watchlistEntries.$inferInsert;
