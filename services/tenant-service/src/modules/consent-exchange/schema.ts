import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

const tenantSchema = pgSchema("tenant");

/** A DEPA-style consent artefact: the whole request -> grant -> fetch lifecycle. */
export const consentArtefacts = tenantSchema.table("consent_artefacts", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  principalId:    uuid("principal_id").notNull(),
  requestingDept: varchar("requesting_dept", { length: 160 }).notNull(),
  providingDept:  varchar("providing_dept", { length: 160 }).notNull(),
  purposeKey:     varchar("purpose_key", { length: 120 }).notNull(),
  dataCategories: jsonb("data_categories").$type<string[]>().notNull().default([]),
  validFrom:      timestamp("valid_from", { withTimezone: true }).notNull(),
  validTo:        timestamp("valid_to", { withTimezone: true }).notNull(),
  frequency:      varchar("frequency", { length: 16 }).notNull().default("one-time"),
  status:         varchar("status", { length: 16 }).notNull().default("requested"),
  fetchCount:     integer("fetch_count").notNull().default(0),
  reason:         text("reason"),
  requestedAt:    timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt:      timestamp("decided_at", { withTimezone: true }),
  decidedBy:      uuid("decided_by"),
  revokedAt:      timestamp("revoked_at", { withTimezone: true }),
  revokedBy:      uuid("revoked_by"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
});

/** Providing dept's data about a principal, keyed by category (source for fetch). */
export const consentHoldings = tenantSchema.table("consent_holdings", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  principalId:   uuid("principal_id").notNull(),
  providingDept: varchar("providing_dept", { length: 160 }).notNull(),
  category:      varchar("category", { length: 120 }).notNull(),
  value:         jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

/** Append-only access ledger (enforced by a DB trigger). */
export const consentLedger = tenantSchema.table("consent_ledger", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  artefactId:     uuid("artefact_id").notNull(),
  principalId:    uuid("principal_id").notNull(),
  eventType:      varchar("event_type", { length: 24 }).notNull(),
  outcome:        varchar("outcome", { length: 16 }).notNull().default("recorded"),
  requestingDept: varchar("requesting_dept", { length: 160 }),
  purposeKey:     varchar("purpose_key", { length: 120 }),
  categories:     jsonb("categories").$type<string[]>().notNull().default([]),
  reason:         text("reason"),
  actorId:        uuid("actor_id").notNull(),
  correlationId:  varchar("correlation_id", { length: 120 }),
  at:             timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConsentArtefactRow = typeof consentArtefacts.$inferSelect;
export type ConsentHoldingRow = typeof consentHoldings.$inferSelect;
export type ConsentLedgerRow = typeof consentLedger.$inferSelect;
export const consentExchangeSchema = { consentArtefacts, consentHoldings, consentLedger };
