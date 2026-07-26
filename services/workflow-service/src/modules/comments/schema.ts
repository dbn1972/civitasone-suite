import { pgSchema, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

/** CAP-038 — a threaded comment/note on any (entityType, entityId). */
export const entityComments = domainSchema.table("entity_comments", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  entityType:      varchar("entity_type", { length: 48 }).notNull(),
  entityId:        uuid("entity_id").notNull(),
  parentCommentId: uuid("parent_comment_id"),
  body:            text("body").notNull(),
  visibility:      varchar("visibility", { length: 12 }).notNull().default("internal"),
  authorId:        uuid("author_id").notNull(),
  editedAt:        timestamp("edited_at", { withTimezone: true }),
  deletedAt:       timestamp("deleted_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommentRow = typeof entityComments.$inferSelect;

export const schema = { entityComments };
