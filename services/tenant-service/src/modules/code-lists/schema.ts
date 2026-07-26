import { pgSchema, uuid, varchar, text, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

const tenantSchema = pgSchema("tenant");

export const codeLists = tenantSchema.table("code_lists", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id"),           // null = platform-global
  code:        varchar("code", { length: 64 }).notNull(),
  name:        varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  isSystem:    boolean("is_system").notNull().default(false),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by"),
});

export const codeValues = tenantSchema.table("code_values", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id"),
  listId:        uuid("list_id").notNull(),
  code:          varchar("code", { length: 64 }).notNull(),
  label:         varchar("label", { length: 200 }).notNull(),
  sortOrder:     integer("sort_order").notNull().default(0),
  isActive:      boolean("is_active").notNull().default(true),
  metadata:      jsonb("metadata").notNull().default({}),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo:   timestamp("effective_to", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
});

export type CodeListRow = typeof codeLists.$inferSelect;
export type CodeValueRow = typeof codeValues.$inferSelect;
export const codeListSchema = { codeLists, codeValues };
