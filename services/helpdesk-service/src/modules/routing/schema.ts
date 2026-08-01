/**
 * Routing Rules schema — helpdesk.routing_rules
 *
 * Defines tenant-configurable routing rules for ticket assignment.
 * Strategies: round_robin, weighted, skill_based, least_busy.
 */
import { pgSchema, uuid, text, varchar, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const helpdeskSchema = pgSchema("helpdesk");

export const routingRules = helpdeskSchema.table("routing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  strategy: varchar("strategy", { length: 24 }).notNull(),
  criteria: jsonb("criteria").$type<Record<string, unknown>>(),
  weight: integer("weight").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  ordinal: integer("ordinal").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RoutingRuleRow = typeof routingRules.$inferSelect;
export type RoutingRuleInsert = typeof routingRules.$inferInsert;

export const schema = { routingRules };
