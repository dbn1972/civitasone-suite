/**
 * segments module — Drizzle schema. Dynamic segment definitions for audience targeting.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const cdpSchema = pgSchema("cdp");

export const segments = cdpSchema.table("segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 1000 }),
  segmentType: varchar("segment_type", { length: 32 }).notNull().default("dynamic"),
  criteria: jsonb("criteria").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  memberCount: integer("member_count").notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type SegmentRow = typeof segments.$inferSelect;
export type SegmentInsert = typeof segments.$inferInsert;

export const schema = { segments };
