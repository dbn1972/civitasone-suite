import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { SandboxStep } from "./domain.js";

export const packsSchema = pgSchema("packs");

export const sandboxTestRuns = packsSchema.table("sandbox_test_runs", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  serviceDefinitionId: uuid("service_definition_id").notNull(),
  status:              varchar("status", { length: 16 }).notNull(),
  steps:               jsonb("steps").$type<SandboxStep[]>().notNull().default([]),
  durationMs:          integer("duration_ms"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
});

export type SandboxTestRunRow = typeof sandboxTestRuns.$inferSelect;
export type SandboxTestRunInsert = typeof sandboxTestRuns.$inferInsert;

export const schema = { sandboxTestRuns };
