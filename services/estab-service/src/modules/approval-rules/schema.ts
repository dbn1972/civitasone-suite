import {
  pgSchema, uuid, text, integer, bigint, boolean, jsonb, timestamp,
} from "drizzle-orm/pg-core";

// Reuse the existing `files` schema (eOffice owns its own PG schema).
export const filesSchema = pgSchema("files");

export const estabApprovalRule = filesSchema.table("estab_approval_rule", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  tenantId:               uuid("tenant_id").notNull(),
  module:                 text("module").notNull(),
  sourceType:             text("source_type").notNull(),
  label:                  text("label").notNull(),
  minAmountMinor:         bigint("min_amount_minor", { mode: "number" }).notNull().default(0),
  maxAmountMinor:         bigint("max_amount_minor", { mode: "number" }),
  workflowDefinitionCode: text("workflow_definition_code").notNull(),
  startNodeKey:           text("start_node_key").notNull().default("review"),
  steps:                  jsonb("steps").notNull().default([]),
  priority:               integer("priority").notNull().default(100),
  active:                 boolean("active").notNull().default(true),
  createdAt:              timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:              uuid("created_by").notNull(),
  updatedBy:              uuid("updated_by").notNull(),
  version:                integer("version").notNull().default(1),
});

export type ApprovalRuleRow = typeof estabApprovalRule.$inferSelect;
export type ApprovalRuleInsert = typeof estabApprovalRule.$inferInsert;

export const schema = { estabApprovalRule };
