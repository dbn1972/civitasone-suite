import {
  pgSchema, uuid, text, varchar, integer, boolean, timestamp, date,
} from "drizzle-orm/pg-core";

// Reuse the same "files" PG schema the files module owns (this is the eFile
// bounded context — correspondence is the yellow side of those files).
export const filesSchema = pgSchema("files");

export const estabCorrespondence = filesSchema.table("estab_correspondence", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  fileId:       uuid("file_id").notNull(),
  corrNo:       text("corr_no").notNull(),
  direction:    varchar("direction", { length: 16 }).notNull(),
  letterRef:    text("letter_ref"),
  letterDate:   date("letter_date"),
  party:        text("party").notNull(),
  subject:      text("subject").notNull(),
  pageFrom:     integer("page_from").notNull(),
  pageTo:       integer("page_to").notNull(),
  storageRef:   text("storage_ref"),
  isOfficeCopy: boolean("is_office_copy").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const estabFilePuc = filesSchema.table("estab_file_puc", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  fileId:           uuid("file_id").notNull(),
  correspondenceId: uuid("correspondence_id").notNull(),
  markedBy:         uuid("marked_by").notNull(),
  markedAt:         timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  active:           boolean("active").notNull().default(true),
});

export type CorrespondenceRow    = typeof estabCorrespondence.$inferSelect;
export type CorrespondenceInsert = typeof estabCorrespondence.$inferInsert;
export type FilePucRow    = typeof estabFilePuc.$inferSelect;
export type FilePucInsert = typeof estabFilePuc.$inferInsert;

export const schema = { estabCorrespondence, estabFilePuc };
