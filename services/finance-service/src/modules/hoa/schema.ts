import { pgSchema, char, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const budgetSchema = pgSchema("budget");

export const financeMajorHeads = budgetSchema.table("finance_major_heads", {
  code:        char("code", { length: 4 }).primaryKey(),
  description: text("description").notNull(),
  sector:      varchar("sector", { length: 16 }).notNull().default("General"),
  accountType: varchar("account_type", { length: 24 }).notNull().default("expenditure"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MajorHeadRow = typeof financeMajorHeads.$inferSelect;

export const schema = { financeMajorHeads };
