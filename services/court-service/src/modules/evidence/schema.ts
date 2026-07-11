/**
 * evidence — Drizzle table definitions.
 *
 * This table lives in the `court` PostgreSQL schema and mirrors, column-for-column,
 * the DDL created by migrations/0006_court_evidence.sql.
 *
 * Scope: evidence & exhibits (§22).
 *
 * Tamper-evidence: content_hash holds the lowercase hex SHA-256 digest of the file
 * referenced by storage_ref (an opaque S3 object reference). The digest is computed
 * by the app layer and stored verbatim so re-computation can detect tampering.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version.
 */
import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `court` PG schema — every court-service table is namespaced under it. */
export const courtSchema = pgSchema("court");

// ─── Evidence & exhibits ────────────────────────────────────────────────────────

export const evidence = courtSchema.table("evidence", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  caseId:        uuid("case_id").notNull(),
  filingId:      uuid("filing_id"),
  exhibitNumber: varchar("exhibit_number", { length: 32 }),
  title:         text("title").notNull(),
  evidenceType:  varchar("evidence_type", { length: 32 }).notNull().default("document"),
  storageRef:    varchar("storage_ref", { length: 512 }),
  contentHash:   varchar("content_hash", { length: 64 }),
  status:        varchar("status", { length: 16 }).notNull().default("submitted"),
  submittedBy:   uuid("submitted_by"),
  rulingRemarks: text("ruling_remarks"),
  ruledBy:       uuid("ruled_by"),
  ruledAt:       timestamp("ruled_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
  updatedBy:     uuid("updated_by"),
  version:       integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type EvidenceRow    = typeof evidence.$inferSelect;
export type EvidenceInsert = typeof evidence.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const evidenceSchema = {
  evidence,
};
