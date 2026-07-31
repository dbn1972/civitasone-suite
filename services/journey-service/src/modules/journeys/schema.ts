/**
 * journeys module — Drizzle schema. Lives in its OWN Postgres schema `journey`.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const journeySchema = pgSchema("journey");

/** Journey definitions — multi-step campaign orchestration blueprints. */
export const journeys = journeySchema.table("journeys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  /** JSON trigger configuration (event, schedule, segment-entry). */
  triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>(),
  /** Ordered list of step definitions for this journey. */
  steps: jsonb("steps").$type<Array<Record<string, unknown>>>().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export type JourneyRow = typeof journeys.$inferSelect;
export type JourneyInsert = typeof journeys.$inferInsert;

export const schema = { journeys };
