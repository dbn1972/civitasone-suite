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
  departmentId:    uuid("department_id"),
  moneyValueMinor: bigint("money_value_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  status:          varchar("status", { length: 24 }).notNull().default("open"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
  // Who recorded the department reply (migrations/0085): the settle maker != checker rule pins on it.
  respondedBy:     uuid("responded_by"),
});

// Append-only reply / escalate / settle trail (migrations/0085).
export const financeAuditParaEvents = auditModuleSchema.table("finance_audit_para_events", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  paraId:     uuid("para_id").notNull(),
  action:     varchar("action", { length: 16 }).notNull(),
  fromStatus: varchar("from_status", { length: 24 }).notNull(),
  toStatus:   varchar("to_status", { length: 24 }).notNull(),
  note:       text("note").notNull(),
  actorId:    uuid("actor_id").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditParaRow    = typeof financeAuditParas.$inferSelect;
export type AuditParaInsert = typeof financeAuditParas.$inferInsert;

export type AuditParaEventRow = typeof financeAuditParaEvents.$inferSelect;

export const schema = { financeAuditParas, financeAuditParaEvents };
