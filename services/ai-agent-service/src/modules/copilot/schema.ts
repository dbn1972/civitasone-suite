import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

export const copilotTurns = domainSchema.table("copilot_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  prompt: text("prompt").notNull(),
  response: text("response"),
  sourceCitations: jsonb("source_citations").$type<Record<string, unknown>[]>(),
  model: varchar("model", { length: 64 }),
  tokens: integer("tokens"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CopilotTurnRow = typeof copilotTurns.$inferSelect;
export type CopilotTurnInsert = typeof copilotTurns.$inferInsert;

export const schema = { copilotTurns };
