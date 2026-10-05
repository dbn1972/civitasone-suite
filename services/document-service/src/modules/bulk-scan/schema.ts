/**
 * bulk_scan module - drizzle schema. Mirrors migrations 0005 (core), 0006 (settings/links).
 * Module isolation (L2): own pg schema, no cross-schema FK, no import of another module's schema.
 */
import {
  pgSchema, uuid, varchar, integer, bigint, timestamp, text, boolean, jsonb, numeric, char,
} from "drizzle-orm/pg-core";

export const bulkScanSchema = pgSchema("bulk_scan");

export const batches = bulkScanSchema.table("batches", {
  id:             uuid("id").primaryKey(),
  tenantId:       uuid("tenant_id").notNull(),
  name:           varchar("name", { length: 200 }).notNull(),
  targetFolderId: uuid("target_folder_id"),
  defaultTags:    text("default_tags").array().notNull().default([]),
  defaultDocType: varchar("default_doc_type", { length: 64 }),
  linkTarget:     jsonb("link_target").$type<Record<string, unknown> | null>(),
  profileId:      uuid("profile_id"),
  status:         varchar("status", { length: 24 }).notNull().default("open"),
  fileCount:      integer("file_count").notNull().default(0),
  totalBytes:     bigint("total_bytes", { mode: "number" }).notNull().default(0),
  completedAt:    timestamp("completed_at", { withTimezone: true }),
  cancelledAt:    timestamp("cancelled_at", { withTimezone: true }),
  notifiedCompletedAt: timestamp("notified_completed_at", { withTimezone: true }),
  version:        integer("version").notNull().default(1),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const batchFiles = bulkScanSchema.table("batch_files", {
  id:                uuid("id").primaryKey(),
  tenantId:          uuid("tenant_id").notNull(),
  batchId:           uuid("batch_id").notNull(),
  originalName:      varchar("original_name", { length: 500 }).notNull(),
  mimeType:          varchar("mime_type", { length: 128 }),
  declaredSizeBytes: bigint("declared_size_bytes", { mode: "number" }).notNull(),
  sizeBytes:         bigint("size_bytes", { mode: "number" }),
  sha256:            char("sha256", { length: 64 }),
  storageKey:        varchar("storage_key", { length: 1000 }).notNull(),
  state:             varchar("state", { length: 24 }).notNull().default("pending_upload"),
  failureReason:     varchar("failure_reason", { length: 64 }),
  failureDetail:     varchar("failure_detail", { length: 500 }),
  deadLetter:        boolean("dead_letter").notNull().default(false),
  attempts:          integer("attempts").notNull().default(0),
  nextAttemptAt:     timestamp("next_attempt_at", { withTimezone: true }),
  leaseExpiresAt:    timestamp("lease_expires_at", { withTimezone: true }),
  leaseOwner:        uuid("lease_owner"),
  scanStatus:        varchar("scan_status", { length: 24 }),
  quarantineKey:     varchar("quarantine_key", { length: 1000 }),
  pageCount:         integer("page_count"),
  ocrMeanConfidence: numeric("ocr_mean_confidence", { precision: 5, scale: 4 }),
  docType:           varchar("doc_type", { length: 64 }),
  classification:    jsonb("classification").$type<Record<string, unknown> | null>(),
  extractedFields:   jsonb("extracted_fields").$type<unknown[] | null>(),
  piiFlags:          jsonb("pii_flags").$type<string[] | null>(),
  reviewReasons:     jsonb("review_reasons").$type<string[] | null>(),
  textMaskedKey:     varchar("text_masked_key", { length: 1000 }),
  searchablePdfKey:  varchar("searchable_pdf_key", { length: 1000 }),
  structuredJsonKey: varchar("structured_json_key", { length: 1000 }),
  tags:              text("tags").array().notNull().default([]),
  reviewedBy:        uuid("reviewed_by"),
  reviewedAt:        timestamp("reviewed_at", { withTimezone: true }),
  duplicateOf:       uuid("duplicate_of"),
  duplicateAction:   varchar("duplicate_action", { length: 8 }),
  canonicalForHash:  boolean("canonical_for_hash").notNull().default(false),
  filedDocumentId:   uuid("filed_document_id"),
  filedAt:           timestamp("filed_at", { withTimezone: true }),
  // migration 0008 (review / filing / retention)
  piiFindings:       jsonb("pii_findings").$type<unknown[] | null>(),
  degradedPages:     jsonb("degraded_pages").$type<unknown[] | null>(),
  pageImageCount:    integer("page_image_count").notNull().default(0),
  reviewOverrides:   jsonb("review_overrides").$type<{ pages?: Record<string, string> } | null>(),
  finalTextKey:      varchar("final_text_key", { length: 1000 }),
  searchText:        text("search_text"),
  retentionDeletedAt: timestamp("retention_deleted_at", { withTimezone: true }),
  retentionUnlinkPending: boolean("retention_unlink_pending").notNull().default(false),
  version:           integer("version").notNull().default(1),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only (service role has SELECT + INSERT only). */
export const fileEvents = bulkScanSchema.table("file_events", {
  id:        uuid("id").primaryKey(),
  tenantId:  uuid("tenant_id").notNull(),
  fileId:    uuid("file_id").notNull(),
  batchId:   uuid("batch_id").notNull(),
  fromState: varchar("from_state", { length: 24 }),
  toState:   varchar("to_state", { length: 24 }).notNull(),
  actorId:   uuid("actor_id"),
  reason:    varchar("reason", { length: 64 }),
  detail:    jsonb("detail").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = bulkScanSchema.table("settings", {
  id:        uuid("id").primaryKey(),
  tenantId:  uuid("tenant_id").notNull(),
  config:    jsonb("config").$type<Record<string, unknown>>().notNull(),
  version:   integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settingsChangeRequests = bulkScanSchema.table("settings_change_requests", {
  id:             uuid("id").primaryKey(),
  tenantId:       uuid("tenant_id").notNull(),
  proposed:       jsonb("proposed").$type<Record<string, unknown>>().notNull(),
  baseVersion:    integer("base_version").notNull().default(0),
  status:         varchar("status", { length: 16 }).notNull().default("pending"),
  maker:          uuid("maker").notNull(),
  checker:        uuid("checker"),
  reason:         text("reason"),
  decisionReason: text("decision_reason"),
  sensitive:      boolean("sensitive").notNull().default(false),
  /** 'settings' | 'profile' (profile create/update/delete overriding a sensitive field; see migration 0006). */
  kind:           varchar("kind", { length: 16 }).notNull().default("settings"),
  profileId:      uuid("profile_id"),
  profileChange:  jsonb("profile_change").$type<Record<string, unknown>>(),
  decidedAt:      timestamp("decided_at", { withTimezone: true }),
  version:        integer("version").notNull().default(1),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = bulkScanSchema.table("profiles", {
  id:          uuid("id").primaryKey(),
  tenantId:    uuid("tenant_id").notNull(),
  name:        varchar("name", { length: 120 }).notNull(),
  description: varchar("description", { length: 500 }),
  config:      jsonb("config").$type<Record<string, unknown>>().notNull(),
  version:     integer("version").notNull().default(1),
  deletedAt:   timestamp("deleted_at", { withTimezone: true }),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Link orchestration: links.ts / link-consumer.ts. State: requested | awaiting_approval | linked | rejected | flagged_mismatch | unlink_requested | unlinked. */
export const links = bulkScanSchema.table("links", {
  id:          uuid("id").primaryKey(),
  tenantId:    uuid("tenant_id").notNull(),
  fileId:      uuid("file_id").notNull(),
  documentId:  uuid("document_id"),
  target:      varchar("target", { length: 32 }).notNull(),
  targetId:    varchar("target_id", { length: 128 }).notNull(),
  state:       varchar("state", { length: 24 }).notNull().default("requested"),
  requestedBy: uuid("requested_by").notNull(),
  approvedBy:  uuid("approved_by"),
  reason:      text("reason"),
  financeHint: jsonb("finance_hint").$type<Record<string, unknown> | null>(),
  resultReason: varchar("result_reason", { length: 500 }),
  resultDetail: jsonb("result_detail").$type<Record<string, string | number | boolean> | null>(),
  version:     integer("version").notNull().default(1),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BatchRow = typeof batches.$inferSelect;
export type BatchInsert = typeof batches.$inferInsert;
export type BatchFileRow = typeof batchFiles.$inferSelect;
export type BatchFileInsert = typeof batchFiles.$inferInsert;
export type FileEventRow = typeof fileEvents.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type ChangeRequestRow = typeof settingsChangeRequests.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type LinkRow = typeof links.$inferSelect;

export const schema = { batches, batchFiles, fileEvents, settings, settingsChangeRequests, profiles, links };
