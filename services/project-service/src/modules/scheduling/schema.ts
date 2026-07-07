import { pgSchema, uuid, varchar, bigint, integer, timestamp } from "drizzle-orm/pg-core";

export const projectSchema = pgSchema("project");

/**
 * Task dependencies table — stores relationships between project tasks.
 * Supports FS (Finish-to-Start), SS (Start-to-Start), FF (Finish-to-Finish),
 * SF (Start-to-Finish) dependency types with configurable lag/lead in ms.
 */
export const taskDependencies = projectSchema.table("task_dependencies", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  projectId:   uuid("project_id").notNull(),
  fromTaskId:  uuid("from_task_id").notNull(),
  toTaskId:    uuid("to_task_id").notNull(),
  depType:     varchar("dep_type", { length: 2 }).notNull().default("FS"),
  lagMs:       bigint("lag_ms", { mode: "bigint" }).notNull().default(0n),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:     integer("version").notNull().default(1),
});

export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type TaskDependencyInsert = typeof taskDependencies.$inferInsert;

export const schema = { taskDependencies };
