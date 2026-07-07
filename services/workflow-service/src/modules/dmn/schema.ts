import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("workflow");

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** A DMN decision table input column definition. */
export interface DmnInput {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
}

/** A DMN decision table output column definition. */
export interface DmnOutput {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
  defaultValue?: unknown;
}

/** A single rule in a DMN decision table. */
export interface DmnRule {
  inputs: Record<string, string>; // key → condition expression (e.g. "> 500", "== 'high'")
  outputs: Record<string, unknown>; // key → output value
}

/** Supported DMN hit policies. */
export type DmnHitPolicy = "UNIQUE" | "FIRST" | "COLLECT" | "RULE_ORDER";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * DMN Decision Tables — stores decision table definitions per tenant.
 *
 * Constraints:
 *   - Max 30 input columns
 *   - Max 30 output columns
 *   - Max 500 rules
 *   - Hit policies: UNIQUE, FIRST, COLLECT, RULE_ORDER
 */
export const dmnTables = domainSchema.table("dmn_tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 2000 }),
  inputs: jsonb("inputs").$type<DmnInput[]>().notNull().default([]),
  outputs: jsonb("outputs").$type<DmnOutput[]>().notNull().default([]),
  rules: jsonb("rules").$type<DmnRule[]>().notNull().default([]),
  hitPolicy: varchar("hit_policy", { length: 16 }).notNull().default("FIRST"),
  version: integer("version").notNull().default(1),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DmnTableRow = typeof dmnTables.$inferSelect;
export type DmnTableInsert = typeof dmnTables.$inferInsert;

export const schema = { dmnTables };
