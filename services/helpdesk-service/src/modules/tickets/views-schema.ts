/**
 * TKT-11: Saved Views
 *
 * Schema for helpdesk.saved_views — stores per-user or shared filter presets
 * for the ticket list UI.
 */
import { pgSchema, uuid, varchar, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const savedViews = helpdeskSchema.table("saved_views", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  ownerId:   uuid("owner_id").notNull(),
  name:      varchar("name", { length: 200 }).notNull(),
  filters:   jsonb("filters").notNull().default({}),
  columns:   jsonb("columns").notNull().default([]),
  isDefault: boolean("is_default").notNull().default(false),
  shared:    boolean("shared").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version:   integer("version").notNull().default(1),
});

export type SavedViewRow = typeof savedViews.$inferSelect;
export type SavedViewInsert = typeof savedViews.$inferInsert;

export const savedViewsSchema = { savedViews };
