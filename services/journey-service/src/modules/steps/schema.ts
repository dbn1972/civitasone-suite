/**
 * steps module — Step execution log schema.
 */
import { pgSchema, uuid, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";

export const journeySchema = pgSchema("journey");

/** Log of step executions for enrolled profiles. */
export const stepExecutions = journeySchema.table("step_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  journeyId: uuid("journey_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  stepIndex: integer("step_index").notNull(),
  /** The dispatched step type — what this row actually did (P1-8). */
  stepType: varchar("step_type", { length: 32 }),
  /**
   * The journey's step count at dispatch time. Stored so a resumed `wait` can
   * tell "advance to the next step" from "that was the last step, complete the
   * run" without the sweeper reading the journeys module's table.
   */
  totalSteps: integer("total_steps"),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  /** Set only for a parked `wait` step: when the run may resume. */
  resumeAt: timestamp("resume_at", { withTimezone: true }),
  /** Machine-readable reason a step ended non-successfully. */
  failureCode: varchar("failure_code", { length: 48 }),
  /** Operator-facing detail for `failed`/`skipped` outcomes. */
  failureReason: text("failure_reason"),
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
