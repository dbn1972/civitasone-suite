import { pgSchema, char, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const budgetSchema = pgSchema("budget");

// finance_major_heads is a GLOBAL CGA major-head master (national codes such as
// 2055=Police, 4059=Capital Outlay) keyed by code alone — it is NOT tenant-scoped
// and carries no version/audit columns (see migration 0010). The model must match
// the table or SELECT * fails with "column tenant_id does not exist".
export const financeMajorHeads = budgetSchema.table("finance_major_heads", {
  code:        char("code", { length: 4 }).primaryKey(),
  description: text("description").notNull(),
  sector:      varchar("sector", { length: 16 }).notNull().default("General"),
  accountType: varchar("account_type", { length: 24 }).notNull().default("expenditure"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MajorHeadRow = typeof financeMajorHeads.$inferSelect;

export const schema = { financeMajorHeads };
