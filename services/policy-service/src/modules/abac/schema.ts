import { pgSchema, uuid, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const abacSchema = pgSchema("abac");

export const abacRules = abacSchema.table("rules", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  roleId:     uuid("role_id").notNull(),
  expression: text("expression").notNull(),
  enabled:    boolean("enabled").notNull().default(true),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type AbacRuleRow    = typeof abacRules.$inferSelect;
export type AbacRuleInsert = typeof abacRules.$inferInsert;

export const abacModuleSchema = { abacRules };
