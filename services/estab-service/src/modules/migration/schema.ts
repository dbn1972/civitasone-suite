import {
  pgSchema, uuid, text, integer, timestamp,
} from "drizzle-orm/pg-core";

export const filesSchema = pgSchema("files");

export const estabMigrationRegister = filesSchema.table("estab_migration_register", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  legacyFileNo: text("legacy_file_no").notNull(),
  subject:      text("subject").notNull(),
  dept:         text("dept").notNull(),
  pageCount:    integer("page_count").notNull().default(0),
  scanRef:      text("scan_ref"),
  efileId:      uuid("efile_id"),
  status:       text("status").notNull().default("registered"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type MigrationRow = typeof estabMigrationRegister.$inferSelect;
export type MigrationInsert = typeof estabMigrationRegister.$inferInsert;

export const schema = { estabMigrationRegister };
