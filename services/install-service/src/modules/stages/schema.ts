import { pgSchema, uuid, varchar, integer, timestamp, boolean, text } from "drizzle-orm/pg-core";

export const installSchema = pgSchema("install");

export const stages = installSchema.table("stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  stepNumber: integer("step_number").notNull(),
  description: varchar("description", { length: 500 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  // Columns added by migration 0002_install_execution.sql (previously missing
  // from this model); 0016 widens the status CHECK so the lifecycle verbs can
  // actually persist in_progress / failed.
  isRequired: boolean("is_required").notNull().default(true),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type StageRow = typeof stages.$inferSelect;
export type StageInsert = typeof stages.$inferInsert;

export type StageView = {
  id: string;
  tenantId: string;
  name: string;
  stepNumber: number;
  description: string | null;
  status: string;
  isRequired: boolean;
  completedAt: string | null;
  errorMessage: string | null;
  version: number;
};

export const schema = { stages };
