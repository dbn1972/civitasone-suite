import { pgSchema, uuid, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const installSchema = pgSchema("install");

export const siloProvisions = installSchema.table("silo_provisions", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  dbName:            text("db_name").notNull(),
  status:            text("status").notNull().default("requested"),
  steps:             jsonb("steps").notNull().default([]),
  error:             text("error"),
  requestedAt:       timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  readyAt:           timestamp("ready_at", { withTimezone: true }),
  // Provisioning_Actuator poll-loop state (migration 0011_provisioning_actuator.sql, task 7.7):
  // durable resumable progress + staleness detection for a crashed/interrupted runner.
  appliedMigrations: jsonb("applied_migrations").$type<string[]>().notNull().default([]),
  runnerStartedAt:   timestamp("runner_started_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export type SiloProvisionRow = typeof siloProvisions.$inferSelect;
export type SiloProvisionInsert = typeof siloProvisions.$inferInsert;

export const schema = { siloProvisions };
