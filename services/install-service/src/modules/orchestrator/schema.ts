import { pgSchema, uuid, varchar, integer, timestamp, boolean, text, jsonb } from "drizzle-orm/pg-core";

export const orchestratorSchema = pgSchema("orchestrator");

export const wizardDefinitions = orchestratorSchema.table("wizard_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const stepDefinitions = orchestratorSchema.table("step_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  wizardId: uuid("wizard_id").notNull().references(() => wizardDefinitions.id),
  stepKey: varchar("step_key", { length: 64 }).notNull(),
  title: varchar("title", { length: 128 }).notNull(),
  description: text("description"),
  isRequired: boolean("is_required").notNull().default(true),
  dependsOn: text("depends_on").array().notNull().default([]),
  handlerType: varchar("handler_type", { length: 64 }).notNull(),
  config: jsonb("config").notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const stepExecutions = orchestratorSchema.table("step_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  wizardId: uuid("wizard_id").notNull().references(() => wizardDefinitions.id),
  stepKey: varchar("step_key", { length: 64 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  output: jsonb("output").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type WizardRow = typeof wizardDefinitions.$inferSelect;
export type WizardInsert = typeof wizardDefinitions.$inferInsert;
export type StepDefRow = typeof stepDefinitions.$inferSelect;
export type StepDefInsert = typeof stepDefinitions.$inferInsert;
export type StepExecRow = typeof stepExecutions.$inferSelect;
export type StepExecInsert = typeof stepExecutions.$inferInsert;

export const schema = { wizardDefinitions, stepDefinitions, stepExecutions };
