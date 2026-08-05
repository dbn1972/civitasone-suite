/**
 * CH-19 — Message attachments table (notification schema).
 */
import { pgSchema, uuid, varchar, bigint, timestamp } from "drizzle-orm/pg-core";

export const notificationSchema = pgSchema("notification");

export const messageAttachments = notificationSchema.table("message_attachments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id"),
  messageId:      uuid("message_id"),
  filename:       varchar("filename", { length: 256 }).notNull(),
  mimeType:       varchar("mime_type", { length: 128 }).notNull(),
  sizeBytes:      bigint("size_bytes", { mode: "bigint" }).notNull(),
  storageKey:     varchar("storage_key", { length: 512 }).notNull(),
  scanStatus:     varchar("scan_status", { length: 16 }).notNull().default("pending"),
  scannedAt:      timestamp("scanned_at", { withTimezone: true }),
  uploadedBy:     uuid("uploaded_by").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MessageAttachmentRow = typeof messageAttachments.$inferSelect;
export type MessageAttachmentInsert = typeof messageAttachments.$inferInsert;

export const attachmentsModuleSchema = { messageAttachments };
