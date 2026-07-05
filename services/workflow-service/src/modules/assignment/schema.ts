import { pgSchema, uuid, varchar, integer, timestamp, boolean, date } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("workflow");

export const responsibilityMatrix = domainSchema.table("responsibility_matrix", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  roleRef: varchar("role_ref", { length: 128 }).notNull(),
  conditionExpr: varchar("condition_expr", { length: 512 }),
  userId: uuid("user_id").notNull(),
  priority: integer("priority").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const substitutionRules = domainSchema.table("substitution_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  substituteId: uuid("substitute_id").notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date"),
  reason: varchar("reason", { length: 256 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ResponsibilityMatrixRow = typeof responsibilityMatrix.$inferSelect;
export type ResponsibilityMatrixInsert = typeof responsibilityMatrix.$inferInsert;
export type SubstitutionRuleRow = typeof substitutionRules.$inferSelect;
export type SubstitutionRuleInsert = typeof substitutionRules.$inferInsert;

export const schema = { responsibilityMatrix, substitutionRules };
