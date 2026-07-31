import { pgSchema, uuid, varchar, integer, timestamp, text, boolean } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

export const aiAuditLog = domainSchema.table("ai_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  agentId: uuid("agent_id"),
  action: varchar("action", { length: 100 }).notNull(),
  input: text("input"),
  output: text("output"),
  blocked: boolean("blocked").notNull().default(false),
  reason: varchar("reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiAuditLogRow = typeof aiAuditLog.$inferSelect;
export type AiAuditLogInsert = typeof aiAuditLog.$inferInsert;

export const schema = { aiAuditLog };
