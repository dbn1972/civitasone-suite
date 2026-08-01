/**
 * activations module — Drizzle schema. CDP-012 one row per segment→channel dispatch.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const cdpSchema = pgSchema("cdp");

export const activations = cdpSchema.table("activations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  segmentId: uuid("segment_id").notNull(),
  channel: varchar("channel", { length: 24 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  // Snapshot of the audience at dispatch time. Kept on the run row because the segment
  // keeps changing: without it, a completed run's reach can never be reconciled.
  audienceCount: integer("audience_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
});

export type ActivationRow = typeof activations.$inferSelect;
export type ActivationInsert = typeof activations.$inferInsert;

export const schema = { activations };
