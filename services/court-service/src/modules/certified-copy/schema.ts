/**
 * certified-copy — Drizzle table definitions (§30).
 *
 * This table lives in the `court` PostgreSQL schema and mirrors, column-for-column,
 * the DDL created by migrations/0011_court_certified_copy.sql.
 *
 * Scope: citizen requests for certified copies of orders / judgments / case
 * documents, with a server-authoritative fee and issuance tracking.
 *
 * PII at rest (DPDP Act 2023, Req 15.3): applicant_name_enc uses the app-layer
 * encryptedText() Drizzle type, so repo/query code sees CLEARTEXT while the column
 * at rest holds AES-256-GCM CIPHERTEXT (like case_parties.name_enc).
 *
 * Money: fee_minor is BigInt PAISE (`mode: "bigint"`), so amounts never lose
 * precision through the JS number range.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, text, integer, boolean, bigint, varchar, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Certified copies ────────────────────────────────────────────────────────

export const certifiedCopies = courtSchema.table("certified_copies", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  caseId:           uuid("case_id").notNull(),
  orderId:          uuid("order_id"),
  documentRef:      varchar("document_ref", { length: 512 }),
  // PII at rest — cleartext in app, AES-256-GCM ciphertext in the column.
  applicantNameEnc: encryptedText("applicant_name_enc"),
  copiesCount:      integer("copies_count").notNull().default(1),
  urgent:           boolean("urgent").notNull().default(false),
  // BigInt PAISE — server-authoritative fee.
  feeMinor:         bigint("fee_minor", { mode: "bigint" }).notNull().default(0n),
  feeSource:        varchar("fee_source", { length: 8 }),
  status:           varchar("status", { length: 16 }).notNull().default("requested"),
  requestedBy:      uuid("requested_by"),
  issuedBy:         uuid("issued_by"),
  issuedAt:         timestamp("issued_at", { withTimezone: true }),
  deliveryMode:     varchar("delivery_mode", { length: 24 }),
  remarks:          text("remarks"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by"),
  updatedBy:        uuid("updated_by"),
  version:          integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type CertifiedCopyRow    = typeof certifiedCopies.$inferSelect;
export type CertifiedCopyInsert = typeof certifiedCopies.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const certifiedCopySchema = {
  certifiedCopies,
};
