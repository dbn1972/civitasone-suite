import { pgSchema, uuid, varchar, integer, timestamp, text, boolean } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

/**
 * AI governance audit trail. `input`/`output` are stored PII-redacted and
 * truncated by governance/domain.ts#buildAuditEntry — DPDP Act 2023 requires
 * that raw personal data is never logged or persisted in audit sinks.
 */
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
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AiAuditLogRow = typeof aiAuditLog.$inferSelect;
export type AiAuditLogInsert = typeof aiAuditLog.$inferInsert;

export const schema = { aiAuditLog };
