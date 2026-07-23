/**
 * inspection-service: Licence Compliance module Drizzle schema.
 *
 * Defines the `licence` PG schema with tables:
 * - licences — registered licences with lifecycle tracking
 * - licence_conditions — individual conditions attached to licences
 *
 * _Requirements: SVC-108_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  date,
  jsonb,
  bigint,
} from "drizzle-orm/pg-core";

/** The `licence` PG schema — licence compliance management. */
export const licenceSchema = pgSchema("licence");

// ── licence.licences ──────────────────────────────────────────────────────
export const licences = licenceSchema.table("licences", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  entityId:        uuid("entity_id").notNull(),
  licenceType:     varchar("licence_type", { length: 64 }).notNull(),
  licenceNumber:   text("licence_number").notNull(),
  issuedAt:        timestamp("issued_at", { withTimezone: true }),
  validFrom:       date("valid_from").notNull(),
  validTo:         date("valid_to").notNull(),
  conditions:      jsonb("conditions"), // array of condition objects
  status:          varchar("status", { length: 24 }).notNull().default("active"),
  renewalFee:      bigint("renewal_fee", { mode: "bigint" }), // paise
  currency:        varchar("currency", { length: 3 }).notNull().default("INR"),
  lastRenewalAt:   timestamp("last_renewal_at", { withTimezone: true }),
  reminderSentAt:  timestamp("reminder_sent_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

// ── licence.licence_conditions ────────────────────────────────────────────
export const licenceConditions = licenceSchema.table("licence_conditions", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  licenceId:        uuid("licence_id").notNull(),
  conditionText:    text("condition_text").notNull(),
  complianceStatus: varchar("compliance_status", { length: 16 }).notNull().default("pending"),
  verifiedAt:       timestamp("verified_at", { withTimezone: true }),
  verifiedBy:       uuid("verified_by"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────
export type LicenceRow = typeof licences.$inferSelect;
export type LicenceInsert = typeof licences.$inferInsert;
export type LicenceConditionRow = typeof licenceConditions.$inferSelect;
export type LicenceConditionInsert = typeof licenceConditions.$inferInsert;

export const schema = { licences, licenceConditions };
