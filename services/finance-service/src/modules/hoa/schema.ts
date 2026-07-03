import { pgSchema, char, text, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const budgetSchema = pgSchema("budget");

export const financeMajorHeads = budgetSchema.table("finance_major_heads", {
  code:        char("code", { length: 4 }).primaryKey(),
  description: text("description").notNull(),
  sector:      varchar("sector", { length: 16 }).notNull().default("General"),
  accountType: varchar("account_type", { length: 24 }).notNull().default("expenditure"),
  tenantId:    uuid("tenant_id").notNull(),
  version:     integer("version").notNull().default(1),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MajorHeadRow = typeof financeMajorHeads.$inferSelect;

export const schema = { financeMajorHeads };
