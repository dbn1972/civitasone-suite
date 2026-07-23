/**
 * inspection-service: findings module Drizzle schema.
 *
 * Defines the `findings` PG schema with tables:
 * - findings — non-compliance findings linked to inspections
 * - compliance_notices — notices issued for findings with due dates
 * - finding_sequences — tenant+year sequence counters for finding number generation
 *
 * _Requirements: 9.1, 9.3, 9.4_
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
} from "drizzle-orm/pg-core";

/** The `findings` PG schema — non-compliance findings and compliance notices. */
export const findingsSchema = pgSchema("findings");

// ── findings.findings ─────────────────────────────────────────────────────
export const findings = findingsSchema.table("findings", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  findingNumber:    text("finding_number").notNull(), // FND-{YYYY}-{SEQ:6}
  inspectionId:     uuid("inspection_id").notNull(),
  questionId:       text("question_id").notNull(), // checklist question reference
  provisionId:      uuid("provision_id").notNull(),
  severity:         varchar("severity", { length: 16 }).notNull(), // critical|major|minor|observation
  description:      text("description").notNull(),
  state:            varchar("state", { length: 24 }).notNull().default("open"),
  evidenceIds:      jsonb("evidence_ids").notNull().default([]), // uuid[]
  closedAt:         timestamp("closed_at", { withTimezone: true }),
  closedBy:         uuid("closed_by"),
  verificationEvidence: jsonb("verification_evidence"), // { evidenceId: string; notes: string }
  deletedAt:        timestamp("deleted_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// ── findings.compliance_notices ───────────────────────────────────────────
export const complianceNotices = findingsSchema.table("compliance_notices", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  findingId:        uuid("finding_id").notNull(),
  dueDate:          date("due_date").notNull(),
  requiredAction:   text("required_action").notNull(),
  responsibleParty: text("responsible_party").notNull(),
  issuedAt:         timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// ── findings.finding_sequences ────────────────────────────────────────────
export const findingSequences = findingsSchema.table("finding_sequences", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  year:             integer("year").notNull(),
  lastSeq:          integer("last_seq").notNull().default(0),
  version:          integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────
export type FindingRow = typeof findings.$inferSelect;
export type FindingInsert = typeof findings.$inferInsert;
export type ComplianceNoticeRow = typeof complianceNotices.$inferSelect;
export type ComplianceNoticeInsert = typeof complianceNotices.$inferInsert;
export type FindingSequenceRow = typeof findingSequences.$inferSelect;
export type FindingSequenceInsert = typeof findingSequences.$inferInsert;

export const schema = { findings, complianceNotices, findingSequences };
