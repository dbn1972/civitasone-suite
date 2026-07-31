/**
 * steward module — Drizzle schema. Merge review queue for ambiguous matches.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";

export const cdpSchema = pgSchema("cdp");

export const mergeQueue = cdpSchema.table("merge_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  sourceProfileId: uuid("source_profile_id").notNull(),
  targetProfileId: uuid("target_profile_id").notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
  matchReason: varchar("match_reason", { length: 500 }),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: varchar("decision_reason", { length: 1000 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type MergeQueueRow = typeof mergeQueue.$inferSelect;
export type MergeQueueInsert = typeof mergeQueue.$inferInsert;

export const schema = { mergeQueue };
