import { pgSchema, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("document");

export const fileShares = domainSchema.table("file_shares", {
  id:        uuid("id").primaryKey(),
  tenantId:  uuid("tenant_id").notNull(),
  fileId:    uuid("file_id").notNull(),
  sharedWith: uuid("shared_with").notNull(),
  permission: varchar("permission", { length: 32 }).notNull().default("read"),
  revokedAt:  timestamp("revoked_at", { withTimezone: true }),
  createdBy:  uuid("created_by").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShareRow    = typeof fileShares.$inferSelect;
export type ShareInsert = typeof fileShares.$inferInsert;

export const schema = { fileShares };
