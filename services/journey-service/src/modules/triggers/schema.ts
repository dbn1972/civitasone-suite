/**
 * triggers module — Trigger definitions for journey enrollment.
 * Supports event-based, time-based, and segment-entry triggers.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const journeySchema = pgSchema("journey");

/** Trigger definitions — conditions that enroll profiles into journeys. */
export const triggers = journeySchema.table("triggers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  journeyId: uuid("journey_id").notNull(),
  /** Trigger type: event_based, time_based, segment_entry. */
  triggerType: varchar("trigger_type", { length: 32 }).notNull(),
  /** JSON configuration specific to the trigger type. */
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TriggerRow = typeof triggers.$inferSelect;
export type TriggerInsert = typeof triggers.$inferInsert;

export const schema = { triggers };
