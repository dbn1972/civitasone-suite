/**
 * steps module — Step execution log schema.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const journeySchema = pgSchema("journey");

/** Log of step executions for enrolled profiles. */
export const stepExecutions = journeySchema.table("step_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  journeyId: uuid("journey_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  stepIndex: integer("step_index").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type StepExecutionRow = typeof stepExecutions.$inferSelect;
export type StepExecutionInsert = typeof stepExecutions.$inferInsert;

export const schema = { stepExecutions };
