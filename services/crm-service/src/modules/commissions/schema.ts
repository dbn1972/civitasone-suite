import { pgSchema, uuid, varchar, integer, bigint, char, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const commissionRules = crmSchema.table("commission_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 16 }).notNull(),
  rateType: varchar("rate_type", { length: 16 }).notNull(),
  rateValue: bigint("rate_value", { mode: "bigint" }).notNull(),
  conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commissionLedger = crmSchema.table("commission_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  dealId: uuid("deal_id").notNull(),
  ruleId: uuid("rule_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  period: varchar("period", { length: 10 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedBy: uuid("approved_by"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export type CommissionRuleRow = typeof commissionRules.$inferSelect;
export type CommissionLedgerRow = typeof commissionLedger.$inferSelect;

export const schema = { commissionRules, commissionLedger };
