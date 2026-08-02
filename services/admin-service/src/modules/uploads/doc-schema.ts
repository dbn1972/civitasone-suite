/**
 * DM-002 — document types, mandatory documents and expiry. Drizzle schema.
 *
 * Extends the existing `uploads` module (which so far only minted S3 pre-signed
 * URLs) with the governance layer around those objects. Own Postgres schema
 * `uploads`.
 *
 *   document_types        → what kinds of document exist, their allowed
 *                           extensions/size, and whether they expire.
 *   document_requirements → which types are MANDATORY for a given context
 *                           (e.g. contextType='employee_onboarding').
 *   documents             → a registered document instance: the S3 object key
 *                           (never the bytes), its issue/expiry dates and status.
 *
 * PII: `storageKey` is an opaque S3 key produced by /v1/admin/uploads/presign.
 * `subjectId` is an opaque identifier supplied by the caller. No name, email,
 * phone or document number is stored or logged by this module.
 */
import { pgSchema, uuid, varchar, text, boolean, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const uploadsPgSchema = pgSchema("uploads");

export const documentTypes = uploadsPgSchema.table("document_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  /** Mirrors the categories the presign route already understands. */
  category: varchar("category", { length: 32 }).notNull().default("document"),
  allowedExtensions: jsonb("allowed_extensions").$type<string[]>().notNull().default([]),
  maxSizeMb: integer("max_size_mb").notNull().default(10),
  expiryRequired: boolean("expiry_required").notNull().default(false),
  /** How many days before expiry the `documentExpiring` alert fires. */
  expiryWarnDays: integer("expiry_warn_days").notNull().default(30),
  /** active | retired */
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  codeUnique: uniqueIndex("uq_document_types_code").on(t.tenantId, t.code),
}));

export const documentRequirements = uploadsPgSchema.table("document_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  contextType: varchar("context_type", { length: 48 }).notNull(),
  contextKey: varchar("context_key", { length: 120 }).notNull(),
  documentTypeCode: varchar("document_type_code", { length: 64 }).notNull(),
  mandatory: boolean("mandatory").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  ctxUnique: uniqueIndex("uq_document_requirements_ctx")
    .on(t.tenantId, t.contextType, t.contextKey, t.documentTypeCode),
}));

export const documents = uploadsPgSchema.table("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  documentTypeCode: varchar("document_type_code", { length: 64 }).notNull(),
  contextType: varchar("context_type", { length: 48 }).notNull(),
  contextKey: varchar("context_key", { length: 120 }).notNull(),
  subjectId: varchar("subject_id", { length: 120 }).notNull().default(""),
  storageKey: text("storage_key").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** active | expiring | expired | superseded */
  status: varchar("status", { length: 16 }).notNull().default("active"),
  lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  ctxIndex: index("idx_documents_ctx").on(t.tenantId, t.contextType, t.contextKey),
  expiryIndex: index("idx_documents_expiry").on(t.tenantId, t.expiresAt),
}));

export type DocumentTypeRow = typeof documentTypes.$inferSelect;
export type DocumentTypeInsert = typeof documentTypes.$inferInsert;
export type DocumentRequirementRow = typeof documentRequirements.$inferSelect;
export type DocumentRequirementInsert = typeof documentRequirements.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentInsert = typeof documents.$inferInsert;

export const docSchema = { documentTypes, documentRequirements, documents };
