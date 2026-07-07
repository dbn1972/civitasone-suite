import { pgSchema, uuid, text, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const ticketEscalations = helpdeskSchema.table("ticket_escalations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  ticketId:    uuid("ticket_id").notNull(),
  escalatedBy: uuid("escalated_by").notNull(),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
  reason:      text("reason").notNull(),
  level:       integer("level").notNull().default(1),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
});

/**
 * SLA Policies — tenant-configurable response/resolution deadlines per priority+category.
 *
 * Each policy defines how many minutes are allowed for first response and full
 * resolution for tickets matching the priority (and optionally category).
 */
export const slaPolicies = helpdeskSchema.table("sla_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  priority: varchar("priority", { length: 24 }).notNull(),
  category: varchar("category", { length: 128 }),
  responseMinutes: integer("response_minutes").notNull(),
  resolutionMinutes: integer("resolution_minutes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/**
 * CSAT Responses — Customer Satisfaction survey results (1–5 scale).
 *
 * Survey is sent within 15 minutes of ticket resolution. Each ticket
 * can have at most one CSAT response.
 */
export const csatResponses = helpdeskSchema.table("csat_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type SlaPolicyRow = typeof slaPolicies.$inferSelect;
export type SlaPolicyInsert = typeof slaPolicies.$inferInsert;
export type CsatResponseRow = typeof csatResponses.$inferSelect;
export type CsatResponseInsert = typeof csatResponses.$inferInsert;

export const schema = { ticketEscalations, slaPolicies, csatResponses };
