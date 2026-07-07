import type { HelpdeskTicketSummary } from "@civitasone/types";
import { pgSchema, uuid, text, varchar, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const tickets = helpdeskSchema.table("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  subject: text("subject").notNull(),
  description: text("description"),
  priority: varchar("priority", { length: 24 }).notNull().default("Medium"),
  status: varchar("status", { length: 24 }).notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  assigneeId: uuid("assignee_id"),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
  // HD1 — one-shot SLA-breach notification markers (NULL = not yet notified).
  slaAtRiskNotifiedAt: timestamp("sla_at_risk_notified_at", { withTimezone: true }),
  slaBreachedNotifiedAt: timestamp("sla_breached_notified_at", { withTimezone: true }),
  // HD2 — provenance for tickets auto-opened from a foreign producer event.
  source: varchar("source", { length: 32 }),
  sourceRef: varchar("source_ref", { length: 128 }),
  // ITIL — ticket type classification (incident, problem, change) or null for legacy tickets.
  ticketType: varchar("ticket_type", { length: 24 }),
  // ITIL — type-specific required fields stored as JSON.
  typeFields: jsonb("type_fields").$type<Record<string, unknown>>(),
  // CMDB — asset linkage: IDs of configuration items from asset-service.
  assetIds: jsonb("asset_ids").$type<string[]>(),
  // CMDB — whether the asset linkage has been verified against asset-service.
  assetVerified: boolean("asset_verified").default(false),
});

export type TicketRow = typeof tickets.$inferSelect;
export type TicketInsert = typeof tickets.$inferInsert;

export type TicketView = HelpdeskTicketSummary;

export const schema = { tickets };
