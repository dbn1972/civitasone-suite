import { pgSchema, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

export const taskForwards = domainSchema.table("task_forwards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  taskId: uuid("task_id").notNull(),
  instanceId: uuid("instance_id").notNull(),
  fromUser: uuid("from_user").notNull(),
  toUser: uuid("to_user").notNull(),
  remarks: varchar("remarks", { length: 512 }),
  action: varchar("action", { length: 16 }).notNull().default("forward"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskForwardRow = typeof taskForwards.$inferSelect;
export type TaskForwardInsert = typeof taskForwards.$inferInsert;

export const schema = { taskForwards };
