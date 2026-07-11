/**
 * case-registry — Drizzle table definitions.
 *
 * These tables live in the `court` PostgreSQL schema and mirror, column-for-column,
 * the DDL created by migrations/0001_court_core.sql.
 *
 * Scope: cases, case_parties, case_state_transitions.
 *
 * PII at rest (DPDP Act 2023): case_parties.name_enc / address_enc / phone_enc /
 * email_enc use the app-layer encryptedText() Drizzle type (../../shared/pii-crypto.js),
 * so repo/query code sees CLEARTEXT while the column at rest holds AES-256-GCM
 * CIPHERTEXT stored as TEXT.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version. The append-only case_state_transitions log
 * intentionally omits updated_at / updated_by / version.
 */
import { pgSchema, uuid, text, integer, date, varchar, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Cases ─────────────────────────────────────────────────────────────────────

export const cases = courtSchema.table("cases", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  cnrNumber:    varchar("cnr_number", { length: 64 }).notNull(),
  caseType:     varchar("case_type", { length: 32 }),
  filingNumber: varchar("filing_number", { length: 64 }),
  filingDate:   date("filing_date"),
  title:        text("title"),
  status:       varchar("status", { length: 32 }).notNull().default("filed"),
  stage:        varchar("stage", { length: 32 }),
  courtId:      uuid("court_id"),
  benchId:      uuid("bench_id"),
  disposalDate: date("disposal_date"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by"),
  updatedBy:    uuid("updated_by"),
  version:      integer("version").notNull().default(1),
});

// ─── Case Parties (name/address/phone/email held as AES-256-GCM ciphertext) ─────

export const caseParties = courtSchema.table("case_parties", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  caseId:        uuid("case_id").notNull(),
  partyRole:     varchar("party_role", { length: 32 }).notNull(),
  nameEnc:       encryptedText("name_enc"),
  addressEnc:    encryptedText("address_enc"),
  phoneEnc:      encryptedText("phone_enc"),
  emailEnc:      encryptedText("email_enc"),
  advocateName:  text("advocate_name"),
  advocateBarId: varchar("advocate_bar_id", { length: 64 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
  updatedBy:     uuid("updated_by"),
  version:       integer("version").notNull().default(1),
});

// ─── Case State Transitions (append-only audit log) ────────────────────────────

export const caseStateTransitions = courtSchema.table("case_state_transitions", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  caseId:     uuid("case_id").notNull(),
  fromStatus: varchar("from_status", { length: 32 }),
  toStatus:   varchar("to_status", { length: 32 }).notNull(),
  actorId:    uuid("actor_id"),
  reason:     text("reason"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by"),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type CaseRow    = typeof cases.$inferSelect;
export type CaseInsert = typeof cases.$inferInsert;

export type CasePartyRow    = typeof caseParties.$inferSelect;
export type CasePartyInsert = typeof caseParties.$inferInsert;

export type CaseStateTransitionRow    = typeof caseStateTransitions.$inferSelect;
export type CaseStateTransitionInsert = typeof caseStateTransitions.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const caseRegistrySchema = {
  cases,
  caseParties,
  caseStateTransitions,
};
