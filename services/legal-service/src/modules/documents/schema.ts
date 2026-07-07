import { pgSchema, uuid, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const documentsSchema = pgSchema("documents");

/**
 * matter_documents — folders and files in a hierarchical matter-centric DMS.
 *
 * Supports up to 5 levels deep folder hierarchy per matter.
 * Legal-hold flag prevents deletion and content modification when true.
 */
export const matterDocuments = documentsSchema.table("matter_documents", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  matterId:       uuid("matter_id").notNull(),
  parentFolderId: uuid("parent_folder_id"),
  name:           text("name").notNull(),
  type:           text("type").notNull(), // 'folder' | 'file'
  body:           text("body"),
  fileKey:        text("file_key"),
  version:        integer("version").notNull().default(1),
  legalHold:      boolean("legal_hold").notNull().default(false),
  depth:          integer("depth").notNull().default(0),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
});

/**
 * document_versions — stores all prior versions of a file for full version history.
 */
export const documentVersions = documentsSchema.table("document_versions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  documentId:    uuid("document_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  body:          text("body"),
  fileKey:       text("file_key"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export type MatterDocumentRow = typeof matterDocuments.$inferSelect;
export type MatterDocumentInsert = typeof matterDocuments.$inferInsert;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;
export type DocumentVersionInsert = typeof documentVersions.$inferInsert;

export const schema = { matterDocuments, documentVersions };
