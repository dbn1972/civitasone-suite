import { pgSchema, uuid, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

/** AG-005 registered agent-interoperability endpoints (MCP, A2A, tool schemas). */
export const protocolRegistrations = domainSchema.table("protocol_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /** one of: mcp | a2a | openai_tools | anthropic_tools */
  protocol: varchar("protocol", { length: 32 }).notNull(),
  endpoint: varchar("endpoint", { length: 500 }).notNull(),
  capabilities: jsonb("capabilities").$type<Record<string, unknown>[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ProtocolRegistrationRow = typeof protocolRegistrations.$inferSelect;
export type ProtocolRegistrationInsert = typeof protocolRegistrations.$inferInsert;

export const schema = { protocolRegistrations };
