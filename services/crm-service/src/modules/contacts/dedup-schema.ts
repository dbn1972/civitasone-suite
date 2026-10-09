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

/**
 * GAP2-CRM-DEDUP-CANDIDATES-07 — persisted DISMISSALS for the post-save
 * duplicate-review screen. Candidate pairs are recomputed live from
 * crm.contacts; this table only records which pairs an operator chose to
 * suppress. `pairId` is the order-independent "min:max" contact-id key.
 * Table created via migration 0112.
 */
export const dedupDismissals = crmSchema.table("dedup_dismissals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  pairId: varchar("pair_id", { length: 128 }).notNull(),
  contactA: uuid("contact_a").notNull(),
  contactB: uuid("contact_b").notNull(),
  reason: varchar("reason", { length: 500 }),
  dismissedBy: uuid("dismissed_by").notNull(),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DedupDismissalRow = typeof dedupDismissals.$inferSelect;
export type DedupDismissalInsert = typeof dedupDismissals.$inferInsert;

export const schema = { dedupRules, dedupDismissals };
