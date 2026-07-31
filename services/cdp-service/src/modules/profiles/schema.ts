/**
 * profiles module — Drizzle schema. Golden profile store for identity resolution.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const cdpSchema = pgSchema("cdp");

export const profiles = cdpSchema.table("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileType: varchar("profile_type", { length: 32 }).notNull().default("individual"),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
  sourceLineage: jsonb("source_lineage").$type<Array<{ source: string; sourceId: string; timestamp: string }>>().notNull().default([]),
  mergedFromIds: jsonb("merged_from_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ProfileRow = typeof profiles.$inferSelect;
export type ProfileInsert = typeof profiles.$inferInsert;

export const schema = { profiles };
