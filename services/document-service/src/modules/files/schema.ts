import { pgSchema, uuid, varchar, integer, bigint, timestamp, text, boolean } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("document");

export const files = domainSchema.table("files", {
  id:          uuid("id").primaryKey(),
  tenantId:    uuid("tenant_id").notNull(),
  folderId:    uuid("folder_id"),
  name:        varchar("name", { length: 500 }).notNull(),
  mimeType:    varchar("mime_type", { length: 128 }),
  sizeBytes:   bigint("size_bytes", { mode: "number" }),
  storageKey:  varchar("storage_key", { length: 1000 }),
  tags:        text("tags").array().notNull().default([]),
  status:      varchar("status", { length: 32 }).notNull().default("active"),
  version:     integer("version").notNull().default(1),
  deletedAt:   timestamp("deleted_at", { withTimezone: true }),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fileVersions = domainSchema.table("file_versions", {
  id:         uuid("id").primaryKey(),
  fileId:     uuid("file_id").notNull(),
  tenantId:   uuid("tenant_id").notNull(),
  version:    integer("version").notNull(),
  storageKey: varchar("storage_key", { length: 1000 }),
  sizeBytes:  bigint("size_bytes", { mode: "number" }),
  createdBy:  uuid("created_by").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FileRow     = typeof files.$inferSelect;
export type FileInsert  = typeof files.$inferInsert;
export type VersionRow  = typeof fileVersions.$inferSelect;

export type FileView = {
  id:         string;
  tenantId:   string;
  folderId:   string | null;
  name:       string;
  mimeType:   string | null;
  sizeBytes:  number | null;
  storageKey: string | null;
  tags:       string[];
  status:     string;
  version:    number;
  createdAt:  Date;
  updatedAt:  Date;
};

export const schema = { files, fileVersions };
