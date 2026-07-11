/**
 * public-lookup — Drizzle table definitions.
 *
 * These tables live in the `court` PostgreSQL schema and mirror, column-for-column,
 * the DDL created by migrations/0013_court_public_lookup.sql.
 *
 * Scope: public_establishments, otp_challenges.
 *
 * NO ROW-LEVEL SECURITY (deliberate): both tables are PRE-AUTH / CROSS-TENANT
 * registries — the establishment directory is the mechanism by which the tenant is
 * resolved before any tenant-scoped read, and OTP challenges are keyed on a mobile
 * HASH (not a tenant). They are read WITHOUT an app.tenant_id GUC, exactly like the
 * shared _outbox/_inbox tables. See the migration header for the full rationale.
 *
 * PII: otp_challenges stores mobile numbers ONLY as a peppered SHA-256 hash
 * (mobile_hash) and OTPs ONLY as a salted SHA-256 hash (otp_hash) — never cleartext.
 */
import { pgSchema, uuid, text, integer, boolean, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Public establishment directory (cross-tenant, no RLS) ──────────────────────

export const publicEstablishments = courtSchema.table("public_establishments", {
  id:                uuid("id").primaryKey().defaultRandom(),
  establishmentCode: varchar("establishment_code", { length: 32 }).notNull(),
  cnrPrefix:         varchar("cnr_prefix", { length: 8 }).notNull(),
  tenantId:          uuid("tenant_id").notNull(),
  courtName:         text("court_name").notNull(),
  publicSlug:        varchar("public_slug", { length: 64 }).notNull(),
  active:            boolean("active").notNull().default(true),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by"),
});

// ─── OTP challenge registry (pre-auth, keyed on mobile hash, no RLS) ────────────

export const otpChallenges = courtSchema.table("otp_challenges", {
  id:          uuid("id").primaryKey().defaultRandom(),
  mobileHash:  varchar("mobile_hash", { length: 64 }).notNull(),
  otpHash:     varchar("otp_hash", { length: 64 }).notNull(),
  purpose:     varchar("purpose", { length: 24 }).notNull().default("case_status"),
  attempts:    integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  expiresAt:   timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt:  timestamp("consumed_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type PublicEstablishmentRow    = typeof publicEstablishments.$inferSelect;
export type PublicEstablishmentInsert = typeof publicEstablishments.$inferInsert;

export type OtpChallengeRow    = typeof otpChallenges.$inferSelect;
export type OtpChallengeInsert = typeof otpChallenges.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const publicLookupSchema = {
  publicEstablishments,
  otpChallenges,
};
