/**
 * Agent Capacity schema — helpdesk.agent_capacity
 *
 * Tracks agent workload, max ticket capacity, skills, and availability.
 */
import { pgSchema, uuid, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const agentCapacity = helpdeskSchema.table("agent_capacity", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  maxTickets: integer("max_tickets").notNull().default(10),
  currentLoad: integer("current_load").notNull().default(0),
  skills: jsonb("skills").$type<string[]>().default([]),
  available: boolean("available").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type AgentCapacityRow = typeof agentCapacity.$inferSelect;
export type AgentCapacityInsert = typeof agentCapacity.$inferInsert;

export const schema = { agentCapacity };
