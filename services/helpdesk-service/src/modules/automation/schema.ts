import { pgSchema, uuid, text, varchar, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

/**
 * Automation rules — configurable trigger→action rules evaluated per ticket.
 *
 * Trigger types:
 *  - "field_match": { field: string, value: string }
 *  - "time_elapsed": { thresholdMinutes: number }
 *  - "keyword_match": { keywords: string[] }
 *
 * Action types:
 *  - "assign": { to: string (userId) }
 *  - "escalate": { level: number }
 *  - "notify": { channel: string, recipients: string[] }
 *  - "change_priority": { newPriority: string }
 */
export const automationRules = helpdeskSchema.table("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  ordinal: integer("ordinal").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").notNull().$type<AutomationTrigger>(),
  actions: jsonb("actions").notNull().$type<AutomationAction[]>(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

// --- Trigger types ---

export interface FieldMatchTrigger {
  type: "field_match";
  field: string;
  value: string;
}

export interface TimeElapsedTrigger {
  type: "time_elapsed";
  thresholdMinutes: number;
}

export interface KeywordMatchTrigger {
  type: "keyword_match";
  keywords: string[];
}

export type AutomationTrigger = FieldMatchTrigger | TimeElapsedTrigger | KeywordMatchTrigger;

// --- Action types ---

export interface AssignAction {
  type: "assign";
  to: string;
}

export interface EscalateAction {
  type: "escalate";
  level: number;
}

export interface NotifyAction {
  type: "notify";
  channel: string;
  recipients: string[];
}

export interface ChangePriorityAction {
  type: "change_priority";
  newPriority: string;
}

export type AutomationAction = AssignAction | EscalateAction | NotifyAction | ChangePriorityAction;

// --- Inferred types ---

export type AutomationRuleRow = typeof automationRules.$inferSelect;
export type AutomationRuleInsert = typeof automationRules.$inferInsert;

export const schema = { automationRules };
