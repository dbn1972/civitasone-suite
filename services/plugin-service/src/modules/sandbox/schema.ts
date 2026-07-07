import { pgSchema, uuid, varchar, integer, timestamp, real, text } from "drizzle-orm/pg-core";

export const sandboxSchema = pgSchema("sandbox");

/**
 * Tracks plugin execution history for audit, debugging, and resource monitoring.
 *
 * Columns:
 *   id             - Unique execution identifier
 *   tenantId       - Tenant that owns the plugin invocation
 *   pluginId       - The plugin being executed
 *   startedAt      - When execution began
 *   completedAt    - When execution finished (null if still running)
 *   executionTimeMs - Total execution duration in milliseconds
 *   memoryUsedMb   - Peak memory usage during execution in MB
 *   status         - Outcome: success | timeout | error | oom
 *   error          - Error message if status is not success (max 2000 chars)
 */
export const pluginExecutions = sandboxSchema.table("plugin_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  pluginId: uuid("plugin_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  executionTimeMs: integer("execution_time_ms").notNull(),
  memoryUsedMb: real("memory_used_mb").notNull(),
  status: varchar("status", { length: 16 }).notNull(), // success | timeout | error | oom
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PluginExecutionRow = typeof pluginExecutions.$inferSelect;
export type PluginExecutionInsert = typeof pluginExecutions.$inferInsert;

export const schema = { pluginExecutions };
