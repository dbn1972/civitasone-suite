import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

export const decisionTables = domainSchema.table("decision_tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  version: integer("version").notNull().default(1),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  hitPolicy: varchar("hit_policy", { length: 16 }).notNull().default("first"),
  inputs: jsonb("inputs").notNull().default([]),
  outputs: jsonb("outputs").notNull().default([]),
  rules: jsonb("rules").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export type DecisionTableRow = typeof decisionTables.$inferSelect;
export type DecisionTableInsert = typeof decisionTables.$inferInsert;

export const schema = { decisionTables };
