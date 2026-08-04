/**
 * dedup_rules — tenant-configurable duplicate-matching rules (DQ-001).
 * Lives in the `crm` Postgres schema. Table created via migration 0038.
 */
import { pgSchema, uuid, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const dedupRules = crmSchema.table("dedup_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  // email | phone | gstin | pan | name | company
  field: varchar("field", { length: 16 }).notNull(),
  // exact | fuzzy
  matchType: varchar("match_type", { length: 8 }).notNull().default("exact"),
  weight: integer("weight").notNull().default(10),
  threshold: integer("threshold").notNull().default(100),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type DedupRuleRow = typeof dedupRules.$inferSelect;
export type DedupRuleInsert = typeof dedupRules.$inferInsert;

export const schema = { dedupRules };
