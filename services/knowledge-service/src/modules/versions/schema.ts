import { pgSchema, uuid, varchar, integer, bigint, timestamp, text } from "drizzle-orm/pg-core";

export const knowledgeSchema = pgSchema("knowledge");

export const documentVersions = knowledgeSchema.table("document_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  versionNo: integer("version_no").notNull(),
  s3Key: varchar("s3_key", { length: 1024 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  changeNote: text("change_note").notNull().default(""),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DocumentVersionRow = typeof documentVersions.$inferSelect;
export type DocumentVersionInsert = typeof documentVersions.$inferInsert;

export type DocumentVersionView = {
  id: string;
  tenantId: string;
  documentId: string;
  versionNo: number;
  s3Key: string;
  sizeBytes: number | null;
  changeNote: string;
  createdBy: string;
  createdAt: Date;
};

export const schema = { documentVersions };
