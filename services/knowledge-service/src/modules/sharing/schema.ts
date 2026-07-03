import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const knowledgeSchema = pgSchema("knowledge");

export const documentShares = knowledgeSchema.table("document_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  sharedWith: uuid("shared_with").notNull(),
  permission: varchar("permission", { length: 24 }).notNull().default("view"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DocumentShareRow = typeof documentShares.$inferSelect;
export type DocumentShareInsert = typeof documentShares.$inferInsert;

export type DocumentShareView = {
  id: string;
  tenantId: string;
  documentId: string;
  sharedWith: string;
  permission: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  version: number;
};

export const schema = { documentShares };
