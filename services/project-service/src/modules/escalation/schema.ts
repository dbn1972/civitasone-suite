import {
  pgSchema, uuid, varchar, text, timestamp, integer,
} from "drizzle-orm/pg-core";

// Escalation records live under the project schema alongside project records.
export const escalationSchema = pgSchema("project");

/**
 * GAP-PROJECTS-ESCALATIONS-02: an actionable project-escalation record.
 *
 * The /v1/projects/escalations list is a SYNTHETIC projection of projects in a
 * delayed/on_hold/blocked status — it has no escalation entity of its own, so
 * an escalation could not be acknowledged, reassigned or cleared. This table
 * persists the ACTION STATE for an escalation, keyed by the project it
 * concerns (one actionable record per tenant+project). The list endpoint
 * overlays this persisted state onto the projection: a project with no row here
 * reads as a fresh "open" escalation; once acted on, the persisted
 * status/assignee/notes win.
 *
 * Lifecycle: open → acknowledged → cleared, with reassign a side transition
 * that only changes escalatedTo. A cleared escalation is terminal.
 */
export const projectEscalations = escalationSchema.table("project_escalations", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  projectId:       uuid("project_id").notNull(),
  severity:        varchar("severity", { length: 16 }).notNull().default("pending"),
  issue:           text("issue"),
  escalatedTo:     varchar("escalated_to", { length: 200 }),
  status:          varchar("status", { length: 16 }).notNull().default("open"),
  acknowledgedBy:  uuid("acknowledged_by"),
  acknowledgedAt:  timestamp("acknowledged_at", { withTimezone: true }),
  clearedBy:       uuid("cleared_by"),
  clearedAt:       timestamp("cleared_at", { withTimezone: true }),
  note:            text("note"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type EscalationRow = typeof projectEscalations.$inferSelect;
export type EscalationInsert = typeof projectEscalations.$inferInsert;

export const schema = { projectEscalations };
