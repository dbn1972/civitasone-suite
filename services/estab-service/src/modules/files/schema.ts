import {
  pgSchema, uuid, text, varchar, integer, boolean, timestamp,
} from "drizzle-orm/pg-core";

export const filesSchema = pgSchema("files");

export const estabFiles = filesSchema.table("estab_files", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  fileNo:         text("file_no").notNull(),
  subject:        text("subject").notNull(),
  dept:           text("dept").notNull(),
  priority:       varchar("priority", { length: 16 }).notNull().default("normal"),
  classification: varchar("classification", { length: 16 }).notNull().default("public"),
  currentWith:    uuid("current_with").notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("draft"),
  inwardId:       uuid("inward_id"),
  dakNo:          text("dak_no"),
  dueBy:          timestamp("due_by", { withTimezone: true }),
  parentFileId:   uuid("parent_file_id"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const estabNotings = filesSchema.table("estab_notings", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  fileId:     uuid("file_id").notNull(),
  seq:        integer("seq").notNull(),
  officerId:  uuid("officer_id").notNull(),
  body:       text("body").notNull(),
  action:     varchar("action", { length: 64 }),
  noteType:   varchar("note_type", { length: 16 }).notNull().default("yellow"),
  noteStatus: varchar("note_status", { length: 16 }).notNull().default("draft"),
  signatureRef: text("signature_ref"),
  dscHash:      text("dsc_hash"),
  eSigned:    boolean("e_signed").notNull().default(false),
  signedAt:   timestamp("signed_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const estabDispatch = filesSchema.table("estab_dispatch", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  dispatchNo:  text("dispatch_no").notNull(),
  fileId:      uuid("file_id"),
  toAddress:   text("to_address").notNull(),
  mode:        varchar("mode", { length: 32 }).notNull().default("email"),
  subject:     text("subject").notNull(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const estabInward = filesSchema.table("estab_inward", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  dakNo:      text("dak_no").notNull(),
  fromAddress: text("from_address").notNull(),
  subject:    text("subject").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  assignedTo: uuid("assigned_to"),
  fileRef:    text("file_ref"),
  fileId:     uuid("file_id"),
  barcode:    text("barcode"),
  sourceSection: varchar("source_section", { length: 32 }),
  status:     varchar("status", { length: 24 }).notNull().default("received"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const estabFileMovements = filesSchema.table("estab_file_movements", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  fileId:        uuid("file_id").notNull(),
  fromOfficerId: uuid("from_officer_id"),
  toOfficerId:   uuid("to_officer_id").notNull(),
  action:        varchar("action", { length: 30 }).default("forward"),
  remarks:       text("remarks"),
  movedAt:       timestamp("moved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const estabFileAttachments = filesSchema.table("estab_file_attachments", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  fileId:     uuid("file_id").notNull(),
  fileName:   text("file_name").notNull(),
  fileType:   varchar("file_type", { length: 64 }).notNull().default("application/pdf"),
  sizeBytes:  integer("size_bytes").notNull().default(0),
  storageRef: text("storage_ref"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
});

export type FileMovementRow = typeof estabFileMovements.$inferSelect;
export type FileMovementInsert = typeof estabFileMovements.$inferInsert;
export type FileRow    = typeof estabFiles.$inferSelect;
export type FileInsert = typeof estabFiles.$inferInsert;
export type NotingRow  = typeof estabNotings.$inferSelect;
export type NotingInsert = typeof estabNotings.$inferInsert;
export type DispatchRow = typeof estabDispatch.$inferSelect;
export type DispatchInsert = typeof estabDispatch.$inferInsert;
export type InwardRow  = typeof estabInward.$inferSelect;
export type InwardInsert = typeof estabInward.$inferInsert;
export type AttachmentRow = typeof estabFileAttachments.$inferSelect;

export const schema = { estabFiles, estabNotings, estabDispatch, estabInward, estabFileMovements, estabFileAttachments };
