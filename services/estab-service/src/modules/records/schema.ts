import {
  pgSchema, uuid, text, varchar, integer, date, timestamp, index, primaryKey,
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
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }),
  updatedBy:      uuid("updated_by"),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.fileId] }),
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

export type FileRecordRow    = typeof estabFileRecord.$inferSelect;
export type FileRecordInsert = typeof estabFileRecord.$inferInsert;
export type WeedoutRow       = typeof estabWeedout.$inferSelect;
export type WeedoutInsert    = typeof estabWeedout.$inferInsert;

export const schema = { estabFileRecord, estabWeedout };
