import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp,
} from "drizzle-orm/pg-core";

export const auditModuleSchema = pgSchema("audit");

export const financeAuditParas = auditModuleSchema.table("finance_audit_paras", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  paraNo:          text("para_no").notNull(),
  source:          varchar("source", { length: 32 }).notNull(),  // CAG|AG|internal
  dept:            text("dept").notNull(),
  moneyValueMinor: bigint("money_value_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  status:          varchar("status", { length: 24 }).notNull().default("open"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type AuditParaRow    = typeof financeAuditParas.$inferSelect;
export type AuditParaInsert = typeof financeAuditParas.$inferInsert;

export const schema = { financeAuditParas };
