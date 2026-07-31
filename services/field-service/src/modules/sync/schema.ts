/**
 * sync module — Schema for offline sync queue.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const fieldSchema = pgSchema("field");

/** Sync queue — offline operations pending server-side replay. */
export const syncQueue = fieldSchema.table("sync_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  entityType: varchar("entity_type", { length: 32 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  operation: varchar("operation", { length: 16 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  clientTimestamp: timestamp("client_timestamp", { withTimezone: true }).notNull(),
  clientVersion: integer("client_version").notNull().default(1),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SyncQueueRow = typeof syncQueue.$inferSelect;
export type SyncQueueInsert = typeof syncQueue.$inferInsert;

export const schema = { syncQueue };
