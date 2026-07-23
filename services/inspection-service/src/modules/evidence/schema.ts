/**
 * inspection-service: evidence module Drizzle schema.
 *
 * Defines the `evidence` PG schema with tables for tamper-evident
 * evidence collection, integrity management, and chain of custody:
 * - evidence_artifacts — file metadata, SHA-256 hashes, capture context
 * - chain_of_custody — access/transfer/modification log per artifact
 * - digital_signatures — signature images with document hash verification
 *
 * _Requirements: 7.1, 7.2, 7.5, 7.6_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  numeric,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/** The `evidence` PG schema — evidence collection and integrity for the inspection service. */
export const evidenceSchema = pgSchema("evidence");

// ── evidence.evidence_artifacts ───────────────────────────────────────────────
export const evidenceArtifacts = evidenceSchema.table("evidence_artifacts", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  inspectionId:     uuid("inspection_id").notNull(),
  findingId:        uuid("finding_id"), // nullable — can be linked later
  sha256Hash:       text("sha256_hash").notNull(),
  s3Key:            text("s3_key").notNull(),
  mimeType:         varchar("mime_type", { length: 64 }).notNull(),
  fileSizeBytes:    integer("file_size_bytes").notNull(),
  integrityStatus:  varchar("integrity_status", { length: 16 }).notNull().default("valid"), // valid|tampered
  captureLatitude:  numeric("capture_latitude", { precision: 10, scale: 7 }),
  captureLongitude: numeric("capture_longitude", { precision: 10, scale: 7 }),
  captureTimestamp: timestamp("capture_timestamp", { withTimezone: true }).notNull(),
  deviceId:         text("device_id").notNull(),
  inspectorId:      uuid("inspector_id").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  version:          integer("version").notNull().default(1),
}, (table) => ({
  tenantInspectionIdx: index("idx_evidence_artifacts_tenant_inspection")
    .on(table.tenantId, table.inspectionId),
}));

// ── evidence.chain_of_custody ─────────────────────────────────────────────────
export const chainOfCustody = evidenceSchema.table("chain_of_custody", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  evidenceId:  uuid("evidence_id").notNull(),
  action:      varchar("action", { length: 32 }).notNull(), // upload|access|transfer|verify|modify
  actorId:     uuid("actor_id").notNull(),
  details:     jsonb("details"),
  recordedAt:  timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  version:     integer("version").notNull().default(1),
}, (table) => ({
  tenantEvidenceIdx: index("idx_chain_of_custody_tenant_evidence")
    .on(table.tenantId, table.evidenceId),
}));

// ── evidence.digital_signatures ───────────────────────────────────────────────
export const digitalSignatures = evidenceSchema.table("digital_signatures", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  inspectionId:         uuid("inspection_id").notNull(),
  evidenceId:           uuid("evidence_id"), // nullable — optional link to artifact
  signatureImage:       text("signature_image").notNull(), // S3 key or base64
  signatoryName:        text("signatory_name").notNull(),
  signatoryDesignation: text("signatory_designation"),
  documentHash:         text("document_hash").notNull(), // SHA-256 of signed document
  signedAt:             timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  version:              integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────────
export type EvidenceArtifactRow = typeof evidenceArtifacts.$inferSelect;
export type EvidenceArtifactInsert = typeof evidenceArtifacts.$inferInsert;
export type ChainOfCustodyRow = typeof chainOfCustody.$inferSelect;
export type ChainOfCustodyInsert = typeof chainOfCustody.$inferInsert;
export type DigitalSignatureRow = typeof digitalSignatures.$inferSelect;
export type DigitalSignatureInsert = typeof digitalSignatures.$inferInsert;

export const schema = { evidenceArtifacts, chainOfCustody, digitalSignatures };
