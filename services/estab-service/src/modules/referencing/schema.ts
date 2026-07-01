import { pgSchema, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const filesSchema = pgSchema("files");

/** Structured reference (R7, CSMOP "Referencing"). */
export const estabReference = filesSchema.table("estab_reference", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  fileId:       uuid("file_id").notNull(),
  noteId:       uuid("note_id"),
  refType:      text("ref_type").notNull(),
  refValue:     text("ref_value").notNull(),
  label:        text("label"),
  targetFileId: uuid("target_file_id"),
  pageFrom:     integer("page_from"),
  pageTo:       integer("page_to"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
});

export type ReferenceRow = typeof estabReference.$inferSelect;
export type ReferenceInsert = typeof estabReference.$inferInsert;
export const schema = { estabReference };
