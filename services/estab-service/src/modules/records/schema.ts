import {
  pgSchema, uuid, text, varchar, integer, boolean, date, timestamp, index, primaryKey,
} from "drizzle-orm/pg-core";

// Records management lives in the existing `files` PG schema (module isolation:
// estab-service owns the `files` schema across its file-lifecycle modules).
export const filesSchema = pgSchema("files");

/**
 * Per-file record-management metadata: the assigned CSMOP record category, the
 * derived statutory retention period + review-due date, and (once disposed) the
 * disposal action. PK is composite (tenant_id, file_id) — one record row per file.
 */
export const estabFileRecord = filesSchema.table("estab_file_record", {
  tenantId:       uuid("tenant_id").notNull(),
  fileId:         uuid("file_id").notNull(),
  recordCategory: varchar("record_category", { length: 2 }).notNull(),
  retentionYears: integer("retention_years"),
  reviewDueDate:  date("review_due_date"),
  disposalAction: text("disposal_action"),
  disposedAt:     timestamp("disposed_at", { withTimezone: true }),
  disposedBy:     uuid("disposed_by"),
  // Record-room physical location (R4).
  roomStatus:     varchar("room_status", { length: 24 }).notNull().default("in_section"), // in_section|in_record_room|issued
  recordRoomId:   text("record_room_id"),
  rack:           text("rack"),
  shelf:          text("shelf"),
  bundleNo:       text("bundle_no"),
  transferredAt:  timestamp("transferred_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }),
  updatedBy:      uuid("updated_by"),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.fileId] }),
}));

/**
 * Record-room issue/receipt register (R4) — tracks requisition of a recorded
 * file out of the record room and its return.
 */
export const estabRecordRequisition = filesSchema.table("estab_record_requisition", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  fileId:      uuid("file_id").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  purpose:     text("purpose"),
  status:      varchar("status", { length: 16 }).notNull().default("issued"), // issued|returned
  issuedAt:    timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  dueBack:     date("due_back"),
  returnedAt:  timestamp("returned_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  version:     integer("version").notNull().default(1),
}, (t) => ({
  byFile:   index("idx_estab_requisition_file").on(t.tenantId, t.fileId),
  byStatus: index("idx_estab_requisition_status").on(t.tenantId, t.status),
}));

/**
 * Weed-out (destruction) approval workflow: propose → approve/reject → destroy.
 * Maker≠checker is enforced at approve; assertWeedable gates the approve step.
 */
export const estabWeedout = filesSchema.table("estab_weedout", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  fileId:            uuid("file_id").notNull(),
  status:            varchar("status", { length: 16 }).notNull().default("proposed"),
  proposedBy:        uuid("proposed_by").notNull(),
  proposedAt:        timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedBy:        uuid("reviewed_by"),
  reviewedAt:        timestamp("reviewed_at", { withTimezone: true }),
  destructionCertRef: text("destruction_cert_ref"),
  destroyedAt:       timestamp("destroyed_at", { withTimezone: true }),
  reason:            text("reason"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version:           integer("version").notNull().default(1),
}, (t) => ({
  byFile:   index("idx_estab_weedout_file").on(t.tenantId, t.fileId),
  byStatus: index("idx_estab_weedout_status").on(t.tenantId, t.status),
}));

/**
 * Archival workflow (R5, Public Records Act 1993). A distinct lifecycle
 * stage from closure — Cat-A permanent records become NAI-eligible 25y after
 * closure and are explicitly transferred to the National Archives.
 */
export const estabArchival = filesSchema.table("estab_archival", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  fileId:          uuid("file_id").notNull(),
  archivedAt:      timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
  archivedBy:      uuid("archived_by").notNull(),
  naiEligibleAt:   timestamp("nai_eligible_at", { withTimezone: true }),
  naiTransferredAt: timestamp("nai_transferred_at", { withTimezone: true }),
  naiReference:    text("nai_reference"),
  registerNo:      text("register_no"),
  status:          varchar("status", { length: 20 }).notNull().default("archived"),
  remarks:         text("remarks"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type ArchivalRow    = typeof estabArchival.$inferSelect;
export type ArchivalInsert = typeof estabArchival.$inferInsert;

/**
 * Records Officer designation (R6, Public Records Rules 1997).
 * One active Records Officer per tenant.
 */
export const estabRecordsOfficer = filesSchema.table("estab_records_officer", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  operatorId:  uuid("operator_id").notNull(),
  orgUnitId:   uuid("org_unit_id"),
  appointedAt: timestamp("appointed_at", { withTimezone: true }).notNull().defaultNow(),
  active:      boolean("active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

/** Annual review register (R6). */
export const estabAnnualReview = filesSchema.table("estab_annual_review", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  fileId:        uuid("file_id").notNull(),
  reviewedAt:    timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedBy:    uuid("reviewed_by").notNull(),
  decision:      varchar("decision", { length: 16 }).notNull(),
  remarks:       text("remarks"),
  nextReviewDue: date("next_review_due"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export type RecordsOfficerRow    = typeof estabRecordsOfficer.$inferSelect;
export type RecordsOfficerInsert = typeof estabRecordsOfficer.$inferInsert;
export type AnnualReviewRow      = typeof estabAnnualReview.$inferSelect;
export type AnnualReviewInsert   = typeof estabAnnualReview.$inferInsert;

export type FileRecordRow    = typeof estabFileRecord.$inferSelect;
export type FileRecordInsert = typeof estabFileRecord.$inferInsert;
export type RequisitionRow   = typeof estabRecordRequisition.$inferSelect;
export type RequisitionInsert = typeof estabRecordRequisition.$inferInsert;
export type WeedoutRow       = typeof estabWeedout.$inferSelect;
export type WeedoutInsert    = typeof estabWeedout.$inferInsert;

export const schema = { estabFileRecord, estabRecordRequisition, estabArchival, estabRecordsOfficer, estabAnnualReview, estabWeedout };
