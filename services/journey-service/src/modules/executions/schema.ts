/**
 * executions module — Journey execution instances (enrollment tracking).
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const journeySchema = pgSchema("journey");

/** Journey execution instances — tracks profile enrollment and progress through journeys. */
export const journeyExecutions = journeySchema.table("journey_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  journeyId: uuid("journey_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  /** Status: enrolled, in_progress, completed, exited. */
  status: varchar("status", { length: 24 }).notNull().default("enrolled"),
  currentStepIndex: integer("current_step_index").notNull().default(0),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export type JourneyExecutionRow = typeof journeyExecutions.$inferSelect;
export type JourneyExecutionInsert = typeof journeyExecutions.$inferInsert;

export const schema = { journeyExecutions };
